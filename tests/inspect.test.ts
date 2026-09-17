import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { inspectMinecraftInstance, inspectMinecraftPath } from "../src/core/inspect.ts";

async function withTempDir<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await Deno.makeTempDir({ prefix: "totem-inspect-" });
  try {
    return await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

async function writeFile(path: string, content: string): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, content);
}

Deno.test("inspectMinecraftPath reports an actionable error for a missing path", async () => {
  await withTempDir(async (root) => {
    const missing = join(root, "does-not-exist");
    const result = await inspectMinecraftPath(missing);
    assertFalse(result.valid);
    assertEquals(result.present, []);
    assert(result.errors.length > 0, "an inaccessible path must produce an error");
    assertStringIncludes(result.errors[0], "cannot be accessed");
    assert(result.missing.length > 0, "all markers should be listed as missing");
  });
});

Deno.test("inspectMinecraftPath accepts a directory with a Minecraft marker", async () => {
  await withTempDir(async (root) => {
    const instance = join(root, "instance");
    await Deno.mkdir(join(instance, "mods"), { recursive: true });
    const result = await inspectMinecraftPath(instance);
    assert(result.valid, `expected a valid path, got errors: ${result.errors.join("; ")}`);
    assertEquals(result.errors, []);
    assert(result.present.includes("mods"));
    assert(result.missing.includes("saves"));
    assertFalse(result.missing.includes("mods"));
  });
});

Deno.test("inspectMinecraftPath warns but stays valid for an empty directory", async () => {
  await withTempDir(async (root) => {
    const instance = join(root, "instance");
    await Deno.mkdir(instance, { recursive: true });
    const result = await inspectMinecraftPath(instance);
    assert(result.valid, `expected a valid path, got errors: ${result.errors.join("; ")}`);
    assertEquals(result.errors, []);
    assertEquals(result.present, []);
    assert(
      result.warnings.some((warning) => warning.includes("No recognizable Minecraft")),
      "an empty directory must warn that nothing recognizable was found",
    );
  });
});

Deno.test("inspectMinecraftPath rejects a path that is not a directory", async () => {
  await withTempDir(async (root) => {
    const file = join(root, "not-a-directory.txt");
    await writeFile(file, "content");
    const result = await inspectMinecraftPath(file);
    assertFalse(result.valid);
    assert(result.errors.length > 0);
    assertStringIncludes(result.errors[0], "must be an existing directory");
  });
});

Deno.test("inspectMinecraftPath accepts options.txt as a file marker", async () => {
  await withTempDir(async (root) => {
    const instance = join(root, "instance");
    await writeFile(join(instance, "options.txt"), "soundDevice:default\n");
    const result = await inspectMinecraftPath(instance);
    assert(result.valid, `expected a valid path, got errors: ${result.errors.join("; ")}`);
    assert(result.present.includes("options.txt"));
  });
});

Deno.test("inspectMinecraftInstance summarizes mods and discovers custom folders", async () => {
  await withTempDir(async (root) => {
    const instance = join(root, "instance");
    await writeFile(join(instance, "mods", "alpha.jar"), "alpha");
    await writeFile(join(instance, "mods", "beta.jar"), "beta!");
    await writeFile(join(instance, "journeymap", "map.dat"), "mapdata");
    await writeFile(join(instance, "logs", "latest.log"), "log line\n");
    await writeFile(join(instance, "coolmoddata", "state.json"), "{}\n");

    const inspection = await inspectMinecraftInstance(instance);

    const mods = inspection.folders.mods;
    assert(mods, "mods folder should be summarized");
    assertEquals(mods.fileCount, 2);
    assertEquals(mods.totalBytes, "alpha".length + "beta!".length);
    assertEquals(mods.estimatedFullBytes, mods.totalBytes);

    const ids = inspection.customFolders.map((folder) => folder.id);
    assert(ids.includes("journeymap"), "known folder journeymap must be offered");
    assert(
      ids.includes("custom:coolmoddata"),
      "unknown directory must be offered as a custom folder",
    );
    assertFalse(
      ids.some((id) => id === "custom:logs"),
      "denylisted logs directory must not be offered",
    );

    const journeymap = inspection.customFolders.find((folder) => folder.id === "journeymap")!;
    assertEquals(journeymap.folderName, "journeymap");
    assertEquals(journeymap.fileCount, 1);
    assertEquals(journeymap.totalBytes, "mapdata".length);
    assertEquals(journeymap.estimatedFullBytes, journeymap.totalBytes);
  });
});

Deno.test("inspectMinecraftInstance applies the discovery denylist case-insensitively", async () => {
  await withTempDir(async (root) => {
    const instance = join(root, "instance");
    await Deno.mkdir(join(instance, "mods"), { recursive: true });
    await writeFile(join(instance, "LOGS", "latest.log"), "log\n");
    await writeFile(join(instance, "Config", "settings.cfg"), "cfg\n");

    const inspection = await inspectMinecraftInstance(instance);
    const names = inspection.customFolders.map((folder) => folder.folderName.toLowerCase());
    assertFalse(names.includes("logs"), "LOGS must be denied despite the uppercase name");
    assertFalse(names.includes("config"), "Config must be denied despite the mixed-case name");
  });
});

Deno.test("inspectMinecraftInstance strips ANSI escapes from custom folder labels", async () => {
  if (Deno.build.os === "windows") return; // Control bytes are invalid in Windows file names.
  await withTempDir(async (root) => {
    const instance = join(root, "instance");
    await Deno.mkdir(join(instance, "mods"), { recursive: true });
    const evilName = "evil\u001b[31m";
    try {
      await writeFile(join(instance, evilName, "data.txt"), "data");
    } catch {
      return; // Filesystem refuses control bytes in names.
    }

    const inspection = await inspectMinecraftInstance(instance);
    const evil = inspection.customFolders.find((folder) => folder.folderName === evilName);
    assert(evil, "the control-byte directory should still be discovered");
    assertFalse(evil.label.includes("\u001b"), "label must not contain ESC bytes");
    assertEquals(evil.label, "evil");
  });
});
