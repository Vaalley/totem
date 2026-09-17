import { join } from "@std/path";
import { errorMessage } from "./format.ts";
import {
  buildMinecraftPaths,
  CUSTOM_FOLDER_DISCOVERY_DENYLIST,
  KNOWN_CUSTOM_FOLDERS,
  normalizeUserPath,
} from "./paths.ts";
import type {
  CustomFolderId,
  CustomFolderSummary,
  FolderSummary,
  KnownCustomFolderId,
  MinecraftInspection,
  MinecraftPaths,
  PathValidationResult,
} from "./types.ts";

type Marker = {
  key: Exclude<keyof MinecraftPaths, "root">;
  name: string;
  directory: boolean;
};

const markers: readonly Marker[] = [
  { key: "config", name: "config", directory: true },
  { key: "options", name: "options.txt", directory: false },
  { key: "screenshots", name: "screenshots", directory: true },
  { key: "mods", name: "mods", directory: true },
  { key: "shaderpacks", name: "shaderpacks", directory: true },
  { key: "resourcepacks", name: "resourcepacks", directory: true },
  { key: "saves", name: "saves", directory: true },
  ...KNOWN_CUSTOM_FOLDERS.map((folder) => ({
    key: folder.id as Exclude<keyof MinecraftPaths, "root">,
    name: folder.folderName,
    directory: true,
  })),
];

function consumeCsi(value: string, start: number): number {
  let index = start;
  while (index < value.length) {
    const code = value.charCodeAt(index++);
    if (code >= 0x40 && code <= 0x7e) return index;
  }
  return value.length;
}

function consumeAnsiString(value: string, start: number): number {
  let index = start;
  while (index < value.length) {
    const code = value.charCodeAt(index++);
    if (code === 0x07 || code === 0x9c) return index;
    if (code === 0x1b && value.charCodeAt(index) === 0x5c) return index + 1;
  }
  return value.length;
}

function ansiSequenceEnd(value: string, start: number): number | undefined {
  const first = value.charCodeAt(start);
  if (first === 0x9b) return consumeCsi(value, start + 1);
  if (
    first === 0x90 ||
    first === 0x98 ||
    first === 0x9d ||
    first === 0x9e ||
    first === 0x9f
  ) {
    return consumeAnsiString(value, start + 1);
  }
  if (first !== 0x1b || start + 1 >= value.length) return undefined;

  const next = value.charCodeAt(start + 1);
  if (next === 0x5b) return consumeCsi(value, start + 2);
  if (
    next === 0x90 ||
    next === 0x98 ||
    next === 0x9d ||
    next === 0x9e ||
    next === 0x9f
  ) {
    return consumeAnsiString(value, start + 2);
  }
  if (next === 0x5c || (next >= 0x30 && next <= 0x7e)) return start + 2;

  let index = start + 1;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code > 0x2f) break;
    index++;
  }
  if (index < value.length) {
    const code = value.charCodeAt(index);
    if (code >= 0x30 && code <= 0x7e) return index + 1;
  }
  return undefined;
}

function displayLabel(value: string): string {
  let sanitized = "";
  let index = 0;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code === 0x1b || (code >= 0x80 && code <= 0x9f)) {
      const end = ansiSequenceEnd(value, index);
      if (end !== undefined) {
        index = end;
        continue;
      }
    }
    const codePoint = value.codePointAt(index)!;
    const width = codePoint > 0xffff ? 2 : 1;
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    ) {
      sanitized += " ";
    } else {
      sanitized += value.slice(index, index + width);
    }
    index += width;
  }
  return sanitized.replace(/\s+/gu, " ").trim();
}

/** Inspect a Minecraft directory without creating or changing anything. */
export async function inspectMinecraftPath(root: string): Promise<PathValidationResult> {
  const path = normalizeUserPath(root);
  const present: string[] = [];
  const missing: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  let rootInfo: Deno.FileInfo;
  try {
    rootInfo = await Deno.stat(path);
  } catch (error) {
    return {
      valid: false,
      path,
      errors: [`Minecraft path cannot be accessed: ${errorMessage(error)}`],
      warnings: [],
      present: [],
      missing: markers.map((marker) => marker.name),
    };
  }

  if (!rootInfo.isDirectory) {
    return {
      valid: false,
      path,
      errors: ["Minecraft path must be an existing directory"],
      warnings: [],
      present: [],
      missing: markers.map((marker) => marker.name),
    };
  }

  const paths = buildMinecraftPaths(path);
  for (const marker of markers) {
    try {
      const info = await Deno.lstat(paths[marker.key]);
      if (info.isSymlink) {
        warnings.push(`${marker.name} is a symbolic link and will be ignored`);
      } else if ((marker.directory && info.isDirectory) || (!marker.directory && info.isFile)) {
        present.push(marker.name);
      } else {
        errors.push(`${marker.name} exists but has the wrong type`);
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        missing.push(marker.name);
      } else {
        errors.push(`Unable to inspect ${marker.name}: ${errorMessage(error)}`);
      }
    }
  }

  present.sort((left, right) => left.localeCompare(right));
  missing.sort((left, right) => left.localeCompare(right));
  if (present.length === 0) {
    warnings.push("No recognizable Minecraft files or directories were found");
  }
  if (missing.length > 0) warnings.push(`Optional paths not present: ${missing.join(", ")}`);

  return { valid: errors.length === 0, path, errors, warnings, present, missing };
}

interface TreeSummary {
  fileCount: number;
  directoryCount: number;
  totalBytes: number;
}

async function summarizeTree(path: string, errors: string[], label: string): Promise<TreeSummary> {
  const summary: TreeSummary = { fileCount: 0, directoryCount: 0, totalBytes: 0 };
  async function visit(directory: string): Promise<void> {
    const entries: Deno.DirEntry[] = [];
    try {
      for await (const entry of Deno.readDir(directory)) entries.push(entry);
    } catch (error) {
      errors.push(`Unable to inspect ${label}: ${errorMessage(error)}`);
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isSymlink) continue;
      if (entry.isDirectory) {
        summary.directoryCount++;
        await visit(entryPath);
      } else if (entry.isFile) {
        try {
          const info = await Deno.lstat(entryPath);
          if (!info.isSymlink) {
            summary.fileCount++;
            summary.totalBytes += info.size;
          }
        } catch (error) {
          errors.push(`Unable to inspect ${label}/${entry.name}: ${errorMessage(error)}`);
        }
      }
    }
  }
  await visit(path);
  return summary;
}

interface ImmediateEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

async function immediateEntries(
  path: string,
  errors: string[],
  label: string,
): Promise<ImmediateEntry[]> {
  const entries: ImmediateEntry[] = [];
  try {
    for await (const entry of Deno.readDir(path)) {
      if (!entry.isSymlink && (entry.isFile || entry.isDirectory)) {
        entries.push({ name: entry.name, isFile: entry.isFile, isDirectory: entry.isDirectory });
      }
    }
  } catch (error) {
    errors.push(`Unable to inspect ${label}: ${errorMessage(error)}`);
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  return entries;
}

async function optionalTree(
  path: string,
  errors: string[],
  label: string,
): Promise<TreeSummary | undefined> {
  try {
    const info = await Deno.lstat(path);
    if (info.isSymlink) return undefined;
    if (!info.isDirectory) {
      errors.push(`${label} exists but has the wrong type`);
      return undefined;
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    errors.push(`Unable to inspect ${label}: ${errorMessage(error)}`);
    return undefined;
  }
  return await summarizeTree(path, errors, label);
}

async function folderSummary(
  id: FolderSummary["id"],
  name: string,
  path: string,
  errors: string[],
  configPath?: string,
  shaderConfigNames = false,
): Promise<FolderSummary | undefined> {
  const source = await optionalTree(path, errors, name);
  if (!source) return undefined;
  const entries = await immediateEntries(path, errors, name);
  const listed = shaderConfigNames
    ? entries.filter((entry) => !(entry.isFile && entry.name.toLowerCase().endsWith(".txt")))
    : entries;
  let config: TreeSummary = { fileCount: 0, directoryCount: 0, totalBytes: 0 };
  if (configPath) {
    config = (await optionalTree(configPath, errors, "config")) ?? config;
  } else if (shaderConfigNames) {
    for (const entry of entries) {
      if (entry.isFile && entry.name.toLowerCase().endsWith(".txt")) {
        try {
          config.fileCount++;
          config.totalBytes += (await Deno.lstat(join(path, entry.name))).size;
        } catch (error) {
          errors.push(`Unable to inspect ${name}/${entry.name}: ${errorMessage(error)}`);
        }
      }
    }
  }
  const manifestText = listed.map((entry) => entry.name).join("\n") + (listed.length ? "\n" : "");
  const manifestBytes = new TextEncoder().encode(manifestText).byteLength + config.totalBytes;
  const fullBytes = source.totalBytes + (configPath ? config.totalBytes : 0);
  return {
    id,
    name,
    path,
    present: true,
    fileCount: source.fileCount,
    directoryCount: source.directoryCount,
    totalBytes: source.totalBytes,
    listedEntries: listed.length,
    listedFiles: listed.filter((entry) => entry.isFile).length,
    listedDirectories: listed.filter((entry) => entry.isDirectory).length,
    manifestBytes,
    fullBytes,
    configFileCount: config.fileCount,
    configDirectoryCount: config.directoryCount,
    configBytes: config.totalBytes,
    estimatedManifestBytes: manifestBytes,
    estimatedFullBytes: fullBytes,
  };
}

/** Inspect all selectable folders and calculate byte-accurate backup estimates. */
export async function inspectMinecraftInstance(root: string): Promise<MinecraftInspection> {
  const normalizedRoot = normalizeUserPath(root);
  const paths = buildMinecraftPaths(normalizedRoot);
  const validation = await inspectMinecraftPath(normalizedRoot);
  const errors = validation.errors;
  const folders: MinecraftInspection["folders"] = {};
  const mods = await folderSummary("mods", "mods", paths.mods, errors, paths.config);
  const resourcepacks = await folderSummary(
    "resourcepacks",
    "resourcepacks",
    paths.resourcepacks,
    errors,
  );
  const shaderpacks = await folderSummary(
    "shaderpacks",
    "shaderpacks",
    paths.shaderpacks,
    errors,
    undefined,
    true,
  );
  if (mods) folders.mods = mods;
  if (resourcepacks) folders.resourcepacks = resourcepacks;
  if (shaderpacks) folders.shaderpacks = shaderpacks;

  const saves = await folderSummary("saves", "saves", paths.saves, errors);
  const customFolders: CustomFolderSummary[] = [];
  for (const folder of KNOWN_CUSTOM_FOLDERS) {
    const source = await optionalTree(paths[folder.id], errors, folder.folderName);
    if (source) {
      customFolders.push({
        id: folder.id as KnownCustomFolderId,
        label: folder.label,
        folderName: folder.folderName,
        path: paths[folder.id],
        present: true,
        fileCount: source.fileCount,
        directoryCount: source.directoryCount,
        totalBytes: source.totalBytes,
        estimatedFullBytes: source.totalBytes,
      });
    }
  }

  const knownFolderNames = new Set(
    KNOWN_CUSTOM_FOLDERS.map((folder) => folder.folderName.toLowerCase()),
  );
  const discoveryDenylist = new Set(
    CUSTOM_FOLDER_DISCOVERY_DENYLIST.map((name) => name.toLowerCase()),
  );
  const rootEntries = await immediateEntries(normalizedRoot, errors, "Minecraft instance");
  for (const entry of rootEntries) {
    if (
      !entry.isDirectory ||
      knownFolderNames.has(entry.name.toLowerCase()) ||
      discoveryDenylist.has(entry.name.toLowerCase())
    ) {
      continue;
    }
    const path = join(normalizedRoot, entry.name);
    const source = await optionalTree(path, errors, entry.name);
    if (!source) continue;
    const id: CustomFolderId = `custom:${entry.name}`;
    customFolders.push({
      id,
      label: displayLabel(entry.name),
      folderName: entry.name,
      path,
      present: true,
      fileCount: source.fileCount,
      directoryCount: source.directoryCount,
      totalBytes: source.totalBytes,
      estimatedFullBytes: source.totalBytes,
    });
  }
  customFolders.sort((left, right) => left.folderName.localeCompare(right.folderName));
  validation.valid = validation.valid && errors.length === 0;
  return {
    root: normalizedRoot,
    paths,
    validation,
    folders,
    saves,
    customFolders,
  };
}
