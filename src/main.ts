import { performBackup } from "./core/backup.ts";
import { inspectMinecraftInstance, inspectMinecraftPath } from "./core/inspect.ts";
import { normalizeUserPath } from "./core/paths.ts";
import type { BackupRequest, BackupResult, FolderBackupMode } from "./core/types.ts";
import {
  printBanner,
  printCancellation,
  printError,
  printPreflight,
  printSuccess,
} from "./cli/output.ts";
import { defaultBackupDestination, promptForBackup } from "./cli/prompts.ts";
import { createProgressReporter } from "./cli/progress.ts";
import { openFolder } from "./platform/open-folder.ts";

import { Command, EnumType } from "@cliffy/command";
import { dirname } from "@std/path";

function isCancellation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; code?: string; message?: string };
  if (
    candidate.name === "AbortError" ||
    candidate.name === "Interrupted" ||
    candidate.code === "Interrupted"
  ) {
    return true;
  }
  const message = (candidate.message ?? "").trim().toLowerCase();
  return message === "cancelled" ||
    message === "canceled" ||
    message === "interrupted" ||
    message.startsWith("operation cancelled") ||
    message.startsWith("operation canceled");
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function parseCliFlags() {
  const { options } = await new Command()
    .name("totem")
    .version("3.1.0")
    .description("Selective Minecraft configuration backup.")
    .type("mode", new EnumType<FolderBackupMode>(["manifest", "full"]))
    .option("--instance <path>", "Minecraft instance directory; enables non-interactive mode.")
    .option("--dest <path>", "Backup destination directory.")
    .option("--mode <mode:mode>", "Backup mode for mods, resourcepacks, and shaderpacks.", {
      default: "manifest" as FolderBackupMode,
    })
    .option("--saves", "Include the saves folder.")
    .option("--custom <ids>", "Comma-separated custom folder ids to include.")
    .option("--zip", "Also create a ZIP archive beside the backup directory.")
    .option("--open", "Open the backup location when finished.")
    .parse(Deno.args);
  return options;
}

export async function runCli(): Promise<number> {
  const flags = await parseCliFlags();
  printBanner();

  let request: BackupRequest;
  if (flags.instance) {
    let inspection;
    try {
      inspection = await inspectMinecraftInstance(normalizeUserPath(flags.instance));
    } catch (error) {
      printError(`Unable to inspect Minecraft directory: ${failureMessage(error)}`);
      return 1;
    }
    if (!inspection.validation.valid) {
      printError(
        inspection.validation.errors.length
          ? inspection.validation.errors
          : "The Minecraft directory is not valid.",
      );
      return 1;
    }
    const mode: FolderBackupMode = flags.mode === "full" ? "full" : "manifest";
    const available = new Set<string>(inspection.customFolders.map((folder) => folder.id));
    const customFolders = (flags.custom ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => available.has(id));
    request = {
      minecraftPath: inspection.root,
      backupDestination: normalizeUserPath(flags.dest ?? defaultBackupDestination()),
      options: {
        folderModes: { mods: mode, resourcepacks: mode, shaderpacks: mode },
        includeSaves: flags.saves ?? false,
        customFolders,
        zipOutput: flags.zip ?? false,
        openWhenDone: flags.open ?? false,
      },
      inspection,
    };
  } else {
    try {
      request = await promptForBackup();
    } catch (error) {
      if (isCancellation(error)) {
        printCancellation();
        return 130;
      }
      printError(`Unable to read backup settings: ${failureMessage(error)}`);
      return 1;
    }
  }

  let validation;
  try {
    validation = request.inspection?.validation ??
      await inspectMinecraftPath(request.minecraftPath);
  } catch (error) {
    printError(`Unable to validate Minecraft directory: ${failureMessage(error)}`);
    return 1;
  }
  printPreflight(request, validation);
  if (!validation.valid) {
    printError(
      validation.errors.length ? validation.errors : "The Minecraft directory is not valid.",
    );
    return 1;
  }

  const reporter = createProgressReporter();
  let result: BackupResult;
  try {
    result = await performBackup(request, reporter);
  } catch (error) {
    if (isCancellation(error)) {
      printCancellation();
      return 130;
    }
    printError(`Backup could not be completed: ${failureMessage(error)}`);
    return 1;
  }

  if (!result.success) {
    printError(result.errors.length ? result.errors : "The backup did not complete successfully.");
    return 1;
  }
  printSuccess(result, request);
  if (request.options.openWhenDone) {
    const target = request.options.zipOutput ? dirname(result.outputPath) : result.directoryPath;
    try {
      await openFolder(target);
    } catch (error) {
      // The backup itself succeeded; warn clearly, but keep the successful backup status.
      console.error(
        `Warning: backup saved to ${result.outputPath}, but the output folder could not be opened: ${
          failureMessage(error)
        }`,
      );
    }
  }
  return 0;
}

if (import.meta.main) {
  Deno.exitCode = await runCli();
}
