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

  const command = new Deno.Command(EXECUTABLES[platform()], {
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
