import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "@std/path";
import type { KnownCustomFolder, MinecraftPaths } from "./types.ts";

/** Stable registry for mod-created folders that can be copied as custom data. */
export const KNOWN_CUSTOM_FOLDERS: readonly KnownCustomFolder[] = [
  { id: "xaero", label: "Xaero's map data", folderName: "xaero" },
  {
    id: "distantHorizons",
    label: "Distant Horizons data",
    folderName: "distant_horizons_server_data",
  },
  { id: "journeymap", label: "JourneyMap data", folderName: "journeymap" },
  { id: "voxelmap", label: "VoxelMap data", folderName: "voxelmap" },
  { id: "mapwriter", label: "MapWriter data", folderName: "mapwriter" },
  { id: "litematica", label: "Litematica data", folderName: "litematica" },
  {
    id: "replayRecordings",
    label: "Replay recordings",
    folderName: "replay_recordings",
  },
];

/**
 * Root-level directories that belong to Minecraft or its runtime rather than
 * mod-created custom data. Comparison is case-insensitive.
 */
export const CUSTOM_FOLDER_DISCOVERY_DENYLIST: readonly string[] = [
  "assets",
  "bin",
  "cache",
  "commandcache",
  "config",
  "crash-reports",
  "defaultconfigs",
  "downloads",
  ".fabric",
  "libraries",
  "logs",
  "mods",
  ".mixin.out",
  "natives",
  "resourcepacks",
  "resources",
  "runtime",
  "saves",
  "screenshots",
  "server-resource-packs",
  "shaderpacks",
  "temp",
  "tmp",
  "versions",
];

/** Normalize a path supplied by a user or a command line option. */
export function normalizeUserPath(input: string): string {
  let value = input.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }

  if (value === "~" || value.startsWith("~/") || value.startsWith("~\\")) {
    try {
      const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
      if (home) value = value === "~" ? home : join(home, value.slice(2));
    } catch {
      // Environment permissions are optional; leave an unexpanded path intact.
    }
  }
  if (value.length === 0) return "";
  return normalize(value);
}

export function buildMinecraftPaths(root: string): MinecraftPaths {
  const normalizedRoot = normalizeUserPath(root);
  const paths: MinecraftPaths = {
    root: normalizedRoot,
    config: join(normalizedRoot, "config"),
    screenshots: join(normalizedRoot, "screenshots"),
    mods: join(normalizedRoot, "mods"),
    shaderpacks: join(normalizedRoot, "shaderpacks"),
    resourcepacks: join(normalizedRoot, "resourcepacks"),
    options: join(normalizedRoot, "options.txt"),
    saves: join(normalizedRoot, "saves"),
    xaero: join(normalizedRoot, "xaero"),
    distantHorizons: join(normalizedRoot, "distant_horizons_server_data"),
    journeymap: join(normalizedRoot, "journeymap"),
    voxelmap: join(normalizedRoot, "voxelmap"),
    mapwriter: join(normalizedRoot, "mapwriter"),
    litematica: join(normalizedRoot, "litematica"),
    replayRecordings: join(normalizedRoot, "replay_recordings"),
  };
  return paths;
}

/** Resolve a path for relationship checks without requiring it to exist. */
export function absoluteUserPath(input: string): string {
  const normalized = normalizeUserPath(input);
  return resolve(normalized);
}

/** Return true when two paths identify the same path on the current platform. */
export function pathsEqual(left: string, right: string): boolean {
  const a = absoluteUserPath(left);
  const b = absoluteUserPath(right);
  return Deno.build.os === "windows" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Return true when either path is an ancestor of the other. */
export function pathsOverlap(left: string, right: string): boolean {
  const a = absoluteUserPath(left);
  const b = absoluteUserPath(right);
  const comparisonA = Deno.build.os === "windows" ? a.toLowerCase() : a;
  const comparisonB = Deno.build.os === "windows" ? b.toLowerCase() : b;
  if (comparisonA === comparisonB) return true;
  const aToB = relative(comparisonA, comparisonB);
  const bToA = relative(comparisonB, comparisonA);
  const outside = (value: string) =>
    value === ".." || value.startsWith(`..${separator()}`) || isAbsolute(value);
  return !outside(aToB) || !outside(bToA);
}

function separator(): string {
  return Deno.build.os === "windows" ? "\\" : "/";
}

export { basename, dirname, join, normalize };
