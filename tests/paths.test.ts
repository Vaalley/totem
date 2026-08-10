import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { buildMinecraftPaths, validateMinecraftPath } from "../src/core/backup.ts";
import { inspectMinecraftInstance } from "../src/core/inspect.ts";

async function withTempDir<T>(
  fn: (root: string) => T | PromiseLike<T>,
): Promise<T> {
  const root = await Deno.makeTempDir({ prefix: "totem-paths-" });
  try {
    return await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

async function writeFile(path: string, content: string): Promise<void> {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  await Deno.mkdir(path.slice(0, separator), { recursive: true });
  await Deno.writeTextFile(path, content);
}

Deno.test("buildMinecraftPaths normalizes roots and includes config and every known custom path", async () => {
  await withTempDir((temp) => {
    const normalized = buildMinecraftPaths(join(temp, "instance", "..", "instance", "."));
    const equivalent = buildMinecraftPaths(join(temp, "instance"));

    assertEquals(normalized.root, equivalent.root);
    assertEquals(normalized.config, join(equivalent.root, "config"));
    assertEquals(normalized.screenshots, join(equivalent.root, "screenshots"));
    assertEquals(normalized.mods, join(equivalent.root, "mods"));
    assertEquals(normalized.shaderpacks, join(equivalent.root, "shaderpacks"));
    assertEquals(normalized.resourcepacks, join(equivalent.root, "resourcepacks"));
    assertEquals(normalized.options, join(equivalent.root, "options.txt"));
    assertEquals(normalized.distantHorizons, join(equivalent.root, "distant_horizons_server_data"));
    assertEquals(normalized.replayRecordings, join(equivalent.root, "replay_recordings"));
    for (const path of Object.values(normalized)) {
      assert(!path.includes(".."), `un-normalized path: ${path}`);
    }
  });
});

Deno.test("path-first inspection returns recursive inventories and byte estimates", async () => {
  await withTempDir(async (root) => {
    const paths = buildMinecraftPaths(join(root, "instance"));
    await Deno.mkdir(paths.root, { recursive: true });
    await writeFile(join(paths.config, "a.cfg"), "1234");
    await writeFile(join(paths.config, "nested", "b.cfg"), "123");
    await writeFile(paths.options, "options");
    await writeFile(join(paths.mods, "fabric.jar"), "jar");
    await writeFile(join(paths.mods, "nested", "data.bin"), "data");
    await writeFile(join(paths.resourcepacks, "pack.zip"), "pack");
    await writeFile(join(paths.shaderpacks, "shader.zip"), "shader");
    await writeFile(join(paths.shaderpacks, "nested", "shader.glsl"), "glsl");
    await writeFile(join(paths.shaderpacks, "complementary.txt"), "cfg");
    await writeFile(join(paths.saves, "World", "level.dat"), "level");
    await writeFile(join(paths.xaero, "map.dat"), "map");
    await writeFile(join(paths.root, "XaeroWaypoints", "waypoints.json"), "waypoint");
    await writeFile(join(paths.root, "XaeroWaypoints", "nested", "marker.dat"), "marker");
    await writeFile(join(paths.root, "schematics", "nested", "house.litematic"), "blueprint");
    await writeFile(join(paths.root, ".bobby", "cache", "chunk.dat"), "cache");
    await writeFile(join(paths.root, "versions", "1.21.jar"), "runtime");
    await writeFile(join(paths.root, "assets", "indexes", "1.21.json"), "runtime");
    await writeFile(join(paths.root, "logs", "latest.log"), "runtime");

    const inspection = await inspectMinecraftInstance(`" ${paths.root} "`);
    const mods = inspection.folders.mods;
    const shaders = inspection.folders.shaderpacks;
    const resourcepacks = inspection.folders.resourcepacks;

    assertEquals(inspection.root, paths.root);
    assertEquals(inspection.validation.valid, true);
    assert(mods !== undefined);
    assertEquals(mods.fileCount, 2);
    assertEquals(mods.directoryCount, 1);
    assertEquals(mods.totalBytes, 7);
    assertEquals(mods.listedEntries, 2);
    assertEquals(mods.listedFiles, 1);
    assertEquals(mods.listedDirectories, 1);
    assertEquals(mods.configBytes, 7);
    assertEquals(mods.configFileCount, 2);
    assertEquals(mods.configDirectoryCount, 1);
    assertEquals(mods.estimatedManifestBytes, 25);
    assertEquals(mods.estimatedFullBytes, 14);

    assert(shaders !== undefined);
    assertEquals(shaders.estimatedManifestBytes, 21);
    assertEquals(shaders.estimatedFullBytes, 13);
    assertEquals(shaders.fileCount, 3);
    assertEquals(shaders.directoryCount, 1);
    assertEquals(shaders.listedEntries, 2);
    assertEquals(shaders.configFileCount, 1);
    assertEquals(shaders.configBytes, 3);

    assert(resourcepacks !== undefined);
    assertEquals(resourcepacks.listedEntries, 1);
    assertEquals(resourcepacks.estimatedManifestBytes, 9);
    assertEquals(resourcepacks.estimatedFullBytes, 4);
    assert(inspection.saves !== undefined);
    assertEquals(inspection.saves.fileCount, 1);
    assertEquals(inspection.saves.totalBytes, 5);
    const customFolders = new Map(
      inspection.customFolders.map((folder) => [folder.id, folder]),
    );
    assertEquals(
      [...customFolders.keys()].sort(),
      ["custom:.bobby", "custom:XaeroWaypoints", "custom:schematics", "xaero"].sort(),
    );
    assertEquals(customFolders.get("xaero")?.folderName, "xaero");
    assertEquals(customFolders.get("custom:XaeroWaypoints")?.totalBytes, 14);
    assertEquals(customFolders.get("custom:XaeroWaypoints")?.estimatedFullBytes, 14);
    assertEquals(customFolders.get("custom:XaeroWaypoints")?.fileCount, 2);
    assertEquals(customFolders.get("custom:XaeroWaypoints")?.directoryCount, 1);
    assertEquals(customFolders.get("custom:schematics")?.totalBytes, 9);
    assertEquals(customFolders.get("custom:schematics")?.estimatedFullBytes, 9);
    assertEquals(customFolders.get("custom:.bobby")?.totalBytes, 5);
    assertEquals(customFolders.get("custom:.bobby")?.estimatedFullBytes, 5);
    assertEquals(inspection.customFolders.filter((folder) => folder.id === "xaero").length, 1);
  });
});

Deno.test("inspection and validation treat absent optional folders as normal", async () => {
  await withTempDir(async (root) => {
    const paths = buildMinecraftPaths(root);
    await Deno.mkdir(paths.root, { recursive: true });
    await Deno.mkdir(paths.config, { recursive: true });
    await Deno.writeTextFile(paths.options, "options");

    const inspection = await inspectMinecraftInstance(root);
    assertEquals(inspection.validation.valid, true);
    assertEquals(inspection.validation.errors, []);
    assertEquals(inspection.folders.mods, undefined);
    assertEquals(inspection.folders.resourcepacks, undefined);
    assertEquals(inspection.folders.shaderpacks, undefined);
    assertEquals(inspection.saves, undefined);
    assertEquals(inspection.customFolders, []);
    assert(inspection.validation.missing.includes("mods"));
    assert(inspection.validation.missing.includes("saves"));

    const missing = await validateMinecraftPath(join(root, "does-not-exist"));
    assertEquals(missing.valid, false);
    assertStringIncludes(missing.errors.join(" ").toLowerCase(), "accessed");
  });
});
