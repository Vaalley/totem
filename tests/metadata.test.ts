import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createZipArchive } from "../src/core/archive.ts";
import { detectMinecraftInfo, generateInfoMarkdown } from "../src/core/metadata.ts";
import type { BackupOptions, BackupStats, MinecraftInfo } from "../src/core/types.ts";

async function withTempDir<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await Deno.makeTempDir({ prefix: "totem-metadata-" });
  try {
    return await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

const stats: BackupStats = {
  screenshotsCopied: 2,
  modsListed: 3,
  modsCopied: 4,
  shadersListed: 5,
  shadersCopied: 6,
  shaderConfigsCopied: 1,
  resourcepacksListed: 7,
  resourcepacksCopied: 8,
  savesCopied: 9,
  xaeroCopied: 1,
  distantHorizonsCopied: 2,
  journeymapCopied: 3,
  voxelmapCopied: 4,
  mapwriterCopied: 5,
  litematicaCopied: 6,
  replayRecordingsCopied: 7,
  customFoldersCopied: 3,
  totalEntriesListed: 15,
  totalBytesListed: 8192,
  totalFilesCopied: 30,
  totalBytesCopied: 4096,
};

const options: BackupOptions = {
  folderModes: { mods: "full", resourcepacks: "manifest", shaderpacks: "full" },
  includeSaves: true,
  customFolders: ["xaero", "journeymap"],
  zipOutput: true,
  openWhenDone: false,
};

Deno.test("detectMinecraftInfo reads Minecraft and loader versions from an instance fixture", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(
      join(root, "mmc-pack.json"),
      JSON.stringify({
        components: [
          { uid: "net.minecraft", version: "1.20.4" },
          { uid: "net.fabricmc.fabric-loader", version: "0.15.11" },
        ],
      }),
    );
    await Deno.mkdir(join(root, "mods"));
    await Deno.writeTextFile(join(root, "mods", "fabric-api-0.97.0+1.20.4.jar"), "mod");

    assertEquals(await detectMinecraftInfo(root), {
      version: "1.20.4",
      loader: "Fabric",
      loaderVersion: "0.15.11",
    });
  });
});

Deno.test("detectMinecraftInfo supports instance.cfg and safe unknown defaults", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(
      join(root, "instance.cfg"),
      "mcversion=1.19.2\nloader=forge\nforgeversion=43.3.0\n",
    );
    assertEquals(await detectMinecraftInfo(root), {
      version: "1.19.2",
      loader: "Forge",
      loaderVersion: "43.3.0",
    });
    assertEquals(await detectMinecraftInfo(join(root, "missing-instance")), {
      version: "Unknown",
      loader: "Unknown",
      loaderVersion: "Unknown",
    });
  });
});

Deno.test("generateInfoMarkdown documents independent folder modes, selections, estimates, and errors", async () => {
  await withTempDir(async (root) => {
    await Deno.mkdir(join(root, "mods"), { recursive: true });
    await Deno.mkdir(join(root, "saves"), { recursive: true });
    await Deno.writeTextFile(join(root, "mods", "large.jar"), "0123456789");
    await Deno.writeTextFile(join(root, "saves", "world.dat"), "world");
    const backupPath = join(root, "backup");
    await Deno.mkdir(backupPath);
    const info: MinecraftInfo = { version: "1.20.4", loader: "Fabric", loaderVersion: "0.15.11" };

    await generateInfoMarkdown({
      backupPath,
      sourcePath: root,
      version: "1.20.4",
      info,
      stats,
      durationMs: 125,
      errors: ["one copy failed"],
      options,
    });
    const markdown = await Deno.readTextFile(join(backupPath, "info.md"));

    assertStringIncludes(markdown, "# Totem Backup");
    assertStringIncludes(markdown, "| Result | Completed with errors |");
    assertStringIncludes(markdown, "| Mods mode | Full |");
    assertStringIncludes(markdown, "| Resource packs mode | Absent |");
    assertStringIncludes(markdown, "| Shader packs mode | Absent |");
    assertStringIncludes(markdown, "| Saves | Included |");
    assertStringIncludes(markdown, "xaero");
    assertStringIncludes(markdown, "journeymap");
    assertStringIncludes(markdown, "Estimated bytes");
    assertStringIncludes(markdown, "| Total bytes copied | 4.00 KiB (4096 bytes) |");
    assertStringIncludes(markdown, "one copy failed");
    assertStringIncludes(markdown, "large.jar");
    assertStringIncludes(markdown, "world.dat");
  });
});

Deno.test("createZipArchive emits a valid ZIP containing recursive files and directory entries", async () => {
  await withTempDir(async (root) => {
    const source = join(root, "source");
    await Deno.mkdir(join(source, "nested", "empty"), { recursive: true });
    await Deno.writeTextFile(join(source, "info.md"), "backup");
    await Deno.writeTextFile(join(source, "nested", "data.txt"), "data");
    const destination = join(root, "backup.zip");

    await createZipArchive(source, destination);
    const bytes = await Deno.readFile(destination);
    const text = new TextDecoder().decode(bytes);

    assertEquals(bytes[0], 0x50);
    assertEquals(bytes[1], 0x4b);
    assertStringIncludes(text, "info.md");
    assertStringIncludes(text, "nested/");
    assertStringIncludes(text, "nested/data.txt");
  });
});
