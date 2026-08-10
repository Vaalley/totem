import { performBackup, validateMinecraftPath } from "./core/backup.ts";
import type { BackupRequest, BackupResult } from "./core/types.ts";
import {
  printBanner,
  printCancellation,
  printError,
  printPreflight,
  printSuccess,
} from "./cli/output.ts";
import { promptForBackup } from "./cli/prompts.ts";
import { createProgressReporter } from "./cli/progress.ts";
import { openFolder } from "./platform/open-folder.ts";

import { dirname } from "@std/path";

function isCancellation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; code?: string; message?: string };
  const text = `${candidate.name ?? ""} ${candidate.code ?? ""} ${candidate.message ?? ""}`
    .toLowerCase();
  return candidate.name === "AbortError" ||
    candidate.name === "Interrupted" ||
    candidate.code === "Interrupted" ||
    text.includes("cancel") ||
    text.includes("interrupted");
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runCli(): Promise<number> {
  Deno.exitCode = 0;
  printBanner();

  let request: BackupRequest;
  try {
    request = await promptForBackup();
  } catch (error) {
    if (isCancellation(error)) {
      printCancellation();
      Deno.exitCode = 130;
      return 130;
    }
    printError(`Unable to read backup settings: ${failureMessage(error)}`);
    Deno.exitCode = 1;
    return 1;
  }

  let validation;
  try {
    validation = await validateMinecraftPath(request.minecraftPath);
  } catch (error) {
    printError(`Unable to validate Minecraft directory: ${failureMessage(error)}`);
    Deno.exitCode = 1;
    return 1;
  }
  printPreflight(request, validation);
  if (!validation.valid) {
    printError(
      validation.errors.length ? validation.errors : "The Minecraft directory is not valid.",
    );
    Deno.exitCode = 1;
    return 1;
  }

  const reporter = createProgressReporter();
  let result: BackupResult;
  try {
    result = await performBackup(request, reporter);
  } catch (error) {
    if (isCancellation(error)) {
      printCancellation();
      Deno.exitCode = 130;
      return 130;
    }
    printError(`Backup could not be completed: ${failureMessage(error)}`);
    Deno.exitCode = 1;
    return 1;
  }

  if (!result.success) {
    printError(result.errors.length ? result.errors : "The backup did not complete successfully.");
    Deno.exitCode = 1;
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
  await runCli();
}
