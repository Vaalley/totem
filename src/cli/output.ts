import type {
  BackupRequest,
  BackupResult,
  FolderBackupMode,
  PathValidationResult,
} from "../core/types.ts";
import { formatBytes, formatDuration } from "../core/format.ts";

const ANSI = {
  reset: "\u001b[0m",
  cyan: "\u001b[36m",
  green: "\u001b[32m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
};

function colorEnabled(): boolean {
  try {
    if (Deno.env.has("NO_COLOR") || Deno.env.get("TERM") === "dumb") return false;
    return Deno.stderr.isTerminal();
  } catch {
    return false;
  }
}

function paint(value: string, color: string, enabled = colorEnabled()): string {
  return enabled ? `${color}${value}${ANSI.reset}` : value;
}

export function renderBanner(useColor = colorEnabled()): string {
  const title = paint("TOTEM", ANSI.cyan, useColor);
  return [
    "",
    `  ${title}  Minecraft backup utility`,
    "  -------------------------------",
    "",
  ].join("\n");
}

function modeLabel(mode: FolderBackupMode): string {
  return mode === "full" ? "full folder" : "manifest + configs";
}

export function renderPreflight(
  request: BackupRequest,
  validation: PathValidationResult,
): string {
  const options = request.options;
  const lines = [
    "Preflight summary",
    `  Source:      ${request.minecraftPath}`,
    `  Destination: ${request.backupDestination}`,
    `  ZIP archive: ${yesNo(options.zipOutput)} (directory retained)`,
    `  Open when done: ${yesNo(options.openWhenDone)}`,
    `  Required paths present: ${validation.present.length}`,
  ];
  if (validation.present.includes("mods")) {
    lines.splice(4, 0, `  Mods:        ${modeLabel(options.folderModes.mods)}`);
  }
  if (validation.present.includes("resourcepacks")) {
    lines.splice(4, 0, `  Resourcepacks: ${modeLabel(options.folderModes.resourcepacks)}`);
  }
  if (validation.present.includes("shaderpacks")) {
    lines.splice(4, 0, `  Shaderpacks:  ${modeLabel(options.folderModes.shaderpacks)}`);
  }
  if (validation.present.includes("saves")) {
    lines.splice(
      4,
      0,
      `  Saves:       ${yesNo(options.includeSaves)}${
        options.includeSaves ? " (WARNING: sensitive world/player data)" : ""
      }`,
    );
  }
  if (options.customFolders.length) {
    lines.splice(4, 0, `  Custom folders: ${options.customFolders.join(", ")}`);
  }
  if (validation.missing.length) {
    lines.push(`  Optional paths missing: ${validation.missing.join(", ")}`);
  }
  for (const warning of validation.warnings) lines.push(`  Warning: ${warning}`);
  return lines.join("\n");
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

export function renderSuccess(result: BackupResult, request?: BackupRequest): string {
  const { stats } = result;
  const lines = [
    paint("Backup complete", ANSI.green),
    `  Output: ${result.outputPath}`,
    `  Directory: ${result.directoryPath}`,
    `  Files copied: ${stats.totalFilesCopied} (${formatBytes(stats.totalBytesCopied)})`,
    `  Screenshots: ${stats.screenshotsCopied}`,
    `  Mods: ${
      request ? modeLabel(request.options.folderModes.mods) + ", " : ""
    }${stats.modsListed} listed, ${stats.modsCopied} copied`,
    `  Resource packs: ${
      request ? modeLabel(request.options.folderModes.resourcepacks) + ", " : ""
    }${stats.resourcepacksListed} listed, ${stats.resourcepacksCopied} copied`,
    `  Shaders: ${
      request ? modeLabel(request.options.folderModes.shaderpacks) + ", " : ""
    }${stats.shadersListed} listed, ${stats.shadersCopied} copied`,
    `  Shader configs: ${stats.shaderConfigsCopied}`,
    `  Saves: ${stats.savesCopied}`,
    `  Custom folders: ${stats.customFoldersCopied}`,
    `  Source inventory: ${stats.totalEntriesListed} entries (${
      formatBytes(stats.totalBytesListed)
    })`,
    `  Duration: ${formatDuration(result.durationMs)}`,
  ];
  return lines.join("\n");
}

export function renderError(message: string | string[]): string {
  const errors = Array.isArray(message) ? message : [message];
  return [paint("Backup failed", ANSI.red), ...errors.map((error) => `  ${error}`)].join("\n");
}

export function renderCancellation(message = "Backup cancelled."): string {
  return paint(message, ANSI.yellow);
}

export function printBanner(): void {
  console.log(renderBanner());
}

export function printPreflight(request: BackupRequest, validation: PathValidationResult): void {
  console.log(renderPreflight(request, validation));
}

export function printSuccess(result: BackupResult, request?: BackupRequest): void {
  console.log(renderSuccess(result, request));
}

export function printError(message: string | string[]): void {
  console.error(renderError(message));
}

export function printCancellation(message?: string): void {
  console.error(renderCancellation(message));
}
