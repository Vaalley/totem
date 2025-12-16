/**
 * Totem CLI - Backup Logic
 */

import { join } from "path";
import type { BackupOptions, BackupResult, MinecraftPaths } from "./types";
import {
    ensureDir,
    listFiles,
    listDirs,
    copyDir,
    copyFile,
    writeFile,
    pathExists,
    generateTimestamp,
    normalizePath,
    getDirSize,
    formatBytes,
    getMinecraftInfo,
    getOSInfo,
    getLargestItems,
    formatDuration,
} from "./utils";
import { showProgress } from "./prompts";

/** Build the MinecraftPaths object from a root path */
export function buildMinecraftPaths(rootPath: string): MinecraftPaths {
    const root = normalizePath(rootPath);
    return {
        root,
        screenshots: join(root, "screenshots"),
        mods: join(root, "mods"),
        shaders: join(root, "shaderpacks"),
        shaderConfigs: join(root, "shaderpacks"),
        resourcepacks: join(root, "resourcepacks"),
        options: join(root, "options.txt"),
        saves: join(root, "saves"),
        xaero: join(root, "xaero"),
        distantHorizons: join(root, "distant_horizons_server_data"),
    };
}

/** Validate that the Minecraft path looks correct */
export async function validateMinecraftPath(paths: MinecraftPaths): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!(await pathExists(paths.root))) {
        errors.push(`Root path does not exist: ${paths.root}`);
        return { valid: false, errors };
    }

    // Check for at least one recognizable Minecraft folder/file
    const hasOptions = await pathExists(paths.options);
    const hasMods = await pathExists(paths.mods);
    const hasShaders = await pathExists(paths.shaders);

    if (!hasOptions && !hasMods && !hasShaders) {
        errors.push("This doesn't look like a Minecraft installation folder.");
        errors.push("Expected to find at least one of: options.txt, mods/, shaderpacks/");
    }

    return { valid: errors.length === 0, errors };
}

/** Perform the backup operation */
export async function performBackup(
    mcPaths: MinecraftPaths,
    destRoot: string,
    options: BackupOptions
): Promise<BackupResult> {
    const backupStartTime = Date.now();
    const errors: string[] = [];
    const stats = {
        screenshotsCopied: 0,
        modsListed: 0,
        shadersListed: 0,
        shaderConfigsCopied: 0,
        resourcepacksListed: 0,
        savesCopied: 0,
        xaeroCopied: 0,
        distantHorizonsCopied: 0,
    };

    // Create timestamped backup folder
    const timestamp = generateTimestamp();
    const backupPath = join(normalizePath(destRoot), `backup_${timestamp}`);

    showProgress(`Creating backup folder: ${backupPath}`);
    await ensureDir(backupPath);

    // 1. Copy screenshots folder
    if (await pathExists(mcPaths.screenshots)) {
        showProgress("Copying screenshots...");
        try {
            stats.screenshotsCopied = await copyDir(mcPaths.screenshots, join(backupPath, "screenshots"));
            showProgress(`  Copied ${stats.screenshotsCopied} screenshots`);
        } catch (e) {
            errors.push(`Failed to copy screenshots: ${e}`);
        }
    } else {
        showProgress("No screenshots folder found, skipping.");
    }

    // 2. List mods to mods.txt
    if (await pathExists(mcPaths.mods)) {
        showProgress("Listing mods...");
        try {
            const mods = await listFiles(mcPaths.mods);
            const modDirs = await listDirs(mcPaths.mods);
            const allMods = [...mods, ...modDirs];
            stats.modsListed = allMods.length;
            await writeFile(join(backupPath, "mods.txt"), allMods.join("\n"));
            showProgress(`  Listed ${stats.modsListed} mods`);
        } catch (e) {
            errors.push(`Failed to list mods: ${e}`);
        }
    } else {
        showProgress("No mods folder found, skipping.");
    }

    // 3. List shaders to shaders.txt and copy configs
    if (await pathExists(mcPaths.shaders)) {
        showProgress("Processing shaderpacks...");
        try {
            const shaderFiles = await listFiles(mcPaths.shaders);
            const shaderDirs = await listDirs(mcPaths.shaders);

            // Separate config files (.txt) from actual shader packs
            const configFiles = shaderFiles.filter(f => f.endsWith(".txt"));
            const actualShaders = shaderFiles.filter(f => !f.endsWith(".txt"));

            // List only actual shaders (zip files and directories)
            const allShaders = [...actualShaders, ...shaderDirs];
            stats.shadersListed = allShaders.length;
            await writeFile(join(backupPath, "shaders.txt"), allShaders.join("\n"));
            showProgress(`  Listed ${stats.shadersListed} shaders`);

            // Copy shader config files (.txt files in shaderpacks root)
            const configsDestPath = join(backupPath, "shader_configs");
            await ensureDir(configsDestPath);

            for (const file of configFiles) {
                await copyFile(join(mcPaths.shaders, file), join(configsDestPath, file));
                stats.shaderConfigsCopied++;
            }

            if (stats.shaderConfigsCopied > 0) {
                showProgress(`  Copied ${stats.shaderConfigsCopied} shader config files`);
            }
        } catch (e) {
            errors.push(`Failed to process shaderpacks: ${e}`);
        }
    } else {
        showProgress("No shaderpacks folder found, skipping.");
    }

    // 4. List resourcepacks to resourcepacks.txt
    if (await pathExists(mcPaths.resourcepacks)) {
        showProgress("Listing resource packs...");
        try {
            const packs = await listFiles(mcPaths.resourcepacks);
            const packDirs = await listDirs(mcPaths.resourcepacks);
            const allPacks = [...packs, ...packDirs];
            stats.resourcepacksListed = allPacks.length;
            await writeFile(join(backupPath, "resourcepacks.txt"), allPacks.join("\n"));
            showProgress(`  Listed ${stats.resourcepacksListed} resource packs`);
        } catch (e) {
            errors.push(`Failed to list resource packs: ${e}`);
        }
    } else {
        showProgress("No resourcepacks folder found, skipping.");
    }

    // 5. Copy options.txt
    if (await pathExists(mcPaths.options)) {
        showProgress("Copying options.txt...");
        try {
            await copyFile(mcPaths.options, join(backupPath, "options.txt"));
        } catch (e) {
            errors.push(`Failed to copy options.txt: ${e}`);
        }
    } else {
        showProgress("No options.txt found, skipping.");
    }

    // 6. Copy saves folder (if enabled)
    if (options.includeSaves) {
        if (await pathExists(mcPaths.saves)) {
            showProgress("Copying worlds/saves (this may take a while)...");
            try {
                stats.savesCopied = await copyDir(mcPaths.saves, join(backupPath, "saves"));
                showProgress(`  Copied ${stats.savesCopied} save files`);
            } catch (e) {
                errors.push(`Failed to copy saves: ${e}`);
            }
        } else {
            showProgress("No saves folder found, skipping.");
        }
    }

    // 7. Copy Xaero's maps data (if enabled)
    if (options.includeXaero) {
        if (await pathExists(mcPaths.xaero)) {
            showProgress("Copying Xaero's maps data...");
            try {
                stats.xaeroCopied = await copyDir(mcPaths.xaero, join(backupPath, "xaero"));
                showProgress(`  Copied ${stats.xaeroCopied} Xaero map files`);
            } catch (e) {
                errors.push(`Failed to copy Xaero data: ${e}`);
            }
        } else {
            showProgress("No xaero folder found, skipping.");
        }
    }

    // 8. Copy Distant Horizons data (if enabled)
    if (options.includeDistantHorizons) {
        if (await pathExists(mcPaths.distantHorizons)) {
            showProgress("Copying Distant Horizons data...");
            try {
                stats.distantHorizonsCopied = await copyDir(mcPaths.distantHorizons, join(backupPath, "distant_horizons_server_data"));
                showProgress(`  Copied ${stats.distantHorizonsCopied} Distant Horizons files`);
            } catch (e) {
                errors.push(`Failed to copy Distant Horizons data: ${e}`);
            }
        } else {
            showProgress("No Distant Horizons folder found, skipping.");
        }
    }

    // 9. Generate info.md with comprehensive metadata
    showProgress("Generating info.md...");

    const backupEndTime = Date.now();
    const backupDuration = (backupEndTime - backupStartTime) / 1000;

    // Get Minecraft info
    const mcInfo = await getMinecraftInfo(mcPaths.root);

    // Get size info
    const backupSize = await getDirSize(backupPath);
    const modsSize = await getDirSize(mcPaths.mods);
    const savesSize = options.includeSaves ? await getDirSize(mcPaths.saves) : 0;

    // Get largest mods
    const largestMods = await getLargestItems(mcPaths.mods, 3);
    const largestModsStr = largestMods.length > 0
        ? largestMods.map(m => `  - ${m.name} (${formatBytes(m.size)})`).join("\n")
        : "  - None found";

    // Get largest saves if included
    let largestSavesStr = "";
    if (options.includeSaves) {
        const largestSaves = await getLargestItems(mcPaths.saves, 3);
        if (largestSaves.length > 0) {
            largestSavesStr = `
Save Statistics:
- World count: ${largestSaves.length}+ worlds
- Total size: ${formatBytes(savesSize)}
- Largest worlds:
${largestSaves.map(s => `  - ${s.name} (${formatBytes(s.size)})`).join("\n")}
`;
        }
    }

    // Calculate total files
    const totalFiles = stats.screenshotsCopied + stats.shaderConfigsCopied +
        stats.savesCopied + stats.xaeroCopied + stats.distantHorizonsCopied;

    const infoContent = `# 🗿 Totem Backup

> Generated on ${new Date().toLocaleString()}

---

## 📋 System Information

| Property | Value |
|----------|-------|
| Minecraft Version | ${mcInfo.version} |
| Mod Loader | ${mcInfo.loader}${mcInfo.loaderVersion !== "Unknown" ? ` (${mcInfo.loaderVersion})` : ""} |
| Operating System | ${getOSInfo()} |
| Totem Version | v1.0.0 |

---

## 📦 Backup Details

| Property | Value |
|----------|-------|
| Source Path | \`${mcPaths.root}\` |
| Backup Duration | ${formatDuration(backupDuration)} |
| Total Backup Size | ${formatBytes(backupSize)} |
| Total Files Copied | ${totalFiles.toLocaleString()} files |

---

## 📁 Contents

| Item | Count |
|------|-------|
| Screenshots | ${stats.screenshotsCopied} files |
| Mods | ${stats.modsListed} mods (${formatBytes(modsSize)} total) |
| Shaders | ${stats.shadersListed} shaders |
| Shader Configs | ${stats.shaderConfigsCopied} files |
| Resource Packs | ${stats.resourcepacksListed} packs |
| Saves | ${stats.savesCopied} files |
| Xaero Maps | ${stats.xaeroCopied} files |
| Distant Horizons | ${stats.distantHorizonsCopied} files |

---

## 📊 Mod Statistics

- **Total Mods:** ${stats.modsListed}
- **Total Size:** ${formatBytes(modsSize)}
- **Largest Mods:**
${largestModsStr}
${largestSavesStr}
---

## 🔧 Restoration Guide

### 1. Screenshots
Copy the \`screenshots/\` folder back to your minecraft folder.

### 2. Mods
Re-download mods listed in \`mods.txt\` from [Modrinth](https://modrinth.com) or [CurseForge](https://curseforge.com).

### 3. Shaders
- Re-download shaders listed in \`shaders.txt\`
- Copy \`shader_configs/\` contents to your \`shaderpacks/\` folder

### 4. Resource Packs
Re-download packs listed in \`resourcepacks.txt\`.

### 5. Options
Copy \`options.txt\` to your minecraft folder.

### 6. Saves (if included)
Copy the \`saves/\` folder back to your minecraft folder.

---

${errors.length > 0 ? `## ⚠️ Errors\n\n${errors.map(e => `- ${e}`).join("\n")}` : "## ✅ Status\n\nBackup completed successfully with no errors."}

---

*Generated by [Totem](https://github.com/vaalley/totem) - Minecraft Backup Utility*
`;
    await writeFile(join(backupPath, "info.md"), infoContent);

    // 7. Zip if requested
    if (options.zipOutput) {
        showProgress("Creating zip archive...");
        try {
            await createZip(backupPath, `${backupPath}.zip`);
            showProgress("Zip archive created successfully");

            // Remove the unzipped folder after zipping
            const fs = await import("fs/promises");
            await fs.rm(backupPath, { recursive: true });
        } catch (e) {
            errors.push(`Failed to create zip: ${e}`);
        }
    }

    return {
        success: errors.length === 0,
        outputPath: backupPath,
        errors,
        stats,
    };
}

/** Create a zip file from a directory using archiver (cross-platform) */
async function createZip(sourceDir: string, destZip: string): Promise<void> {
    const archiver = await import("archiver");
    const fs = await import("fs");

    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(destZip);
        const archive = archiver.default("zip", {
            zlib: { level: 9 }, // Maximum compression
        });

        output.on("close", () => {
            resolve();
        });

        archive.on("error", (err: Error) => {
            reject(err);
        });

        archive.pipe(output);

        // Add the entire directory contents
        archive.directory(sourceDir, false);

        archive.finalize();
    });
}

/** Open a folder in the system file explorer (cross-platform) */
export async function openFolder(folderPath: string): Promise<void> {
    const { platform } = process;

    let command: string;
    let args: string[];

    if (platform === "win32") {
        command = "explorer";
        args = [folderPath];
    } else if (platform === "darwin") {
        command = "open";
        args = [folderPath];
    } else {
        // Linux and others
        command = "xdg-open";
        args = [folderPath];
    }

    const proc = Bun.spawn([command, ...args], {
        stdout: "ignore",
        stderr: "ignore",
    });

    await proc.exited;
}
