import { performBackup } from "./core/backup.ts";
import { inspectMinecraftInstance } from "./core/inspect.ts";
import { defaultBackupDestination, defaultMinecraftPath } from "./cli/prompts.ts";
import { openFolder } from "./platform/open-folder.ts";
import { errorMessage } from "./core/format.ts";
import { INDEX_HTML } from "./desktop-ui.ts";
import { dirname } from "@std/path";
import type { BackupProgress, BackupRequest } from "./core/types.ts";

let lastProgress: BackupProgress | null = null;
let backupInFlight = false;

Deno.serve((request) => {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/") {
    return new Response(INDEX_HTML, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return new Response("Not found", { status: 404 });
});

const win = new Deno.BrowserWindow();

win.bind("getDefaults", () =>
  Promise.resolve({
    minecraftPath: defaultMinecraftPath(),
    backupDestination: defaultBackupDestination(),
  }));

win.bind("inspect", (path: string) => inspectMinecraftInstance(path));

win.bind("runBackup", async (request: BackupRequest) => {
  if (backupInFlight) throw new Error("A backup is already running");
  backupInFlight = true;
  lastProgress = null;
  try {
    const result = await performBackup(request, (progress) => {
      lastProgress = progress;
    });
    if (result.success && request.options.openWhenDone) {
      const target = request.options.zipOutput ? dirname(result.outputPath) : result.directoryPath;
      try {
        await openFolder(target);
      } catch (error) {
        // The backup itself succeeded; warn clearly, but keep the successful status.
        console.error(`Backup succeeded, but opening the folder failed: ${errorMessage(error)}`);
      }
    }
    return result;
  } finally {
    backupInFlight = false;
  }
});

win.bind("getProgress", () => Promise.resolve(lastProgress));

win.bind("openFolder", (path: string) => openFolder(path));
