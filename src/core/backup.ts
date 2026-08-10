import { basename, dirname, extname, join, resolve } from "@std/path";
import { createZipArchive } from "./archive.ts";
import { detectMinecraftInfo, generateInfoMarkdown } from "./metadata.ts";
import { inspectMinecraftInstance } from "./inspect.ts";
import { absoluteUserPath, normalizeUserPath, pathsOverlap } from "./paths.ts";
import type {
  BackupOptions,
  BackupProgress,
  BackupRequest,
  BackupResult,
  BackupStats,
  DirectoryEntryInfo,
  FolderBackupMode,
  FolderSummary,
  KnownCustomFolderId,
  MinecraftInfo,
  MinecraftInspection,
  ProgressReporter,
} from "./types.ts";

const defaultInfo: MinecraftInfo = {
  version: "unknown",
  loader: "unknown",
  loaderVersion: "unknown",
};

export { buildMinecraftPaths } from "./paths.ts";
export { inspectMinecraftPath as validateMinecraftPath } from "./inspect.ts";
export { normalizeUserPath } from "./paths.ts";

export function generateTimestamp(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${
    pad(now.getUTCHours())
  }${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || Number.isInteger(value) ? 0 : 1)} ${units[unit]}`;
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0ms";
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
}

function emptyStats(): BackupStats {
  return {
    screenshotsCopied: 0,
    modsListed: 0,
    modsCopied: 0,
    shadersListed: 0,
    shadersCopied: 0,
    shaderConfigsCopied: 0,
    resourcepacksListed: 0,
    resourcepacksCopied: 0,
    savesCopied: 0,
    xaeroCopied: 0,
    distantHorizonsCopied: 0,
    journeymapCopied: 0,
    voxelmapCopied: 0,
    mapwriterCopied: 0,
    litematicaCopied: 0,
    replayRecordingsCopied: 0,
    customFoldersCopied: 0,
    customFolderFilesCopied: {},
    totalEntriesListed: 0,
    totalBytesListed: 0,
    totalFilesCopied: 0,
    totalBytesCopied: 0,
  };
}

function copyStats(stats: BackupStats): BackupStats {
  return {
    ...stats,
    customFolderFilesCopied: stats.customFolderFilesCopied
      ? { ...stats.customFolderFilesCopied }
      : undefined,
  };
}

function asError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function report(
  reporter: ProgressReporter | undefined,
  errors: string[],
  progress: BackupProgress,
): Promise<void> {
  if (!reporter) return;
  try {
    await reporter({ ...progress, stats: copyStats(progress.stats) });
  } catch (error) {
    errors.push(`Progress reporter failed: ${asError(error)}`);
  }
}

async function statIfPresent(path: string): Promise<Deno.FileInfo | undefined> {
  try {
    return await Deno.stat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

async function canonicalDestinationPath(path: string): Promise<string> {
  const absolute = absoluteUserPath(path);
  const missing: string[] = [];
  let current = absolute;
  while (true) {
    try {
      const canonical = await Deno.realPath(current);
      return missing.reduce((result, part) => join(result, part), canonical);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      missing.unshift(basename(current));
      current = parent;
    }
  }
}

async function canonicalPathsOverlap(source: string, destination: string): Promise<boolean> {
  const canonicalSource = await Deno.realPath(absoluteUserPath(source));
  const canonicalDestination = await canonicalDestinationPath(destination);
  const caseInsensitive = Deno.build.os === "windows" || Deno.build.os === "darwin";
  return pathsOverlap(
    caseInsensitive ? canonicalSource.toLowerCase() : canonicalSource,
    caseInsensitive ? canonicalDestination.toLowerCase() : canonicalDestination,
  );
}

async function lstatIfPresent(path: string): Promise<Deno.FileInfo | undefined> {
  try {
    return await Deno.lstat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

function rejectSymlink(path: string, info: Deno.FileInfo): void {
  if (info.isSymlink) throw new Error(`Refusing to copy symbolic link: ${path}`);
}

async function copyOneFile(source: string, destination: string, stats: BackupStats): Promise<void> {
  const sourceInfo = await Deno.lstat(source);
  rejectSymlink(source, sourceInfo);
  if (!sourceInfo.isFile) throw new Error(`Expected a file: ${source}`);
  await Deno.mkdir(resolve(destination, ".."), { recursive: true });
  await Deno.copyFile(source, destination);
  stats.totalFilesCopied++;
  stats.totalBytesCopied += sourceInfo.size;
}

async function copyTree(
  source: string,
  destination: string,
  stats: BackupStats,
  onFile?: () => void,
): Promise<number> {
  const info = await Deno.lstat(source);
  rejectSymlink(source, info);
  if (!info.isDirectory) throw new Error(`Expected a directory: ${source}`);
  await Deno.mkdir(destination, { recursive: true });
  let copied = 0;
  for await (const entry of Deno.readDir(source)) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isSymlink) {
      throw new Error(`Refusing to copy symbolic link: ${from}`);
    } else if (entry.isDirectory) {
      copied += await copyTree(from, to, stats, onFile);
    } else if (entry.isFile) {
      await copyOneFile(from, to, stats);
      copied++;
      onFile?.();
    } else {
      throw new Error(`Unsupported directory entry: ${from}`);
    }
  }

  return copied;
}

async function immediateEntries(path: string): Promise<DirectoryEntryInfo[]> {
  const rootInfo = await Deno.lstat(path);
  rejectSymlink(path, rootInfo);
  if (!rootInfo.isDirectory) throw new Error(`Expected a directory: ${path}`);
  const entries: DirectoryEntryInfo[] = [];
  for await (const entry of Deno.readDir(path)) {
    const entryPath = join(path, entry.name);
    if (entry.isSymlink) {
      throw new Error(`Refusing to list symbolic link: ${entryPath}`);
    } else if (entry.isDirectory) {
      entries.push({ name: entry.name, kind: "directory", size: 0 });
    } else if (entry.isFile) {
      const info = await Deno.lstat(entryPath);
      rejectSymlink(entryPath, info);
      entries.push({ name: entry.name, kind: "file", size: info.size });
    }
  }
  entries.sort((left, right) => {
    const a = left.name.toLowerCase();
    const b = right.name.toLowerCase();
    return a === b
      ? (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
      : (a < b ? -1 : 1);
  });
  return entries;
}

async function writeTextFile(path: string, content: string, stats: BackupStats): Promise<void> {
  const bytes = new TextEncoder().encode(content);
  await Deno.mkdir(resolve(path, ".."), { recursive: true });
  await Deno.writeFile(path, bytes);
  stats.totalFilesCopied++;
  stats.totalBytesCopied += bytes.byteLength;
}

async function copyOptionalTree(
  source: string,
  destination: string,
  stats: BackupStats,
  errors: string[],
  onFile?: () => void,
): Promise<void> {
  try {
    const sourceInfo = await lstatIfPresent(source);
    if (sourceInfo) {
      rejectSymlink(source, sourceInfo);
      await copyTree(source, destination, stats, onFile);
    }
  } catch (error) {
    errors.push(`Unable to copy ${source}: ${asError(error)}`);
  }
}

async function chooseOutputDirectory(
  destination: string,
  errors: string[],
): Promise<string | undefined> {
  try {
    const info = await statIfPresent(destination);
    if (info && !info.isDirectory) {
      errors.push(`Backup destination is not a directory: ${destination}`);
      return undefined;
    }
    await Deno.mkdir(destination, { recursive: true });
    const timestamp = generateTimestamp();
    for (let suffix = 0; suffix < 10_000; suffix++) {
      const name = `totem-backup-${timestamp}${suffix ? `-${suffix}` : ""}`;
      const candidate = join(destination, name);
      try {
        await Deno.mkdir(candidate);
        return candidate;
      } catch (error) {
        if (error instanceof Deno.errors.AlreadyExists) continue;
        throw error;
      }
    }
    throw new Error("Unable to choose a collision-safe backup directory name");
  } catch (error) {
    errors.push(`Unable to prepare backup destination: ${asError(error)}`);
    return undefined;
  }
}

async function manifestFor(
  source: string,
  destination: string,
  stats: BackupStats,
  errors: string[],
  filter?: (entry: DirectoryEntryInfo) => boolean,
): Promise<DirectoryEntryInfo[]> {
  try {
    const entries = (await immediateEntries(source)).filter((entry) => filter?.(entry) ?? true);
    await writeTextFile(
      destination,
      entries.map((entry) => entry.name).join("\n") + (entries.length ? "\n" : ""),
      stats,
    );
    return entries;
  } catch (error) {
    errors.push(`Unable to list or write manifest for ${source}: ${asError(error)}`);
    return [];
  }
}

function addListedStats(
  stats: BackupStats,
  summary: FolderSummary,
  entries: DirectoryEntryInfo[],
): void {
  stats.totalEntriesListed += entries.length;
  stats.totalBytesListed += summary.manifestBytes;
}

async function copyShaderConfigs(
  source: string,
  destination: string,
  stats: BackupStats,
  errors: string[],
): Promise<void> {
  try {
    const entries = (await immediateEntries(source)).filter(
      (entry) => entry.kind === "file" && extname(entry.name).toLowerCase() === ".txt",
    );
    for (const config of entries) {
      try {
        await copyOneFile(join(source, config.name), join(destination, config.name), stats);
        stats.shaderConfigsCopied++;
      } catch (error) {
        errors.push(`Unable to copy shader config ${config.name}: ${asError(error)}`);
      }
    }
  } catch (error) {
    errors.push(`Unable to list shader configs: ${asError(error)}`);
  }
}

const customCounterById: Record<KnownCustomFolderId, keyof BackupStats> = {
  xaero: "xaeroCopied",
  distantHorizons: "distantHorizonsCopied",
  journeymap: "journeymapCopied",
  voxelmap: "voxelmapCopied",
  mapwriter: "mapwriterCopied",
  litematica: "litematicaCopied",
  replayRecordings: "replayRecordingsCopied",
};

async function backupSelectableFolder(
  source: string,
  destination: string,
  summary: FolderSummary,
  mode: FolderBackupMode,
  manifestName: string,
  stats: BackupStats,
  errors: string[],
  listed: (count: number) => void,
  copied: () => void,
  filter?: (entry: DirectoryEntryInfo) => boolean,
): Promise<void> {
  if (mode === "full") {
    await copyOptionalTree(source, destination, stats, errors, copied);
    return;
  }
  const entries = await manifestFor(
    source,
    join(dirname(destination), manifestName),
    stats,
    errors,
    filter,
  );
  listed(entries.length);
  addListedStats(stats, summary, entries);
}

async function copyRootConfig(
  source: string,
  destination: string,
  stats: BackupStats,
  errors: string[],
): Promise<void> {
  await copyOptionalTree(source, destination, stats, errors);
}

export async function performBackup(
  request: BackupRequest,
  reporter?: ProgressReporter,
): Promise<BackupResult> {
  const started = Date.now();
  const stats = emptyStats();
  const errors: string[] = [];
  let info: MinecraftInfo = { ...defaultInfo };
  let directoryPath = "";
  let outputPath = "";
  const sourcePath = normalizeUserPath(request.minecraftPath);
  const destinationPath = normalizeUserPath(request.backupDestination);
  const options: BackupOptions = request.options;
  let inspection: MinecraftInspection | undefined;

  await report(reporter, errors, {
    phase: "validating",
    message: "Inspecting Minecraft path",
    completedFiles: 0,
    stats,
  });
  try {
    inspection = await inspectMinecraftInstance(sourcePath);
    errors.push(...inspection.validation.errors);
  } catch (error) {
    errors.push(`Unable to inspect Minecraft path: ${asError(error)}`);
  }
  if (inspection?.validation.valid) {
    const sourceInfo = await lstatIfPresent(sourcePath).catch((error) => {
      errors.push(`Unable to inspect Minecraft source: ${asError(error)}`);
      return undefined;
    });
    if (sourceInfo?.isSymlink) {
      errors.push("Minecraft source must not be a symbolic link");
    }
    try {
      if (await canonicalPathsOverlap(sourcePath, destinationPath)) {
        errors.push("Minecraft source and backup destination must not overlap");
      }
    } catch (error) {
      errors.push(`Unable to inspect backup destination: ${asError(error)}`);
    }
    const destinationInfo = await statIfPresent(destinationPath).catch((error) => {
      errors.push(`Unable to inspect backup destination: ${asError(error)}`);
      return undefined;
    });
    if (destinationInfo && !destinationInfo.isDirectory) {
      errors.push("Backup destination must be a directory");
    }
  }

  if (!inspection || errors.length > 0) {
    const durationMs = Date.now() - started;
    await report(reporter, errors, {
      phase: "complete",
      message: "Backup rejected",
      completedFiles: 0,
      stats,
    });
    return {
      success: false,
      outputPath,
      directoryPath,
      errors,
      stats,
      durationMs,
      minecraftInfo: info,
    };
  }

  await report(reporter, errors, {
    phase: "preparing",
    message: "Preparing backup directory",
    completedFiles: 0,
    stats,
  });
  const chosen = await chooseOutputDirectory(destinationPath, errors);
  if (!chosen) {
    const durationMs = Date.now() - started;
    await report(reporter, errors, {
      phase: "complete",
      message: "Backup failed",
      completedFiles: 0,
      stats,
    });
    return {
      success: false,
      outputPath,
      directoryPath,
      errors,
      stats,
      durationMs,
      minecraftInfo: info,
    };
  }
  directoryPath = chosen;
  outputPath = directoryPath;
  const paths = inspection.paths;

  await report(reporter, errors, {
    phase: "screenshots",
    message: "Copying screenshots",
    completedFiles: stats.totalFilesCopied,
    stats,
  });
  await copyOptionalTree(
    paths.screenshots,
    join(directoryPath, "screenshots"),
    stats,
    errors,
    () => {
      stats.screenshotsCopied++;
    },
  );

  const mods = inspection.folders.mods;
  if (mods) {
    await report(reporter, errors, {
      phase: "mods",
      message: options.folderModes.mods === "full"
        ? `Copying mods (${formatBytes(mods.estimatedFullBytes)})`
        : `Writing mod manifest (${formatBytes(mods.estimatedManifestBytes)})`,
      completedFiles: stats.totalFilesCopied,
      totalFiles: mods.fileCount,
      stats,
    });
    await backupSelectableFolder(
      paths.mods,
      join(directoryPath, "mods"),
      mods,
      options.folderModes.mods,
      "mods.txt",
      stats,
      errors,
      (count) => stats.modsListed = count,
      () => stats.modsCopied++,
    );
    await copyRootConfig(paths.config, join(directoryPath, "config"), stats, errors);
  }

  const shaders = inspection.folders.shaderpacks;
  if (shaders) {
    await report(reporter, errors, {
      phase: "shaders",
      message: options.folderModes.shaderpacks === "full"
        ? `Copying shaderpacks (${formatBytes(shaders.estimatedFullBytes)})`
        : `Writing shader manifest (${formatBytes(shaders.estimatedManifestBytes)})`,
      completedFiles: stats.totalFilesCopied,
      totalFiles: shaders.fileCount,
      stats,
    });
    await backupSelectableFolder(
      paths.shaderpacks,
      join(directoryPath, "shaderpacks"),
      shaders,
      options.folderModes.shaderpacks,
      "shaders.txt",
      stats,
      errors,
      (count) => stats.shadersListed = count,
      () => stats.shadersCopied++,
      (entry) => !(entry.kind === "file" && extname(entry.name).toLowerCase() === ".txt"),
    );
    if (options.folderModes.shaderpacks === "manifest") {
      await copyShaderConfigs(
        paths.shaderpacks,
        join(directoryPath, "shader-configs"),
        stats,
        errors,
      );
    }
  }

  const resourcepacks = inspection.folders.resourcepacks;
  if (resourcepacks) {
    await report(reporter, errors, {
      phase: "resourcepacks",
      message: options.folderModes.resourcepacks === "full"
        ? `Copying resourcepacks (${formatBytes(resourcepacks.estimatedFullBytes)})`
        : `Writing resource pack manifest (${formatBytes(resourcepacks.estimatedManifestBytes)})`,
      completedFiles: stats.totalFilesCopied,
      totalFiles: resourcepacks.fileCount,
      stats,
    });
    await backupSelectableFolder(
      paths.resourcepacks,
      join(directoryPath, "resourcepacks"),
      resourcepacks,
      options.folderModes.resourcepacks,
      "resourcepacks.txt",
      stats,
      errors,
      (count) => stats.resourcepacksListed = count,
      () => stats.resourcepacksCopied++,
    );
  }

  await report(reporter, errors, {
    phase: "options",
    message: "Copying options",
    completedFiles: stats.totalFilesCopied,
    stats,
  });
  try {
    if (await statIfPresent(paths.options)) {
      await copyOneFile(paths.options, join(directoryPath, "options.txt"), stats);
    }
  } catch (error) {
    errors.push(`Unable to copy options.txt: ${asError(error)}`);
  }

  if (options.includeSaves && inspection.saves) {
    await report(reporter, errors, {
      phase: "saves",
      message: `Copying saves (${formatBytes(inspection.saves.estimatedFullBytes)})`,
      completedFiles: stats.totalFilesCopied,
      totalFiles: inspection.saves.fileCount,
      stats,
    });
    await copyOptionalTree(
      paths.saves,
      join(directoryPath, "saves"),
      stats,
      errors,
      () => stats.savesCopied++,
    );
  }

  const selectedCustomFolders = new Set(options.customFolders);
  for (const summary of inspection.customFolders) {
    if (!selectedCustomFolders.has(summary.id)) continue;
    await report(reporter, errors, {
      phase: "customFolders",
      message: `Copying ${summary.label} (${formatBytes(summary.estimatedFullBytes)})`,
      completedFiles: stats.totalFilesCopied,
      totalFiles: summary.fileCount,
      stats,
    });
    if (
      !summary.folderName ||
      summary.folderName === "." ||
      summary.folderName === ".." ||
      (Deno.build.os === "windows"
        ? /[\\/]/.test(summary.folderName)
        : /\//.test(summary.folderName))
    ) {
      errors.push(`Unable to copy custom folder ${summary.label}: invalid folder name`);
      continue;
    }
    const counter = Object.prototype.hasOwnProperty.call(customCounterById, summary.id)
      ? customCounterById[summary.id as KnownCustomFolderId]
      : undefined;
    await copyOptionalTree(
      summary.path,
      join(directoryPath, summary.folderName),
      stats,
      errors,
      () => {
        if (counter) stats[counter]++;
        stats.customFoldersCopied++;
        if (stats.customFolderFilesCopied) {
          stats.customFolderFilesCopied[summary.id] =
            (stats.customFolderFilesCopied[summary.id] ?? 0) + 1;
        }
      },
    );
  }

  await report(reporter, errors, {
    phase: "metadata",
    message: "Writing metadata",
    completedFiles: stats.totalFilesCopied,
    stats,
  });
  try {
    info = await detectMinecraftInfo(sourcePath);
  } catch (error) {
    errors.push(`Unable to detect Minecraft information: ${asError(error)}`);
  }
  try {
    await generateInfoMarkdown({
      backupPath: directoryPath,
      sourcePath,
      version: info.version,
      info,
      stats,
      durationMs: Date.now() - started,
      errors: [...errors],
      options,
      customFolders: inspection.customFolders,
    });
    const metadataPath = join(directoryPath, "info.md");
    const metadataInfo = await statIfPresent(metadataPath);
    if (metadataInfo?.isFile) {
      stats.totalFilesCopied++;
      stats.totalBytesCopied += metadataInfo.size;
    }
  } catch (error) {
    errors.push(`Unable to write metadata: ${asError(error)}`);
  }

  if (options.zipOutput) {
    await report(reporter, errors, {
      phase: "archive",
      message: "Creating archive",
      completedFiles: stats.totalFilesCopied,
      stats,
    });
    const archivePath = `${directoryPath}.zip`;
    try {
      await createZipArchive(directoryPath, archivePath);
      outputPath = archivePath;
    } catch (error) {
      errors.push(`Unable to create archive: ${asError(error)}`);
    }
  }

  const durationMs = Date.now() - started;
  await report(reporter, errors, {
    phase: "complete",
    message: errors.length ? "Backup completed with errors" : "Backup complete",
    completedFiles: stats.totalFilesCopied,
    stats,
  });
  return {
    success: errors.length === 0,
    outputPath,
    directoryPath,
    errors,
    stats,
    durationMs,
    minecraftInfo: info,
  };
}
