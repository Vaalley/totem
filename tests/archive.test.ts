import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { createZipArchive } from "../src/core/archive.ts";

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const METHOD_DEFLATE = 8;
const FLAG_DATA_DESCRIPTOR = 0x08;

async function withTempDir<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await Deno.makeTempDir({ prefix: "totem-archive-" });
  try {
    return await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

async function writeFile(path: string, content: string | Uint8Array): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  if (typeof content === "string") {
    await Deno.writeTextFile(path, content);
  } else {
    await Deno.writeFile(path, content);
  }
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(new Blob([data.slice()])).body!.pipeThrough(
    new DecompressionStream("deflate-raw"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface CentralEntry {
  name: string;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  diskNumberStart: number;
}

function endOfCentralDirectory(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.byteLength - 22; offset >= 0; offset--) {
    if (view.getUint32(offset, true) === END_SIGNATURE) return offset;
  }
  throw new Error("End of central directory record not found");
}

function centralEntries(bytes: Uint8Array): CentralEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = endOfCentralDirectory(bytes);
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries: CentralEntry[] = [];
  for (let index = 0; index < count; index++) {
    assertEquals(view.getUint32(offset, true), CENTRAL_HEADER_SIGNATURE);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    entries.push({
      name: decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)),
      method: view.getUint16(offset + 10, true),
      crc32: view.getUint32(offset + 16, true),
      compressedSize: view.getUint32(offset + 20, true),
      uncompressedSize: view.getUint32(offset + 24, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
      diskNumberStart: view.getUint16(offset + 34, true),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  for (const entry of entries) {
    assertEquals(
      entry.diskNumberStart,
      0,
      `${entry.name} must not declare a disk number start (multi-volume marker)`,
    );
  }
  assertEquals(offset, end);
  return entries;
}

function localHeader(bytes: Uint8Array, offset: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assertEquals(view.getUint32(offset, true), LOCAL_HEADER_SIGNATURE);
  return {
    flags: view.getUint16(offset + 6, true),
    method: view.getUint16(offset + 8, true),
    crc32: view.getUint32(offset + 14, true),
    compressedSize: view.getUint32(offset + 18, true),
    uncompressedSize: view.getUint32(offset + 22, true),
    dataOffset: offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true),
  };
}

async function entryNames(root: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(root)) names.push(entry.name);
  return names;
}

Deno.test("ZIP archive stores deflated entries that inflate back to the source bytes", async () => {
  await withTempDir(async (root) => {
    const source = join(root, "source");
    const destination = join(root, "backup.zip");
    const repetitive = "the quick brown fox jumps over the lazy dog\n".repeat(200);
    const binary = new Uint8Array(256).map((_, index) => index);
    await writeFile(join(source, "notes.txt"), "first line\nsecond line\n");
    await writeFile(join(source, "nested", "deep.bin"), binary);
    await writeFile(join(source, "big.txt"), repetitive);

    await createZipArchive(source, destination);

    const bytes = await Deno.readFile(destination);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assertEquals(view.getUint32(0, true), LOCAL_HEADER_SIGNATURE);

    const entries = centralEntries(bytes);
    const files = entries.filter((entry) => !entry.name.endsWith("/"));
    assertEquals(
      files.map((entry) => entry.name).sort(),
      ["big.txt", "nested/deep.bin", "notes.txt"],
    );
    const expected: Record<string, Uint8Array> = {
      "notes.txt": new TextEncoder().encode("first line\nsecond line\n"),
      "nested/deep.bin": binary,
      "big.txt": new TextEncoder().encode(repetitive),
    };
    for (const entry of files) {
      assertEquals(entry.method, METHOD_DEFLATE, `${entry.name} must be deflated`);
      const header = localHeader(bytes, entry.localHeaderOffset);
      assertEquals(header.method, METHOD_DEFLATE);
      assertEquals(header.flags, 0x800, `${entry.name} must set only the UTF-8 flag`);
      assert(
        (header.flags & FLAG_DATA_DESCRIPTOR) === 0,
        `${entry.name} must not set the data descriptor flag`,
      );
      assertEquals(header.crc32, entry.crc32, "local header must carry the real CRC");
      assertEquals(header.compressedSize, entry.compressedSize);
      assertEquals(header.uncompressedSize, entry.uncompressedSize);

      const nextOffset = header.dataOffset + entry.compressedSize;
      const nextSignature = view.getUint32(nextOffset, true);
      assert(
        nextSignature === LOCAL_HEADER_SIGNATURE || nextSignature === CENTRAL_HEADER_SIGNATURE,
        `${entry.name} compressed data must be followed by a header, not a descriptor`,
      );

      const compressed = bytes.subarray(header.dataOffset, nextOffset);
      const inflated = await inflateRaw(compressed);
      assertEquals(inflated, expected[entry.name], `${entry.name} must round-trip`);
      assertEquals(entry.uncompressedSize, expected[entry.name].byteLength);
    }

    const directories = entries.filter((entry) => entry.name.endsWith("/"));
    assertEquals(directories.map((entry) => entry.name).sort(), ["nested/"]);
    for (const entry of directories) {
      assertEquals(entry.method, 0, `${entry.name} directory must be stored`);
      const header = localHeader(bytes, entry.localHeaderOffset);
      assertEquals(header.method, 0, `${entry.name} local header must be stored`);
    }

    for (let offset = 0; offset + 4 <= bytes.byteLength; offset++) {
      assert(
        view.getUint32(offset, true) !== DATA_DESCRIPTOR_SIGNATURE,
        `archive must not contain a data descriptor signature at ${offset}`,
      );
    }

    const big = files.find((entry) => entry.name === "big.txt")!;
    assert(
      big.compressedSize < big.uncompressedSize,
      "repetitive content must actually compress",
    );
  });
});

Deno.test("ZIP archive output is deterministic for identical input", async () => {
  await withTempDir(async (root) => {
    const source = join(root, "source");
    await writeFile(join(source, "a.txt"), "alpha");
    await writeFile(join(source, "dir", "b.txt"), "beta");
    const first = join(root, "first.zip");
    const second = join(root, "second.zip");
    await createZipArchive(source, first);
    await createZipArchive(source, second);
    assertEquals(await Deno.readFile(first), await Deno.readFile(second));
  });
});

Deno.test("ZIP archive rejects entries that collide after case folding", async () => {
  await withTempDir(async (root) => {
    const source = join(root, "source");
    await writeFile(join(source, "README.txt"), "upper");
    await writeFile(join(source, "readme.txt"), "lower");
    if ((await entryNames(source)).length < 2) {
      // Case-insensitive filesystems cannot hold both names; nothing to reject.
      return;
    }
    const error = await assertRejects(
      () => createZipArchive(source, join(root, "out.zip")),
      Error,
    );
    assertStringIncludes(error.message, "collision");
  });
});

Deno.test("ZIP archive rejects entries that collide after trailing-dot normalization", async () => {
  await withTempDir(async (root) => {
    const source = join(root, "source");
    await writeFile(join(source, "foo"), "plain");
    try {
      await writeFile(join(source, "foo."), "dotted");
    } catch {
      return; // Filesystem refuses trailing-dot names.
    }
    if ((await entryNames(source)).length < 2) {
      // Windows silently strips the trailing dot; nothing to reject.
      return;
    }
    const error = await assertRejects(
      () => createZipArchive(source, join(root, "out.zip")),
      Error,
    );
    assertStringIncludes(error.message, "collision");
  });
});

Deno.test("ZIP archive rejects file names containing literal backslashes", async () => {
  if (Deno.build.os === "windows") return; // Backslash is a path separator on Windows.
  await withTempDir(async (root) => {
    const source = join(root, "source");
    try {
      await writeFile(join(source, "evil\\name.txt"), "backslash");
    } catch {
      return; // Filesystem refuses backslash names.
    }
    const error = await assertRejects(
      () => createZipArchive(source, join(root, "out.zip")),
      Error,
    );
    assertStringIncludes(error.message, "backslash");
  });
});

Deno.test("ZIP archive rejects symbolic links inside the source tree", async () => {
  await withTempDir(async (root) => {
    const source = join(root, "source");
    await writeFile(join(source, "real.txt"), "real");
    try {
      await Deno.symlink(join(source, "real.txt"), join(source, "link.txt"));
    } catch {
      return; // Symlink creation needs privileges on Windows.
    }
    const error = await assertRejects(
      () => createZipArchive(source, join(root, "out.zip")),
      Error,
    );
    assertStringIncludes(error.message, "symlink");
  });
});
