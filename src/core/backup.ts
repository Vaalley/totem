import { basename, dirname, extname, join, resolve } from "@std/path";
import { createZipArchive } from "./archive.ts";
import { detectMinecraftInfo, generateInfoMarkdown } from "./metadata.ts";
import { inspectMinecraftInstance } from "./inspect.ts";
import { errorMessage, formatBytes } from "./format.ts";
import { absoluteUserPath, normalizeUserPath, pathsEqual, pathsOverlap } from "./paths.ts";
import type {
  BackupOptions,
  BackupProgress,
  BackupRequest,
  BackupResult,
  BackupStats,
  DirectoryEntryInfo,
  FolderBackupMode,
  FolderSummary,
  MinecraftInfo,
  MinecraftInspection,
  ProgressReporter,
} from "./types.ts";

const defaultInfo: MinecraftInfo = {
  version: "unknown",
  loader: "unknown",
  loaderVersion: "unknown",
};

export function generateTimestamp(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${
    pad(now.getUTCHours())
  }${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
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
    customFolderFilesCopied: { ...stats.customFolderFilesCopied },
  };
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
    errors.push(`Progress reporter failed: ${errorMessage(error)}`);
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
  if (sourceInfo.mtime !== null) {
    try {
      await Deno.utime(destination, sourceInfo.mtime, sourceInfo.mtime);
    } catch {
      // Timestamp fidelity must never fail the backup.
    }
  }
  stats.totalFilesCopied++;
  stats.totalBytesCopied += sourceInfo.size;
}

async function copyTree(
  source: string,
  destination: string,
  stats: BackupStats,
  onFile?: () => void | Promise<void>,
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
      await onFile?.();
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
  onFile?: () => void | Promise<void>,
): Promise<void> {
  try {
    const sourceInfo = await lstatIfPresent(source);
    if (sourceInfo) {
      rejectSymlink(source, sourceInfo);
      await copyTree(source, destination, stats, onFile);
    }
  } catch (error) {
    errors.push(`Unable to copy ${source}: ${errorMessage(error)}`);
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
    errors.push(`Unable to prepare backup destination: ${errorMessage(error)}`);
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
    errors.push(`Unable to list or write manifest for ${source}: ${errorMessage(error)}`);
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
        errors.push(`Unable to copy shader config ${config.name}: ${errorMessage(error)}`);
      }
    }
  } catch (error) {
    errors.push(`Unable to list shader configs: ${errorMessage(error)}`);
  }
}

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
  let lastPhase: BackupProgress | undefined;
  let lastReportAt = 0;
  const reportPhase = async (progress: BackupProgress): Promise<void> => {
    lastPhase = progress;
    lastReportAt = Date.now();
    await report(reporter, errors, progress);
  };
  const fileProgress = async (count: () => void): Promise<void> => {
    count();
    if (lastPhase && Date.now() - lastReportAt >= 250) {
      lastReportAt = Date.now();
      await report(reporter, errors, {
        ...lastPhase,
        completedFiles: stats.totalFilesCopied,
        stats,
      });
    }
  };

  await reportPhase({
    phase: "validating",
    message: "Inspecting Minecraft path",
    completedFiles: 0,
    stats,
  });
  try {
    inspection = request.inspection && pathsEqual(request.inspection.root, sourcePath)
      ? request.inspection
      : await inspectMinecraftInstance(sourcePath);
    errors.push(...inspection.validation.errors);
  } catch (error) {
    errors.push(`Unable to inspect Minecraft path: ${errorMessage(error)}`);
  }
  if (inspection?.validation.valid) {
    const sourceInfo = await lstatIfPresent(sourcePath).catch((error) => {
      errors.push(`Unable to inspect Minecraft source: ${errorMessage(error)}`);
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
      errors.push(`Unable to inspect backup destination: ${errorMessage(error)}`);
    }
    const destinationInfo = await statIfPresent(destinationPath).catch((error) => {
      errors.push(`Unable to inspect backup destination: ${errorMessage(error)}`);
      return undefined;
    });
    if (destinationInfo && !destinationInfo.isDirectory) {
      errors.push("Backup destination must be a directory");
    }
  }

  if (!inspection || errors.length > 0) {
    const durationMs = Date.now() - started;
    await reportPhase({
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

  await reportPhase({
    phase: "preparing",
    message: "Preparing backup directory",
    completedFiles: 0,
    stats,
  });
  const chosen = await chooseOutputDirectory(destinationPath, errors);
  if (!chosen) {
    const durationMs = Date.now() - started;
    await reportPhase({
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

  await reportPhase({
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
    () => fileProgress(() => stats.screenshotsCopied++),
  );

  const selectableFolders: Array<{
    summary: FolderSummary | undefined;
    sourcePath: string;
    destName: string;
    manifestName: string;
    phase: "mods" | "shaders" | "resourcepacks";
    listedField: "modsListed" | "shadersListed" | "resourcepacksListed";
    copiedField: "modsCopied" | "shadersCopied" | "resourcepacksCopied";
    mode: FolderBackupMode;
    fullLabel: string;
    manifestLabel: string;
    filter?: (entry: DirectoryEntryInfo) => boolean;
  }> = [
    {
      summary: inspection.folders.mods,
      sourcePath: paths.mods,
      destName: "mods",
      manifestName: "mods.txt",
      phase: "mods",
      listedField: "modsListed",
      copiedField: "modsCopied",
      mode: options.folderModes.mods,
      fullLabel: "Copying mods",
      manifestLabel: "Writing mod manifest",
    },
    {
      summary: inspection.folders.shaderpacks,
      sourcePath: paths.shaderpacks,
      destName: "shaderpacks",
      manifestName: "shaders.txt",
      phase: "shaders",
      listedField: "shadersListed",
      copiedField: "shadersCopied",
      mode: options.folderModes.shaderpacks,
      fullLabel: "Copying shaderpacks",
      manifestLabel: "Writing shader manifest",
      filter: (entry) => !(entry.kind === "file" && extname(entry.name).toLowerCase() === ".txt"),
    },
    {
      summary: inspection.folders.resourcepacks,
      sourcePath: paths.resourcepacks,
      destName: "resourcepacks",
      manifestName: "resourcepacks.txt",
      phase: "resourcepacks",
      listedField: "resourcepacksListed",
      copiedField: "resourcepacksCopied",
      mode: options.folderModes.resourcepacks,
      fullLabel: "Copying resourcepacks",
      manifestLabel: "Writing resource pack manifest",
    },
  ];
  for (const folder of selectableFolders) {
    const summary = folder.summary;
    if (!summary) continue;
    await reportPhase({
      phase: folder.phase,
      message: folder.mode === "full"
        ? `${folder.fullLabel} (${formatBytes(summary.estimatedFullBytes)})`
        : `${folder.manifestLabel} (${formatBytes(summary.estimatedManifestBytes)})`,
      completedFiles: stats.totalFilesCopied,
      totalFiles: summary.fileCount,
      stats,
    });
    await backupSelectableFolder(
      folder.sourcePath,
      join(directoryPath, folder.destName),
      summary,
      folder.mode,
      folder.manifestName,
      stats,
      errors,
      (count) => stats[folder.listedField] = count,
      () => fileProgress(() => stats[folder.copiedField]++),
      folder.filter,
    );
    if (folder.phase === "mods") {
      await copyRootConfig(paths.config, join(directoryPath, "config"), stats, errors);
    }
    if (folder.phase === "shaders" && folder.mode === "manifest") {
      await copyShaderConfigs(
        paths.shaderpacks,
        join(directoryPath, "shader-configs"),
        stats,
        errors,
      );
    }
  }

  await reportPhase({
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
    errors.push(`Unable to copy options.txt: ${errorMessage(error)}`);
  }

  if (options.includeSaves && inspection.saves) {
    await reportPhase({
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
      () => fileProgress(() => stats.savesCopied++),
    );
  }

  const selectedCustomFolders = new Set(options.customFolders);
  for (const summary of inspection.customFolders) {
    if (!selectedCustomFolders.has(summary.id)) continue;
    await reportPhase({
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
    await copyOptionalTree(
      summary.path,
      join(directoryPath, summary.folderName),
      stats,
      errors,
      () =>
        fileProgress(() => {
          stats.customFoldersCopied++;
          stats.customFolderFilesCopied[summary.id] =
            (stats.customFolderFilesCopied[summary.id] ?? 0) + 1;
        }),
    );
  }

  await reportPhase({
    phase: "metadata",
    message: "Writing metadata",
    completedFiles: stats.totalFilesCopied,
    stats,
  });
  try {
    info = await detectMinecraftInfo(sourcePath);
  } catch (error) {
    errors.push(`Unable to detect Minecraft information: ${errorMessage(error)}`);
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
    errors.push(`Unable to write metadata: ${errorMessage(error)}`);
  }

  if (options.zipOutput) {
    await reportPhase({
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
      errors.push(`Unable to create archive: ${errorMessage(error)}`);
    }
  }

  const durationMs = Date.now() - started;
  await reportPhase({
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
