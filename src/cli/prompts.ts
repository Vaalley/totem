import { Checkbox, Confirm, Input, prompt, type PromptOptions, Select } from "@cliffy/prompt";
import type {
  BackupOptions,
  BackupRequest,
  FolderBackupMode,
  FolderSummary,
  MinecraftInspection,
} from "../core/types.ts";
import { inspectMinecraftInstance } from "../core/inspect.ts";
import { formatBytes } from "../core/format.ts";
import { normalizeUserPath } from "../core/paths.ts";

type PromptQuestion<
  TPrompt extends typeof Checkbox | typeof Confirm | typeof Input | typeof Select,
> = PromptOptions<string, TPrompt>;

export const DEFAULT_BACKUP_OPTIONS: BackupOptions = {
  folderModes: {
    mods: "manifest",
    resourcepacks: "manifest",
    shaderpacks: "manifest",
  },
  includeSaves: false,
  customFolders: [],
  zipOutput: false,
  openWhenDone: true,
};

export interface PromptDefaults {
  minecraftPath?: string;
  backupDestination?: string;
}

function homeDirectory(): string {
  try {
    const home = Deno.build.os === "windows"
      ? Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME")
      : Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
    if (home && home.trim()) return home;
  } catch {
    // Environment access can be denied; the current directory is a safe fallback.
  }
  return ".";
}

function joinPath(left: string, right: string): string {
  const separator = Deno.build.os === "windows" ? "\\" : "/";
  return `${left.replace(/[\\/]+$/, "")}${separator}${right}`;
}

export function defaultMinecraftPath(): string {
  if (Deno.build.os === "windows") {
    try {
      const appData = Deno.env.get("APPDATA");
      if (appData && appData.trim()) return joinPath(appData, ".minecraft");
    } catch {
      // Environment access can be denied; fall back to the home directory.
    }
    return joinPath(homeDirectory(), ".minecraft");
  }
  if (Deno.build.os === "darwin") {
    return joinPath(homeDirectory(), "Library/Application Support/minecraft");
  }
  return joinPath(homeDirectory(), ".minecraft");
}

export function defaultBackupDestination(): string {
  return joinPath(homeDirectory(), "TotemBackups");
}

async function askInput<T>(question: PromptQuestion<typeof Input>): Promise<T> {
  const answer = await prompt([question]) as Record<string, unknown>;
  return answer[question.name] as T;
}

async function askSelect<T>(question: PromptQuestion<typeof Select>): Promise<T> {
  const answer = await prompt([question]) as Record<string, unknown>;
  return answer[question.name] as T;
}

async function askConfirm<T>(question: PromptQuestion<typeof Confirm>): Promise<T> {
  const answer = await prompt([question]) as Record<string, unknown>;
  return answer[question.name] as T;
}

async function askCheckbox<T>(question: PromptQuestion<typeof Checkbox>): Promise<T> {
  const answer = await prompt([question]) as Record<string, unknown>;
  return answer[question.name] as T;
}

function modeQuestion(folder: FolderSummary): PromptQuestion<typeof Select> {
  const label = folder.name[0].toUpperCase() + folder.name.slice(1);
  return {
    name: folder.id,
    message:
      `${label}: choose what to save. Manifest mode records entry names and preserves available configs; full mode copies the entire folder.`,
    type: Select,
    options: [
      {
        name: `Manifest + configs (${formatBytes(folder.estimatedManifestBytes)})`,
        value: "manifest" satisfies FolderBackupMode,
      },
      {
        name: `Full folder (${formatBytes(folder.estimatedFullBytes)})`,
        value: "full" satisfies FolderBackupMode,
      },
    ],
    default: "manifest",
  };
}

async function inspectPathWithRetry(
  initialPath: string,
): Promise<MinecraftInspection> {
  let path = initialPath;
  while (true) {
    const inspection = await inspectMinecraftInstance(normalizeUserPath(path));
    if (inspection.validation.valid) return inspection;
    console.error("That does not look like a usable Minecraft directory.");
    for (const error of inspection.validation.errors) console.error(`  ${error}`);
    if (inspection.validation.warnings.length) {
      console.error(`  Hint: ${inspection.validation.warnings.join(" ")}`);
    }
    console.error("Please check the path and try again (quotes and ~ are supported).");
    path = await askInput<string>({
      name: "minecraftPathRetry",
      message: "Minecraft directory",
      type: Input,
      default: inspection.root || defaultMinecraftPath(),
    });
  }
}

/** Inspect first, then ask only about content that exists in the instance. */
export async function promptForBackup(defaults: PromptDefaults = {}): Promise<BackupRequest> {
  const initialPath = await askInput<string>({
    name: "minecraftPath",
    message: "Minecraft directory (quotes and ~ are supported)",
    type: Input,
    default: defaults.minecraftPath ?? defaultMinecraftPath(),
  });
  const inspection = await inspectPathWithRetry(initialPath);
  const folderModes = { ...DEFAULT_BACKUP_OPTIONS.folderModes };

  for (
    const folder of [
      inspection.folders.mods,
      inspection.folders.resourcepacks,
      inspection.folders.shaderpacks,
    ]
  ) {
    if (
      folder &&
      (folder.id === "mods" || folder.id === "resourcepacks" || folder.id === "shaderpacks")
    ) {
      folderModes[folder.id] = await askSelect<FolderBackupMode>(modeQuestion(folder));
    }
  }

  let includeSaves = false;
  if (inspection.saves) {
    includeSaves = await askConfirm<boolean>({
      name: "includeSaves",
      message: `Include saves? This may contain worlds, player data, and secrets (${
        formatBytes(inspection.saves.estimatedFullBytes)
      })`,
      type: Confirm,
      default: false,
    });
  }

  let customFolders: string[] = [];
  if (inspection.customFolders.length) {
    customFolders = await askCheckbox<string[]>({
      name: "customFolders",
      message: "Detected custom folders (choose any to include)",
      type: Checkbox,
      options: inspection.customFolders.map((folder) => ({
        name: `${folder.label} (${formatBytes(folder.estimatedFullBytes)})`,
        value: folder.id,
        checked: false,
      })),
    });
  }

  const zipOutput = await askConfirm<boolean>({
    name: "zipOutput",
    message: "Also create a ZIP archive (the uncompressed backup directory is retained)?",
    type: Confirm,
    default: false,
  });
  const openWhenDone = await askConfirm<boolean>({
    name: "openWhenDone",
    message: "Open the backup location when finished?",
    type: Confirm,
    default: DEFAULT_BACKUP_OPTIONS.openWhenDone,
  });
  const backupDestination = await askInput<string>({
    name: "backupDestination",
    message: "Backup destination",
    type: Input,
    default: defaults.backupDestination ?? defaultBackupDestination(),
    validate: (value) => {
      const normalized = normalizeUserPath(value);
      return normalized.length > 0 || "Backup destination must be a non-empty path.";
    },
  });

  return {
    minecraftPath: inspection.root,
    backupDestination: normalizeUserPath(backupDestination),
    options: {
      folderModes,
      includeSaves,
      customFolders,
      zipOutput,
      openWhenDone,
    },
    inspection,
  };
}
