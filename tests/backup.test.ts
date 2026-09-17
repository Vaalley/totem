import { assert, assertEquals, assertExists, assertFalse, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { performBackup } from "../src/core/backup.ts";
import { buildMinecraftPaths } from "../src/core/paths.ts";
import type { BackupOptions, BackupRequest, MinecraftPaths } from "../src/core/types.ts";

async function withTempDir<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await Deno.makeTempDir({ prefix: "totem-backup-" });
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

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

const manifestOptions: BackupOptions = {
  folderModes: { mods: "manifest", resourcepacks: "manifest", shaderpacks: "manifest" },
  includeSaves: false,
  customFolders: [],
  zipOutput: false,
  openWhenDone: false,
};

async function makeFixture(root: string): Promise<MinecraftPaths> {
  const paths = buildMinecraftPaths(root);
  await Deno.mkdir(paths.root, { recursive: true });
  await writeFile(join(paths.config, "mod.toml"), "mod");
  await writeFile(join(paths.config, "nested", "client.cfg"), "client");
  await writeFile(paths.options, "soundDevice:default\nkey_key.forward:87\n");
  await writeFile(join(paths.screenshots, "latest.png"), "screenshot");
  await writeFile(join(paths.screenshots, "2026", "nested.png"), "nested screenshot");
  await writeFile(join(paths.mods, "zeta.jar"), "z");
  await writeFile(join(paths.mods, "alpha-mod", "config.json"), "{}\n");
  await writeFile(join(paths.shaderpacks, "zeta.zip"), "shader");
  await writeFile(join(paths.shaderpacks, "alpha-shader", "shader.glsl"), "void main() {}\n");
  await writeFile(join(paths.shaderpacks, "zeta.txt"), "shader configuration\n");
  await writeFile(join(paths.resourcepacks, "zeta.zip"), "pack");
  await writeFile(join(paths.resourcepacks, "alpha-pack", "pack.mcmeta"), "{}\n");
  return paths;
}

function request(root: string, destination: string, options = manifestOptions): BackupRequest {
  return { minecraftPath: root, backupDestination: destination, options };
}

Deno.test("manifest modes copy recursive screenshots, manifests, mod config, and shader configs", async () => {
  await withTempDir(async (root) => {
    const paths = await makeFixture(join(root, ".minecraft"));
    const result = await performBackup(request(paths.root, join(root, "backups")));

    assertEquals(result.success, true);
    assertEquals(result.errors, []);
    assertEquals(
      await Deno.readTextFile(join(result.directoryPath, "screenshots", "2026", "nested.png")),
      "nested screenshot",
    );
    assertEquals(
      await Deno.readTextFile(join(result.directoryPath, "options.txt")),
      "soundDevice:default\nkey_key.forward:87\n",
    );
    assertEquals(
      await Deno.readTextFile(join(result.directoryPath, "config", "nested", "client.cfg")),
      "client",
    );
    assertEquals(
      await Deno.readTextFile(join(result.directoryPath, "shader-configs", "zeta.txt")),
      "shader configuration\n",
    );

    assertEquals(
      (await Deno.readTextFile(join(result.directoryPath, "mods.txt"))).trim().split("\n"),
      ["alpha-mod", "zeta.jar"],
    );
    assertEquals(
      (await Deno.readTextFile(join(result.directoryPath, "shaders.txt"))).trim().split("\n"),
      ["alpha-shader", "zeta.zip"],
    );
    assertEquals(
      (await Deno.readTextFile(join(result.directoryPath, "resourcepacks.txt"))).trim().split("\n"),
      ["alpha-pack", "zeta.zip"],
    );
    assertFalse(await exists(join(result.directoryPath, "mods")));
    assertFalse(await exists(join(result.directoryPath, "shaderpacks")));
    assertFalse(await exists(join(result.directoryPath, "resourcepacks")));
    assertEquals(result.stats.screenshotsCopied, 2);
    assertEquals(result.stats.modsListed, 2);
    assertEquals(result.stats.shadersListed, 2);
    assertEquals(result.stats.shaderConfigsCopied, 1);
  });
});

Deno.test("full modes preserve each source tree and root mod config without manifests", async () => {
  await withTempDir(async (root) => {
    const paths = await makeFixture(join(root, ".minecraft"));
    const options: BackupOptions = {
      ...manifestOptions,
      folderModes: { mods: "full", resourcepacks: "full", shaderpacks: "full" },
    };
    const result = await performBackup(request(paths.root, join(root, "backups"), options));

    assertEquals(result.success, true);
    assertEquals(
      await Deno.readTextFile(join(result.directoryPath, "mods", "alpha-mod", "config.json")),
      "{}\n",
    );
    assertEquals(
      await Deno.readTextFile(
        join(result.directoryPath, "resourcepacks", "alpha-pack", "pack.mcmeta"),
      ),
      "{}\n",
    );
    assertEquals(
      await Deno.readTextFile(join(result.directoryPath, "shaderpacks", "zeta.txt")),
      "shader configuration\n",
    );
    assertEquals(await Deno.readTextFile(join(result.directoryPath, "config", "mod.toml")), "mod");
    assertFalse(await exists(join(result.directoryPath, "mods.txt")));
    assertFalse(await exists(join(result.directoryPath, "resourcepacks.txt")));
    assertFalse(await exists(join(result.directoryPath, "shaders.txt")));
    assertFalse(await exists(join(result.directoryPath, "shader-configs")));
    assertEquals(result.stats.modsCopied, 2);
    assertEquals(result.stats.resourcepacksCopied, 2);
    assertEquals(result.stats.shadersCopied, 3);
  });
});

Deno.test("folder modes are independent in one backup", async () => {
  await withTempDir(async (root) => {
    const paths = await makeFixture(join(root, ".minecraft"));
    const options: BackupOptions = {
      ...manifestOptions,
      folderModes: { mods: "full", resourcepacks: "manifest", shaderpacks: "full" },
    };
    const result = await performBackup(request(paths.root, join(root, "backups"), options));

    assertEquals(result.success, true);
    assertEquals(await Deno.readTextFile(join(result.directoryPath, "mods", "zeta.jar")), "z");
    assertEquals(
      await Deno.readTextFile(
        join(result.directoryPath, "shaderpacks", "alpha-shader", "shader.glsl"),
      ),
      "void main() {}\n",
    );
    assertEquals(
      (await Deno.readTextFile(join(result.directoryPath, "resourcepacks.txt"))).trim(),
      "alpha-pack\nzeta.zip",
    );
    assertFalse(await exists(join(result.directoryPath, "mods.txt")));
    assertFalse(await exists(join(result.directoryPath, "shaders.txt")));
  });
});

Deno.test("saves and selected custom folders are copied, while unselected or absent folders are omitted", async () => {
  await withTempDir(async (root) => {
    const paths = await makeFixture(join(root, ".minecraft"));
    await writeFile(join(paths.saves, "World", "region", "r.0.0.mca"), "world");
    await writeFile(join(paths.xaero, "map", "level.dat"), "map");
    await writeFile(join(paths.journeymap, "data.json"), "journey");
    const options: BackupOptions = {
      ...manifestOptions,
      includeSaves: true,
      customFolders: ["xaero", "litematica"],
    };
    const result = await performBackup(request(paths.root, join(root, "backups"), options));

    assertEquals(result.success, true);
    assertEquals(
      await Deno.readTextFile(join(result.directoryPath, "saves", "World", "region", "r.0.0.mca")),
      "world",
    );
    assertEquals(
      await Deno.readTextFile(join(result.directoryPath, "xaero", "map", "level.dat")),
      "map",
    );
    assertFalse(await exists(join(result.directoryPath, "journeymap")));
    assertFalse(await exists(join(result.directoryPath, "litematica")));
    assertEquals(result.stats.savesCopied, 1);
    assertEquals(result.stats.customFolderFilesCopied["xaero"], 1);
    assertEquals(result.stats.customFoldersCopied, 1);
  });
});

Deno.test("selected dynamic custom folders copy their actual trees and restore metadata", async () => {
  await withTempDir(async (root) => {
    const paths = await makeFixture(join(root, ".minecraft"));
    await writeFile(join(paths.root, "XaeroWaypoints", "nested", "waypoints.json"), "waypoints");
    await writeFile(join(paths.root, "XaeroWaypoints", "nested", "markers.dat"), "markers");
    await writeFile(join(paths.root, "schematics", "house.litematic"), "schematic");
    await writeFile(join(paths.root, ".bobby", "cache.bin"), "cache");
    await writeFile(join(paths.root, "versions", "1.21.jar"), "runtime");
    await writeFile(join(paths.root, "assets", "indexes", "1.21.json"), "runtime");
    await writeFile(join(paths.root, "logs", "latest.log"), "runtime");

    const result = await performBackup(request(paths.root, join(root, "backups"), {
      ...manifestOptions,
      customFolders: ["custom:XaeroWaypoints"],
    }));

    assertEquals(result.success, true);
    assertEquals(
      await Deno.readTextFile(
        join(result.directoryPath, "XaeroWaypoints", "nested", "waypoints.json"),
      ),
      "waypoints",
    );
    assertEquals(
      await Deno.readTextFile(
        join(result.directoryPath, "XaeroWaypoints", "nested", "markers.dat"),
      ),
      "markers",
    );
    assertFalse(await exists(join(result.directoryPath, "schematics")));
    assertFalse(await exists(join(result.directoryPath, ".bobby")));
    assertFalse(await exists(join(result.directoryPath, "versions")));
    assertFalse(await exists(join(result.directoryPath, "assets")));
    assertFalse(await exists(join(result.directoryPath, "logs")));
    assertEquals(result.stats.customFoldersCopied, 2);

    const info = await Deno.readTextFile(join(result.directoryPath, "info.md"));
    assertStringIncludes(info, "XaeroWaypoints");
    assertStringIncludes(info, "Copy `XaeroWaypoints/` back");
  });
});

Deno.test("selected but absent saves and custom folders do not require prompts or create placeholders", async () => {
  await withTempDir(async (root) => {
    const paths = await makeFixture(join(root, ".minecraft"));
    const result = await performBackup(request(paths.root, join(root, "backups"), {
      ...manifestOptions,
      includeSaves: true,
      customFolders: ["xaero", "distantHorizons", "replayRecordings"],
    }));

    assertEquals(result.success, true);
    assertEquals(result.errors, []);
    assertFalse(await exists(join(result.directoryPath, "saves")));
    assertFalse(await exists(join(result.directoryPath, "xaero")));
    assertFalse(await exists(join(result.directoryPath, "distant_horizons_server_data")));
    assertFalse(await exists(join(result.directoryPath, "replay_recordings")));
  });
});

Deno.test("ZIP output is optional, retained beside the directory, and collision-safe", async () => {
  await withTempDir(async (root) => {
    const paths = await makeFixture(join(root, ".minecraft"));
    const destination = join(root, "backups");
    const options = { ...manifestOptions, zipOutput: true };
    const first = await performBackup(request(paths.root, destination, options));
    const second = await performBackup(request(paths.root, destination, options));

    assertEquals(first.success, true);
    assertEquals(second.success, true);
    assert(first.directoryPath !== second.directoryPath);
    assert(first.outputPath.endsWith(".zip"));
    assert(second.outputPath.endsWith(".zip"));
    assertExists(await Deno.stat(first.directoryPath));
    assertExists(await Deno.stat(first.outputPath));
    assertExists(await Deno.stat(second.directoryPath));
    assertExists(await Deno.stat(second.outputPath));
    assertEquals((await Deno.readFile(first.outputPath)).slice(0, 2), new Uint8Array([0x50, 0x4b]));
  });
});

Deno.test("backup rejects source-destination overlap and reports destination errors", async () => {
  await withTempDir(async (root) => {
    const paths = await makeFixture(join(root, ".minecraft"));
    const overlap = await performBackup(request(paths.root, join(paths.root, "backups")));
    assertEquals(overlap.success, false);
    assertStringIncludes(overlap.errors.join(" ").toLowerCase(), "overlap");
    assertEquals(overlap.directoryPath, "");

    const destinationFile = join(root, "not-a-directory");
    await Deno.writeTextFile(destinationFile, "occupied");
    const invalidDestination = await performBackup(request(paths.root, destinationFile));
    assertEquals(invalidDestination.success, false);
    assertStringIncludes(invalidDestination.errors.join(" ").toLowerCase(), "directory");
  });
});
