import { resolve } from "@std/path";

const EXECUTABLES = {
  windows: "explorer",
  mac: "open",
  linux: "xdg-open",
} as const;

type OpenPlatform = keyof typeof EXECUTABLES;

function platform(): OpenPlatform {
  if (Deno.build.os === "windows") return "windows";
  if (Deno.build.os === "darwin") return "mac";
  return "linux";
}

/** Opens a folder without invoking a shell. Errors are intentionally propagated. */
export async function openFolder(path: string): Promise<void> {
  const target = path.trim();
  if (!target) throw new Error("Cannot open an empty folder path");

  const executable = EXECUTABLES[platform()];
  if (Deno.build.os === "windows") {
    // explorer.exe commonly exits with code 1 even when it successfully opens
    // the folder, so on Windows it is spawned detached and its exit code ignored.
    const child = new Deno.Command(executable, {
      args: [resolve(target)],
      stdin: "null",
      stdout: "null",
      stderr: "null",
    }).spawn();
    // Detach so the child's status does not hold the event loop open.
    child.unref();
    return;
  }

  const command = new Deno.Command(executable, {
    args: [resolve(target)],
    stdout: "null",
    stderr: "piped",
  });
  const output = await command.output();
  if (!output.success) {
    const detail = new TextDecoder().decode(output.stderr).trim();
    throw new Error(detail || `Folder opener exited with code ${output.code}`);
  }
}
