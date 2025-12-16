/**
 * Totem CLI - Utility Functions
 */

import { join, normalize, basename } from "path";
import cliProgress from "cli-progress";
import chalk from "chalk";

/** Normalize a path to work on both Windows and Unix */
export function normalizePath(inputPath: string): string {
    // Remove quotes if present
    const cleaned = inputPath.trim().replace(/^["']|["']$/g, "");

    // Normalize the path
    return normalize(cleaned);
}

/** Generate a timestamp string for backup folder naming */
export function generateTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");

    return `${year}-${month}-${day}_${hours}-${minutes}`;
}

/** Ensure a directory exists, creating it if necessary */
export async function ensureDir(path: string): Promise<void> {
    const fs = await import("fs/promises");
    try {
        await fs.mkdir(path, { recursive: true });
    } catch (error: unknown) {
        if (error instanceof Error && "code" in error && error.code !== "EEXIST") {
            throw error;
        }
    }
}

/** Count files recursively in a directory */
export async function countFiles(dirPath: string): Promise<number> {
    const fs = await import("fs/promises");
    let count = 0;

    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.isDirectory()) {
                count += await countFiles(join(dirPath, entry.name));
            } else {
                count++;
            }
        }
    } catch {
        return 0;
    }

    return count;
}

/** List files in a directory, returning just the filenames */
export async function listFiles(dirPath: string): Promise<string[]> {
    const fs = await import("fs/promises");
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    } catch {
        return [];
    }
}

/** List directories in a directory, returning just the names */
export async function listDirs(dirPath: string): Promise<string[]> {
    const fs = await import("fs/promises");
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
    } catch {
        return [];
    }
}

/** Check if a path exists */
export async function pathExists(path: string): Promise<boolean> {
    const fs = await import("fs/promises");
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}

/** Copy a file from source to destination */
export async function copyFile(src: string, dest: string): Promise<void> {
    const fs = await import("fs/promises");
    await fs.copyFile(src, dest);
}

/** Copy an entire directory recursively (internal, no progress bar) */
async function copyDirInternal(
    src: string,
    dest: string,
    progressBar?: cliProgress.SingleBar
): Promise<number> {
    const fs = await import("fs/promises");
    let count = 0;

    await ensureDir(dest);

    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = join(src, entry.name);
        const destPath = join(dest, entry.name);

        if (entry.isDirectory()) {
            count += await copyDirInternal(srcPath, destPath, progressBar);
        } else {
            await fs.copyFile(srcPath, destPath);
            count++;
            if (progressBar) {
                progressBar.increment();
            }
        }
    }

    return count;
}

/** Copy an entire directory recursively with progress bar */
export async function copyDir(
    src: string,
    dest: string,
    showProgress = true
): Promise<number> {
    if (!showProgress) {
        return copyDirInternal(src, dest);
    }

    // Count total files first
    const totalFiles = await countFiles(src);

    if (totalFiles === 0) {
        return 0;
    }

    // Create progress bar
    const progressBar = new cliProgress.SingleBar(
        {
            format: `     ${chalk.cyan("{bar}")} {percentage}% | {value}/{total} files`,
            barCompleteChar: "█",
            barIncompleteChar: "░",
            hideCursor: true,
        },
        cliProgress.Presets.shades_classic
    );

    progressBar.start(totalFiles, 0);

    const count = await copyDirInternal(src, dest, progressBar);

    progressBar.stop();

    return count;
}

/** Read a file as text */
export async function readFile(path: string): Promise<string> {
    const file = Bun.file(path);
    return await file.text();
}

/** Write text to a file */
export async function writeFile(path: string, content: string): Promise<void> {
    await Bun.write(path, content);
}

/** Get the base name of a path */
export function getBasename(path: string): string {
    return basename(path);
}

/** Get the total size of a directory in bytes */
export async function getDirSize(dirPath: string): Promise<number> {
    const fs = await import("fs/promises");
    let size = 0;

    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const entryPath = join(dirPath, entry.name);
            if (entry.isDirectory()) {
                size += await getDirSize(entryPath);
            } else {
                const stat = await fs.stat(entryPath);
                size += stat.size;
            }
        }
    } catch {
        return 0;
    }

    return size;
}

/** Format bytes to human-readable string */
export function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";

    const units = ["B", "KB", "MB", "GB", "TB"];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const unit = units[i] ?? "TB";

    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${unit}`;
}

/** Get Minecraft version info from the installation */
export async function getMinecraftInfo(
    mcRoot: string
): Promise<{ version: string; loader: string; loaderVersion: string }> {
    const fs = await import("fs/promises");

    let version = "Unknown";
    let loader = "Unknown";
    let loaderVersion = "Unknown";

    try {
        // Check mods folder for loader indicators
        const modsPath = join(mcRoot, "mods");
        if (await pathExists(modsPath)) {
            const mods = await fs.readdir(modsPath);
            if (mods.some((m) => m.toLowerCase().includes("fabric"))) {
                loader = "Fabric";
            } else if (mods.some((m) => m.toLowerCase().includes("forge"))) {
                loader = "Forge";
            } else if (mods.some((m) => m.toLowerCase().includes("quilt"))) {
                loader = "Quilt";
            }
        }

        // Try to get version from instance config (Prism/MultiMC)
        const instanceCfgPath = join(mcRoot, "..", "instance.cfg");
        if (await pathExists(instanceCfgPath)) {
            const cfg = await fs.readFile(instanceCfgPath, "utf-8");
            const versionMatch = cfg.match(/IntendedVersion=(.+)/);
            if (versionMatch?.[1]) {
                version = versionMatch[1].trim();
            }
        }

        // Try mmc-pack.json (MultiMC/Prism)
        const mmcPackPath = join(mcRoot, "..", "mmc-pack.json");
        if (await pathExists(mmcPackPath)) {
            const mmcData = JSON.parse(await fs.readFile(mmcPackPath, "utf-8"));
            const mcComponent = mmcData.components?.find(
                (c: { uid: string }) => c.uid === "net.minecraft"
            );
            if (mcComponent?.version) {
                version = mcComponent.version;
            }

            const fabricComponent = mmcData.components?.find(
                (c: { uid: string }) => c.uid === "net.fabricmc.fabric-loader"
            );
            if (fabricComponent) {
                loader = "Fabric";
                loaderVersion = fabricComponent.version || "Unknown";
            }

            const forgeComponent = mmcData.components?.find(
                (c: { uid: string }) => c.uid === "net.minecraftforge"
            );
            if (forgeComponent) {
                loader = "Forge";
                loaderVersion = forgeComponent.version || "Unknown";
            }
        }
    } catch {
        // Ignore errors, return defaults
    }

    return { version, loader, loaderVersion };
}

/** Get OS info */
export function getOSInfo(): string {
    const { platform, arch } = process;

    const platformNames: Record<string, string> = {
        win32: "Windows",
        darwin: "macOS",
        linux: "Linux",
    };

    return `${platformNames[platform] || platform} (${arch})`;
}

/** Get largest files/folders in a directory */
export async function getLargestItems(
    dirPath: string,
    limit = 3
): Promise<Array<{ name: string; size: number }>> {
    const fs = await import("fs/promises");
    const items: Array<{ name: string; size: number }> = [];

    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const entryPath = join(dirPath, entry.name);
            let size: number;

            if (entry.isDirectory()) {
                size = await getDirSize(entryPath);
            } else {
                const stat = await fs.stat(entryPath);
                size = stat.size;
            }

            items.push({ name: entry.name, size });
        }
    } catch {
        return [];
    }

    return items.sort((a, b) => b.size - a.size).slice(0, limit);
}

/** Format duration in seconds to human-readable */
export function formatDuration(seconds: number): string {
    if (seconds < 60) {
        return `${seconds.toFixed(1)} seconds`;
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
}

