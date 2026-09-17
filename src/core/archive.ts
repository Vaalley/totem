interface ArchiveEntry {
  name: string;
  isDirectory: boolean;
  path?: string;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
    table[i] = value >>> 0;
  }
  return table;
})();

/** Accumulate a CRC32 over `data`; finalize the running value with `(crc ^ 0xffffffff) >>> 0`. */
function crc32(data: Uint8Array, crc = 0xffffffff): number {
  for (const byte of data) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return crc >>> 0;
}

function put16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function put32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
async function writeAll(file: Deno.FsFile, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = await file.write(bytes.subarray(offset));
    if (written <= 0) throw new Error("Unable to write ZIP archive");
    offset += written;
  }
}
function normalizedArchiveName(parts: string[], directory: boolean): string {
  const backslashSegment = parts.find((segment) => segment.includes("\\"));
  if (backslashSegment !== undefined) {
    throw new Error(
      `Portable ZIP archive paths cannot contain backslashes: "${backslashSegment}"`,
    );
  }
  const name = parts.join("/");
  if (!name || name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
    throw new Error(`Invalid archive path: ${name}`);
  }
  const segments = name.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Invalid archive path: ${name}`);
  }
  return directory ? `${name}/` : name;
}

function canonicalArchiveName(name: string): string {
  const withoutTrailingSlash = name.endsWith("/") ? name.slice(0, -1) : name;
  const segments = withoutTrailingSlash.split("/");
  const canonicalSegments = segments.map((segment) => segment.replace(/[. ]+$/g, "").toLowerCase());
  if (canonicalSegments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Invalid archive path: ${name}`);
  }
  return canonicalSegments.join("/");
}

function trackArchiveName(
  names: Map<string, string>,
  name: string,
): void {
  const canonical = canonicalArchiveName(name);
  const previous = names.get(canonical);
  if (previous !== undefined) {
    throw new Error(
      `Archive entry name collision: "${name}" conflicts with "${previous}"`,
    );
  }
  names.set(canonical, name);
}

async function collectEntries(root: string): Promise<ArchiveEntry[]> {
  const rootInfo = await Deno.lstat(root);
  if (rootInfo.isSymlink) {
    throw new Error(`Refusing symlink archive source: ${root}`);
  }
  if (!rootInfo.isDirectory) {
    throw new Error(`Archive source is not a directory: ${root}`);
  }
  const entries: ArchiveEntry[] = [];
  const archiveNames = new Map<string, string>();
  async function visit(path: string, parts: string[]): Promise<void> {
    const children: Deno.DirEntry[] = [];
    for await (const child of Deno.readDir(path)) children.push(child);
    children.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const child of children) {
      const childParts = [...parts, child.name];
      const childPath = `${path}/${child.name}`;
      const childInfo = await Deno.lstat(childPath);
      if (child.isSymlink || childInfo.isSymlink) {
        throw new Error(`Refusing symlink archive entry: ${childPath}`);
      }
      if (childInfo.isDirectory) {
        const name = normalizedArchiveName(childParts, true);
        trackArchiveName(archiveNames, name);
        entries.push({ name, isDirectory: true });
        await visit(childPath, childParts);
      } else if (childInfo.isFile) {
        const name = normalizedArchiveName(childParts, false);
        trackArchiveName(archiveNames, name);
        entries.push({
          name,
          isDirectory: false,
          path: childPath,
        });
      }
    }
  }
  await visit(root, []);
  return entries;
}

/** Create a ZIP archive containing the source directory's recursive contents. */
export async function createZipArchive(sourceDir: string, destinationZip: string): Promise<void> {
  const entries = await collectEntries(sourceDir);
  if (entries.length > 0xffff) {
    throw new Error("ZIP archive exceeds the classic ZIP directory limit");
  }
  const encoder = new TextEncoder();
  const central: Uint8Array[] = [];
  let offset = 0;
  const temporaryPath = `${destinationZip}.tmp-${crypto.randomUUID()}`;
  let output: Deno.FsFile | undefined;
  let temporaryCreated = false;
  try {
    output = await Deno.open(temporaryPath, { createNew: true, write: true });
    temporaryCreated = true;
    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      if (nameBytes.byteLength > 0xffff) {
        throw new Error("ZIP entry name exceeds the classic ZIP limit");
      }
      let source: Deno.FsFile | undefined;
      if (!entry.isDirectory) {
        const sourceInfo = await Deno.lstat(entry.path!);
        if (sourceInfo.isSymlink) {
          throw new Error(`Refusing symlink archive entry: ${entry.path}`);
        }
        if (!sourceInfo.isFile) {
          throw new Error(`Archive entry is no longer a regular file: ${entry.path}`);
        }
        if (sourceInfo.size > 0xffffffff) {
          throw new Error("ZIP archive exceeds the classic ZIP size limit");
        }
        source = await Deno.open(entry.path!, { read: true });
      }
      // UTF-8 names; crc and sizes are patched into the local header after streaming.
      const flags = 0x800;
      const entryOffset = offset;
      if (entryOffset > 0xffffffff - (30 + nameBytes.byteLength)) {
        throw new Error("ZIP archive exceeds the classic ZIP size limit");
      }

      const localHeader = new Uint8Array(30);
      const localView = new DataView(localHeader.buffer);
      put32(localView, 0, 0x04034b50);
      put16(localView, 4, 20);
      put16(localView, 6, flags);
      put16(localView, 8, entry.isDirectory ? 0 : 8); // stored or deflated
      put16(localView, 10, 0); // deterministic DOS time
      put16(localView, 12, 0); // deterministic DOS date
      put32(localView, 14, 0); // crc32 patched in place after the data streams
      put32(localView, 18, 0); // compressed size patched in place
      put32(localView, 22, 0); // uncompressed size patched in place
      put16(localView, 26, nameBytes.byteLength);
      put16(localView, 28, 0);
      await writeAll(output, concatBytes(localHeader, nameBytes));
      offset += 30 + nameBytes.byteLength;

      let checksum = 0;
      let compressedSize = 0;
      let uncompressedSize = 0;
      if (source !== undefined) {
        let crc = 0xffffffff;
        const tap = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            crc = crc32(chunk, crc);
            uncompressedSize += chunk.byteLength;
            if (uncompressedSize > 0xffffffff) {
              throw new Error("ZIP archive exceeds the classic ZIP size limit");
            }
            controller.enqueue(chunk);
          },
        });
        const sink = new WritableStream<Uint8Array>({
          write: async (chunk) => {
            if (offset + compressedSize + chunk.byteLength > 0xffffffff) {
              throw new Error("ZIP archive exceeds the classic ZIP size limit");
            }
            compressedSize += chunk.byteLength;
            await writeAll(output!, chunk);
          },
        });
        try {
          await source.readable
            .pipeThrough(tap)
            .pipeThrough(
              new CompressionStream("deflate-raw") as ReadableWritablePair<Uint8Array, Uint8Array>,
            )
            .pipeTo(sink);
        } finally {
          try {
            source.close();
          } catch {
            // The readable stream already closed the file.
          }
        }
        checksum = (crc ^ 0xffffffff) >>> 0;
        offset += compressedSize;

        const patch = new Uint8Array(12);
        const patchView = new DataView(patch.buffer);
        put32(patchView, 0, checksum);
        put32(patchView, 4, compressedSize);
        put32(patchView, 8, uncompressedSize);
        await output.seek(entryOffset + 14, Deno.SeekMode.Start);
        await writeAll(output, patch);
        await output.seek(0, Deno.SeekMode.End);
      }

      const centralHeader = new Uint8Array(46);
      const centralView = new DataView(centralHeader.buffer);
      put32(centralView, 0, 0x02014b50);
      put16(centralView, 4, 20);
      put16(centralView, 6, 20);
      put16(centralView, 8, flags);
      put16(centralView, 10, entry.isDirectory ? 0 : 8);
      put16(centralView, 12, 0);
      put16(centralView, 14, 0);
      put32(centralView, 16, checksum);
      put32(centralView, 20, compressedSize);
      put32(centralView, 24, uncompressedSize);
      put16(centralView, 28, nameBytes.byteLength);
      put16(centralView, 30, 0);
      put16(centralView, 32, 0);
      put16(centralView, 34, 0); // disk number start: always 0 (single-volume archive)
      put16(centralView, 36, 0); // internal attributes
      put32(centralView, 38, entry.isDirectory ? 0x10 : 0); // external MS-DOS directory attribute
      put32(centralView, 42, entryOffset);
      central.push(concatBytes(centralHeader, nameBytes));
    }

    const centralOffset = offset;
    const centralBytes = concatBytes(...central);
    if (centralBytes.byteLength > 0xffffffff || centralOffset > 0xffffffff) {
      throw new Error("ZIP archive exceeds the classic ZIP directory limit");
    }
    await writeAll(output, centralBytes);
    offset += centralBytes.byteLength;
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    put32(endView, 0, 0x06054b50);
    put16(endView, 4, 0);
    put16(endView, 6, 0);
    put16(endView, 8, entries.length);
    put16(endView, 10, entries.length);
    put32(endView, 12, centralBytes.byteLength);
    put32(endView, 16, centralOffset);
    put16(endView, 20, 0);
    await writeAll(output, end);

    output.close();
    output = undefined;
    await Deno.rename(temporaryPath, destinationZip);
    temporaryCreated = false;
  } catch (error) {
    try {
      output?.close();
    } catch {
      // Preserve the original archive error.
    }
    if (temporaryCreated) {
      try {
        await Deno.remove(temporaryPath);
      } catch {
        // Preserve the original archive error.
      }
    }
    throw error;
  }
}
