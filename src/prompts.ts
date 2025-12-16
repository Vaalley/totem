/**
 * Totem CLI - TUI Prompts
 * Using @inquirer/prompts for interactive UI
 */

import { checkbox, input } from "@inquirer/prompts";
import chalk from "chalk";
import { homedir } from "os";
import { join } from "path";
import type { BackupOptions } from "./types";

/** Display the welcome banner */
export function showBanner(): void {
    console.log("");
    console.log(chalk.cyan.bold("  ████████╗ ██████╗ ████████╗███████╗███╗   ███╗"));
    console.log(chalk.cyan.bold("  ╚══██╔══╝██╔═══██╗╚══██╔══╝██╔════╝████╗ ████║"));
    console.log(chalk.cyan.bold("     ██║   ██║   ██║   ██║   █████╗  ██╔████╔██║"));
    console.log(chalk.cyan.bold("     ██║   ██║   ██║   ██║   ██╔══╝  ██║╚██╔╝██║"));
    console.log(chalk.cyan.bold("     ██║   ╚██████╔╝   ██║   ███████╗██║ ╚═╝ ██║"));
    console.log(chalk.cyan.bold("     ╚═╝    ╚═════╝    ╚═╝   ╚══════╝╚═╝     ╚═╝"));
    console.log("");
    console.log(chalk.dim("     Minecraft Backup Utility v1.0"));
    console.log("");
    console.log(chalk.dim("  ─────────────────────────────────────────────"));
    console.log("");
}

/** Option keys for tracking selections */
type OptionKey = "zip" | "saves" | "xaero" | "distantHorizons" | "openWhenDone";

/** Display options checklist and get user selections */
export async function getBackupOptions(): Promise<BackupOptions> {
    console.log(chalk.blue.bold("  ⚙  Backup Options"));
    console.log(chalk.dim("     Use ↑↓ to move, space to toggle, enter to confirm"));
    console.log("");

    const selected = await checkbox<OptionKey>({
        message: "Select backup options:",
        choices: [
            { name: "Zip the backup folder", value: "zip" },
            {
                name: `Include worlds/saves ${chalk.yellow("(may be large!)")}`,
                value: "saves"
            },
            { name: "Include Xaero's map data", value: "xaero" },
            { name: "Include Distant Horizons data", value: "distantHorizons" },
            { name: "Open folder when done", value: "openWhenDone", checked: true },
        ],
        theme: {
            prefix: "    ",
        },
    });

    console.log("");

    return {
        zipOutput: selected.includes("zip"),
        includeSaves: selected.includes("saves"),
        includeXaero: selected.includes("xaero"),
        includeDistantHorizons: selected.includes("distantHorizons"),
        openWhenDone: selected.includes("openWhenDone"),
    };
}

/** Get the Minecraft installation path from user */
export async function getMinecraftPath(): Promise<string> {
    console.log(chalk.blue.bold("  📂  Minecraft Installation"));
    console.log(chalk.dim("     Enter the absolute path to your .minecraft folder"));
    console.log("");

    const path = await input({
        message: "Path:",
        theme: {
            prefix: "    ",
        },
    });

    return path.trim();
}

/** Get the default backup destination */
export function getDefaultBackupDestination(): string {
    return join(homedir(), "TotemBackups");
}

/** Get the backup destination path */
export async function getBackupDestination(): Promise<string> {
    const defaultPath = getDefaultBackupDestination();

    console.log("");
    console.log(chalk.blue.bold("  💾  Backup Destination"));
    console.log(chalk.dim("     Press Enter to use the default location"));
    console.log("");

    const path = await input({
        message: "Destination:",
        default: defaultPath,
        theme: {
            prefix: "    ",
        },
    });

    return path.trim() || defaultPath;
}

/** Show a success message */
export function showSuccess(outputPath: string, zipped: boolean): void {
    console.log("");
    console.log(chalk.green.bold("  ✓  Backup Complete!"));
    console.log("");
    console.log(chalk.dim("  ─────────────────────────────────────────────"));
    console.log("");
    console.log(`     ${chalk.bold("Output:")} ${outputPath}${zipped ? ".zip" : ""}`);
    console.log("");
}

/** Show an error message */
export function showError(message: string): void {
    console.error("");
    console.error(chalk.red.bold(`  ✗  Error: `) + message);
    console.error("");
}

/** Show progress message */
export function showProgress(message: string): void {
    console.log(`     ${chalk.magenta("→")} ${message}`);
}

/** Close prompts (no-op with @inquirer, but keep for compatibility) */
export function closePrompts(): void {
    // No cleanup needed with @inquirer/prompts
}
