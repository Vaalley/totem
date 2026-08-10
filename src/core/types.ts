export type FolderBackupMode = "manifest" | "full";

export interface FolderModes {
  mods: FolderBackupMode;
  resourcepacks: FolderBackupMode;
  shaderpacks: FolderBackupMode;
}

export interface BackupOptions {
  folderModes: FolderModes;
  includeSaves: boolean;
  customFolders: string[];
  zipOutput: boolean;
  openWhenDone: boolean;
}

export interface BackupRequest {
  minecraftPath: string;
  backupDestination: string;
  options: BackupOptions;
}

export type KnownCustomFolderId =
  | "xaero"
  | "distantHorizons"
  | "journeymap"
  | "voxelmap"
  | "mapwriter"
  | "litematica"
  | "replayRecordings";

export interface KnownCustomFolder {
  id: KnownCustomFolderId;
  label: string;
  folderName: string;
}

export interface MinecraftPaths {
  root: string;
  config: string;
  screenshots: string;
  mods: string;
  shaderpacks: string;
  resourcepacks: string;
  options: string;
  saves: string;
  xaero: string;
  distantHorizons: string;
  journeymap: string;
  voxelmap: string;
  mapwriter: string;
  litematica: string;
  replayRecordings: string;
}

export interface MinecraftInfo {
  version: string;
  loader: string;
  loaderVersion: string;
}

export interface BackupStats {
  screenshotsCopied: number;
  modsListed: number;
  modsCopied: number;
  shadersListed: number;
  shadersCopied: number;
  shaderConfigsCopied: number;
  resourcepacksListed: number;
  resourcepacksCopied: number;
  savesCopied: number;
  xaeroCopied: number;
  distantHorizonsCopied: number;
  journeymapCopied: number;
  voxelmapCopied: number;
  mapwriterCopied: number;
  litematicaCopied: number;
  replayRecordingsCopied: number;
  customFoldersCopied: number;
  customFolderFilesCopied?: Record<string, number>;
  totalEntriesListed: number;
  totalBytesListed: number;
  totalFilesCopied: number;
  totalBytesCopied: number;
}

export interface BackupProgress {
  phase:
    | "validating"
    | "preparing"
    | "screenshots"
    | "mods"
    | "shaders"
    | "resourcepacks"
    | "options"
    | "saves"
    | "xaero"
    | "distantHorizons"
    | "customFolders"
    | "metadata"
    | "archive"
    | "opening"
    | "complete";
  message: string;
  completedFiles: number;
  totalFiles?: number;
  stats: BackupStats;
}

export type ProgressReporter = (progress: BackupProgress) => void | Promise<void>;

export interface BackupResult {
  success: boolean;
  outputPath: string;
  directoryPath: string;
  errors: string[];
  stats: BackupStats;
  durationMs: number;
  minecraftInfo: MinecraftInfo;
}

export interface PathValidationResult {
  valid: boolean;
  path: string;
  errors: string[];
  warnings: string[];
  present: string[];
  missing: string[];
}

export interface DirectoryEntryInfo {
  name: string;
  kind: "file" | "directory";
  size: number;
}

/**
 * Recursive inventory and estimates for a selectable Minecraft folder.
 *
 * `fileCount`, `directoryCount`, and `totalBytes` describe the folder itself.
 * Manifest mode lists only immediate entries and copies the applicable config
 * payload, while full mode copies the complete selected payload.
 */
export interface FolderSummary {
  id: "mods" | "resourcepacks" | "shaderpacks" | "saves";
  name: string;
  path: string;
  present: true;
  fileCount: number;
  directoryCount: number;
  totalBytes: number;
  listedEntries: number;
  listedFiles: number;
  listedDirectories: number;
  manifestBytes: number;
  fullBytes: number;
  configFileCount: number;
  configDirectoryCount: number;
  configBytes: number;
  estimatedManifestBytes: number;
  estimatedFullBytes: number;
}

export type CustomFolderId = KnownCustomFolderId | `custom:${string}`;

export interface CustomFolderSummary {
  id: CustomFolderId;
  label: string;
  folderName: string;
  path: string;
  present: true;
  fileCount: number;
  directoryCount: number;
  totalBytes: number;
  estimatedFullBytes: number;
}

export interface MinecraftInspection {
  root: string;
  paths: MinecraftPaths;
  validation: PathValidationResult;
  folders: {
    mods?: FolderSummary;
    resourcepacks?: FolderSummary;
    shaderpacks?: FolderSummary;
  };
  saves?: FolderSummary;
  customFolders: CustomFolderSummary[];
}
