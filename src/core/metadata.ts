import { KNOWN_CUSTOM_FOLDERS } from "./paths.ts";
import type { BackupOptions, BackupStats, CustomFolderSummary, MinecraftInfo } from "./types.ts";

interface InfoMarkdownArgs {
  backupPath: string;
  sourcePath: string;
  version: string;
  info: MinecraftInfo;
  stats: BackupStats;
  durationMs: number;
  errors: string[];
  options: BackupOptions;
  customFolders?: CustomFolderSummary[];
}

const UNKNOWN = "Unknown";

function asText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function parseProperties(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([^#;=\s]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values.set(match[1].toLowerCase(), match[2]);
  }
  return values;
}

function detectLoader(uid: string): string | undefined {
  const normalized = uid.toLowerCase();
  if (normalized.includes("fabric")) return "Fabric";
  if (normalized.includes("quilt")) return "Quilt";
  if (normalized.includes("forge") || normalized.includes("neoforge")) return "Forge";
  return undefined;
}

function findComponent(components: unknown[], loader: string): string | undefined {
  for (const item of components) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const uid = asText(record.uid) ?? asText(record.id) ?? "";
    if (detectLoader(uid) === loader) {
      return asText(record.version) ?? asText(record.versionId) ?? asText(record.build);
    }
  }
  return undefined;
}

function versionFromName(name: string): string | undefined {
  // Mod and loader names commonly carry the Minecraft version after a '+' or
  // as the first dotted numeric component (for example 1.20.1-forge-47.2.0).
  const plus = /\+((?:1|2)\.\d+(?:\.\d+){1,2})(?=[^0-9]|$)/i.exec(name);
  if (plus) return plus[1];
  const direct = /(?:^|[-_+])((?:1|2)\.\d+(?:\.\d+){1,2})(?=[^0-9]|$)/i.exec(name);
  return direct?.[1];
}

function loaderFromModName(
  name: string,
): { loader?: string; loaderVersion?: string; version?: string } {
  const lower = name.toLowerCase();
  const version = versionFromName(name);
  const quilt = /quilt-loader[-_]?([0-9]+(?:\.[0-9]+){1,3})/i.exec(name) ??
    /quilt[-_]?loader[-_]?([0-9]+(?:\.[0-9]+){1,3})/i.exec(name);
  if (quilt || lower.includes("quilted-fabric-api")) {
    return { loader: "Quilt", loaderVersion: quilt?.[1], version };
  }
  const fabric = /fabric-loader[-_]?([0-9]+(?:\.[0-9]+){1,3})/i.exec(name);
  if (fabric || lower.includes("fabric-api")) {
    return { loader: "Fabric", loaderVersion: fabric?.[1], version };
  }
  const forge = /(?:neo)?forge[-_]?([0-9]+(?:\.[0-9]+){1,3})/i.exec(name) ??
    /minecraftforge[-_]?([0-9]+(?:\.[0-9]+){1,3})/i.exec(name);
  if (forge || lower.includes("forge")) {
    return { loader: "Forge", loaderVersion: forge?.[1], version };
  }
  return {};
}

async function readTextIfPresent(path: string): Promise<string | undefined> {
  try {
    const info = await Deno.lstat(path);
    if (info.isSymlink || !info.isFile) return undefined;
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

/** Detect Minecraft and mod-loader metadata without requiring a launcher. */
export async function detectMinecraftInfo(root: string): Promise<MinecraftInfo> {
  let version = UNKNOWN;
  let loader = UNKNOWN;
  let loaderVersion = UNKNOWN;

  const mmcPack = await readTextIfPresent(`${root}/mmc-pack.json`);
  if (mmcPack) {
    try {
      const parsed = JSON.parse(mmcPack) as Record<string, unknown>;
      const components = Array.isArray(parsed.components) ? parsed.components : [];
      const minecraft = components.find((item) => {
        if (!item || typeof item !== "object") return false;
        const uid = asText((item as Record<string, unknown>).uid) ??
          asText((item as Record<string, unknown>).id) ?? "";
        return uid.toLowerCase() === "net.minecraft" || uid.toLowerCase().includes("minecraft");
      });
      if (minecraft && typeof minecraft === "object") {
        version = asText((minecraft as Record<string, unknown>).version) ?? version;
      }
      for (const candidate of ["Fabric", "Quilt", "Forge"]) {
        const found = findComponent(components, candidate);
        if (found !== undefined) {
          loader = candidate;
          loaderVersion = found;
          break;
        }
      }
    } catch {
      // A malformed launcher file should not make a backup unusable.
    }
  }

  const instanceCfg = await readTextIfPresent(`${root}/instance.cfg`);
  if (instanceCfg) {
    const values = parseProperties(instanceCfg);
    version = values.get("mcversion") ?? values.get("intendedversion") ??
      values.get("minecraftversion") ?? version;
    const configuredLoader = values.get("loader") ?? values.get("modloader");
    if (configuredLoader) {
      const detected = detectLoader(configuredLoader);
      if (detected) loader = detected;
    }
    for (const [key, candidate] of values) {
      const detected = detectLoader(key);
      if (detected) {
        loader = detected;
        loaderVersion = candidate || loaderVersion;
      }
    }
    loaderVersion = values.get("loaderversion") ?? values.get("forgeversion") ??
      values.get("fabricversion") ?? values.get("quiltversion") ?? loaderVersion;
  }

  try {
    const modsInfo = await Deno.lstat(`${root}/mods`);
    if (modsInfo.isSymlink || !modsInfo.isDirectory) return { version, loader, loaderVersion };
    const names: string[] = [];
    for await (const entry of Deno.readDir(`${root}/mods`)) {
      if (entry.isSymlink) continue;
      names.push(entry.name);
    }
    names.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    for (const name of names) {
      const found = loaderFromModName(name);
      if (loader === UNKNOWN && found.loader) loader = found.loader;
      if (loaderVersion === UNKNOWN && found.loaderVersion) loaderVersion = found.loaderVersion;
      if (version === UNKNOWN && found.version) version = found.version;
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }

  return { version, loader, loaderVersion };
}

async function directorySize(path: string): Promise<number> {
  let total = 0;
  try {
    const rootInfo = await Deno.lstat(path);
    if (rootInfo.isSymlink || !rootInfo.isDirectory) return 0;
    for await (const entry of Deno.readDir(path)) {
      if (entry.isSymlink) continue;
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory) total += await directorySize(child);
      else if (entry.isFile) {
        const info = await Deno.lstat(child);
        if (!info.isSymlink && info.isFile) total += info.size;
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return 0;
    throw error;
  }
  return total;
}

interface LargestEntry {
  name: string;
  size: number;
}

async function largestEntries(path: string): Promise<LargestEntry[]> {
  const entries: LargestEntry[] = [];
  try {
    const rootInfo = await Deno.lstat(path);
    if (rootInfo.isSymlink || !rootInfo.isDirectory) return entries;
    for await (const entry of Deno.readDir(path)) {
      if (entry.isSymlink) continue;
      const child = `${path}/${entry.name}`;
      let size = 0;
      if (entry.isDirectory) {
        size = await directorySize(child);
      } else if (entry.isFile) {
        const info = await Deno.lstat(child);
        if (!info.isSymlink && info.isFile) size = info.size;
      }
      entries.push({ name: entry.name, size });
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return entries;
    throw error;
  }
  return entries.sort((a, b) => b.size - a.size || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, 10);
}

interface FolderMetrics {
  present: boolean;
  listedEntries: number;
  listedBytes: number;
  configFileCount: number;
  configBytes: number;
  estimatedManifestBytes: number;
  estimatedFullBytes: number;
}

async function folderMetrics(
  path: string,
  configPath?: string,
  excludeRootText = false,
): Promise<FolderMetrics> {
  const names: string[] = [];
  let present = false;
  try {
    const info = await Deno.lstat(path);
    if (!info.isSymlink && info.isDirectory) {
      present = true;
      for await (const entry of Deno.readDir(path)) {
        if (entry.isSymlink) continue;
        if (!(excludeRootText && entry.isFile && entry.name.toLowerCase().endsWith(".txt"))) {
          names.push(entry.name);
        }
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  names.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);

  const listedBytes = present ? await directorySize(path) : 0;
  let configFileCount = 0;
  let configBytes = 0;
  if (configPath) {
    try {
      const configInfo = await Deno.lstat(configPath);
      if (!configInfo.isSymlink && configInfo.isDirectory) {
        configBytes = await directorySize(configPath);
        configFileCount = await directoryFileCount(configPath);
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  } else if (excludeRootText && present) {
    for await (const entry of Deno.readDir(path)) {
      if (entry.isSymlink || !entry.isFile || !entry.name.toLowerCase().endsWith(".txt")) continue;
      try {
        const info = await Deno.lstat(`${path}/${entry.name}`);
        if (info.isSymlink || !info.isFile) continue;
        configFileCount++;
        configBytes += info.size;
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }
  }

  const manifestText = names.join("\n") + (names.length ? "\n" : "");
  const manifestBytes = new TextEncoder().encode(manifestText).byteLength;
  return {
    present,
    listedEntries: names.length,
    listedBytes,
    configFileCount,
    configBytes,
    estimatedManifestBytes: manifestBytes + configBytes,
    estimatedFullBytes: listedBytes + (configPath ? configBytes : 0),
  };
}

async function pathSize(path: string): Promise<number | undefined> {
  try {
    const info = await Deno.lstat(path);
    if (info.isSymlink) return undefined;
    return info.isDirectory ? await directorySize(path) : info.isFile ? info.size : undefined;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

async function combinedPathSize(paths: string[]): Promise<number | undefined> {
  let total = 0;
  let found = false;
  for (const path of paths) {
    const size = await pathSize(path);
    if (size !== undefined) {
      found = true;
      total += size;
    }
  }
  return found ? total : undefined;
}
async function directoryFileCount(path: string): Promise<number> {
  let count = 0;
  try {
    const rootInfo = await Deno.lstat(path);
    if (rootInfo.isSymlink || !rootInfo.isDirectory) return 0;
    for await (const entry of Deno.readDir(path)) {
      if (entry.isSymlink) continue;
      if (entry.isDirectory) count += await directoryFileCount(`${path}/${entry.name}`);
      else if (entry.isFile) count++;
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return 0;
    throw error;
  }
  return count;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 bytes";
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = "bytes";
  for (const candidate of units) {
    value /= 1024;
    unit = candidate;
    if (value < 1024 || candidate === units.at(-1)) break;
  }
  return `${value.toFixed(2)} ${unit} (${bytes} bytes)`;
}

function formatOptionalBytes(bytes: number | undefined): string {
  return bytes === undefined ? UNKNOWN : formatBytes(bytes);
}

function markdownTable(rows: Array<[string, string]>): string {
  return [
    "| Item | Value |",
    "| --- | --- |",
    ...rows.map(([key, value]) => `| ${key} | ${value.replaceAll("|", "\\|")} |`),
  ].join("\n");
}

function markdownDetails(headers: string[], rows: string[][]): string {
  const escape = (value: string) => value.replaceAll("|", "\\|");
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escape).join(" | ")} |`),
  ].join("\n");
}

function largestTable(rows: LargestEntry[]): string {
  const tableRows = rows.length
    ? rows.map((entry) => [entry.name, formatBytes(entry.size)] as [string, string])
    : [["No items", "—"] as [string, string]];
  return markdownDetails(["Name", "Size"], tableRows);
}

function safeNumber(stats: BackupStats, key: keyof BackupStats): string {
  const value = stats[key];
  return typeof value === "number" && Number.isFinite(value) ? String(value) : UNKNOWN;
}

function safeText(value: unknown): string {
  return asText(value) ?? UNKNOWN;
}

function modeLabel(mode: "manifest" | "full"): string {
  return mode === "manifest" ? "Manifest" : "Full";
}

/** Write deterministic, human-readable backup metadata to backupPath/info.md. */
export async function generateInfoMarkdown(args: InfoMarkdownArgs): Promise<void> {
  const stats = args.stats;
  const backupSizeBeforeInfo = await directorySize(args.backupPath);
  const errors = args.errors.map((error) => String(error));
  const result = errors.length ? "Completed with errors" : "Success";
  const modes = args.options.folderModes;
  const source = args.sourcePath;

  const metrics = {
    screenshots: await folderMetrics(`${source}/screenshots`),
    mods: await folderMetrics(`${source}/mods`, `${source}/config`),
    resourcepacks: await folderMetrics(`${source}/resourcepacks`),
    shaderpacks: await folderMetrics(`${source}/shaderpacks`, undefined, true),
    saves: await folderMetrics(`${source}/saves`),
  };
  const actualSizes = {
    mods: await combinedPathSize(
      modes.mods === "full"
        ? [`${args.backupPath}/mods`, `${args.backupPath}/config`]
        : [`${args.backupPath}/mods.txt`, `${args.backupPath}/config`],
    ),
    resourcepacks: await combinedPathSize(
      modes.resourcepacks === "full"
        ? [`${args.backupPath}/resourcepacks`]
        : [`${args.backupPath}/resourcepacks.txt`],
    ),
    shaderpacks: await combinedPathSize(
      modes.shaderpacks === "full"
        ? [`${args.backupPath}/shaderpacks`]
        : [`${args.backupPath}/shaders.txt`, `${args.backupPath}/shader-configs`],
    ),
    saves: await pathSize(`${args.backupPath}/saves`),
  };

  const folderDefinitions = [
    {
      id: "mods" as const,
      label: "Mods",
      listed: "modsListed" as const,
      copied: "modsCopied" as const,
      mode: modes.mods,
      manifest: "mods.txt",
      output: "mods",
    },
    {
      id: "resourcepacks" as const,
      label: "Resource packs",
      listed: "resourcepacksListed" as const,
      copied: "resourcepacksCopied" as const,
      mode: modes.resourcepacks,
      manifest: "resourcepacks.txt",
      output: "resourcepacks",
    },
    {
      id: "shaderpacks" as const,
      label: "Shader packs",
      listed: "shadersListed" as const,
      copied: "shadersCopied" as const,
      mode: modes.shaderpacks,
      manifest: "shaders.txt",
      output: "shaderpacks",
    },
  ];
  const folderRows = [
    ...folderDefinitions.map((folder) => {
      const summary = metrics[folder.id];
      const present = summary.present;
      const config = !present
        ? "Not present"
        : folder.id === "mods"
        ? summary.configFileCount > 0 || summary.configBytes > 0
          ? `Preserved in \`config/\` (${summary.configFileCount} files, ${
            formatBytes(summary.configBytes)
          })`
          : "No config/ present"
        : folder.id === "shaderpacks"
        ? summary.configFileCount > 0
          ? `Preserved in \`shader-configs/\` (${summary.configFileCount} root .txt configs, ${
            formatBytes(summary.configBytes)
          })`
          : "No root .txt configs present"
        : "Not applicable";
      const estimated = !present
        ? 0
        : folder.mode === "full"
        ? summary.estimatedFullBytes
        : summary.estimatedManifestBytes;
      const actual = actualSizes[folder.id];
      return [
        folder.label,
        present ? modeLabel(folder.mode) : "Absent",
        present ? safeNumber(stats, folder.listed) : "Not present",
        present ? safeNumber(stats, folder.copied) : "Not present",
        config,
        formatBytes(estimated),
        present ? formatOptionalBytes(actual) : "Omitted (not present)",
      ];
    }),
    [
      "Screenshots",
      metrics.screenshots.present ? modeLabel("full") : "Absent",
      metrics.screenshots.present ? UNKNOWN : "Not present",
      metrics.screenshots.present ? safeNumber(stats, "screenshotsCopied") : "Not present",
      metrics.screenshots.present ? "Copied recursively" : "Omitted (not present)",
      metrics.screenshots.present ? formatBytes(metrics.screenshots.estimatedFullBytes) : "0 bytes",
      metrics.screenshots.present
        ? formatOptionalBytes(await pathSize(`${args.backupPath}/screenshots`))
        : "Omitted (not present)",
    ],
    [
      "Saves",
      args.options.includeSaves ? modeLabel("full") : "Excluded",
      String(metrics.saves.listedEntries),
      safeNumber(stats, "savesCopied"),
      "Not applicable",
      args.options.includeSaves ? formatBytes(metrics.saves.estimatedFullBytes) : "Not selected",
      formatOptionalBytes(actualSizes.saves),
    ],
  ];

  const selectedCustom = new Set(args.options.customFolders.map((id) => String(id)));
  const customFolders =
    (args.customFolders ? [...args.customFolders] : KNOWN_CUSTOM_FOLDERS.map((folder) => ({
      id: folder.id,
      label: folder.label,
      folderName: folder.folderName,
      path: `${source}/${folder.folderName}`,
      estimatedFullBytes: undefined,
    }))).sort((left, right) =>
      left.folderName.localeCompare(right.folderName) || left.id.localeCompare(right.id)
    );
  const customSizes = new Map<string, number | undefined>();
  const customActualSizes = new Map<string, number | undefined>();
  const statsWithCustom = stats as BackupStats & {
    customFolderFilesCopied?: Record<string, number>;
  };
  for (const folder of customFolders) {
    customSizes.set(
      folder.id,
      args.customFolders ? folder.estimatedFullBytes : await pathSize(folder.path),
    );
    customActualSizes.set(folder.id, await pathSize(`${args.backupPath}/${folder.folderName}`));
  }
  const customRows = customFolders.map((folder) => {
    const known = KNOWN_CUSTOM_FOLDERS.some((knownFolder) => knownFolder.id === folder.id);
    const copiedKey = `${folder.id}Copied` as keyof BackupStats;
    const dynamicCopied = statsWithCustom.customFolderFilesCopied?.[folder.id];
    const copied = known
      ? safeNumber(stats, copiedKey)
      : typeof dynamicCopied === "number" && Number.isFinite(dynamicCopied)
      ? String(dynamicCopied)
      : UNKNOWN;
    return [
      folder.id,
      folder.label,
      folder.folderName,
      folder.path,
      selectedCustom.has(folder.id) ? "Selected" : "Not selected",
      copied,
      formatOptionalBytes(customSizes.get(folder.id)),
      formatOptionalBytes(customActualSizes.get(folder.id)),
    ];
  });
  const knownCustomIds = new Set(KNOWN_CUSTOM_FOLDERS.map((folder) => String(folder.id)));
  const inspectedCustomIds = new Set(customFolders.map((folder) => String(folder.id)));
  const unknownCustom = [...selectedCustom]
    .filter((id) => !knownCustomIds.has(id) && !inspectedCustomIds.has(id))
    .sort((left, right) => left.localeCompare(right));
  const customSelection = [...selectedCustom]
    .filter((id) => knownCustomIds.has(id) || inspectedCustomIds.has(id))
    .sort((left, right) => left.localeCompare(right))
    .join(", ") || "None";

  const optionsRows: Array<[string, string]> = [
    ["Screenshots", metrics.screenshots.present ? "Included" : "Omitted (not present)"],
    ["Mods mode", metrics.mods.present ? modeLabel(modes.mods) : "Absent"],
    [
      "Resource packs mode",
      metrics.resourcepacks.present ? modeLabel(modes.resourcepacks) : "Absent",
    ],
    ["Shader packs mode", metrics.shaderpacks.present ? modeLabel(modes.shaderpacks) : "Absent"],
    ["Saves", args.options.includeSaves ? "Included" : "Not included"],
    ["Custom folders selected", customSelection],
    ["ZIP archive", args.options.zipOutput ? "Included" : "Not included"],
    ["Open when done", args.options.openWhenDone ? "Yes" : "No"],
  ];
  if (unknownCustom.length) {
    optionsRows.push(["Unknown custom folder IDs", unknownCustom.join(", ")]);
  }

  const statRows: Array<[string, string]> = [
    ["Screenshots copied", safeNumber(stats, "screenshotsCopied")],
    ["Mods listed", safeNumber(stats, "modsListed")],
    ["Mods copied", safeNumber(stats, "modsCopied")],
    ["Shader packs listed", safeNumber(stats, "shadersListed")],
    ["Shader packs copied", safeNumber(stats, "shadersCopied")],
    ["Shader configs copied", safeNumber(stats, "shaderConfigsCopied")],
    ["Resource packs listed", safeNumber(stats, "resourcepacksListed")],
    ["Resource packs copied", safeNumber(stats, "resourcepacksCopied")],
    ["Saves copied", safeNumber(stats, "savesCopied")],
    ...KNOWN_CUSTOM_FOLDERS.map((folder) =>
      [
        `${folder.label} files copied`,
        safeNumber(stats, `${folder.id}Copied` as keyof BackupStats),
      ] as [string, string]
    ),
    ["Custom folder files copied", safeNumber(stats, "customFoldersCopied")],
    ["Total entries listed", safeNumber(stats, "totalEntriesListed")],
    [
      "Total bytes listed",
      typeof stats.totalBytesListed === "number" ? formatBytes(stats.totalBytesListed) : UNKNOWN,
    ],
    ["Total files copied", safeNumber(stats, "totalFilesCopied")],
    [
      "Total bytes copied",
      typeof stats.totalBytesCopied === "number" ? formatBytes(stats.totalBytesCopied) : UNKNOWN,
    ],
  ];

  const mods = await largestEntries(`${source}/mods`);
  const worlds = await largestEntries(`${source}/saves`);
  const screenshotsActual = await pathSize(`${args.backupPath}/screenshots`);
  const optionsActual = await pathSize(`${args.backupPath}/options.txt`);
  let finalSize = backupSizeBeforeInfo;

  for (let attempt = 0; attempt < 4; attempt++) {
    const restoreRows = [
      [
        "Screenshots",
        metrics.screenshots.present
          ? "Copy the `screenshots/` directory back recursively."
          : "Screenshots were not present; nothing to restore.",
      ],
      ...folderDefinitions.map((folder) => {
        const summary = metrics[folder.id];
        if (!summary.present) {
          return [folder.label, "This folder was not present; nothing to restore."];
        }
        if (folder.mode === "full") {
          return [
            folder.label,
            `Copy the complete \`${folder.output}/\` directory back to the Minecraft instance.`,
          ];
        }
        const preserved = folder.id === "mods"
          ? "then copy the preserved `config/` directory"
          : folder.id === "shaderpacks"
          ? "then copy preserved root `.txt` files from `shader-configs/`"
          : "there is no additional configuration payload";
        return [
          folder.label,
          `Use \`${folder.manifest}\` as the name manifest, reinstall or copy those entries manually; ${preserved}.`,
        ];
      }),
      [
        "Saves",
        args.options.includeSaves
          ? "Copy the `saves/` directory back recursively."
          : "No saves were selected; nothing to restore.",
      ],
      ...customFolders.map((folder) => [
        folder.label,
        selectedCustom.has(folder.id)
          ? `Copy \`${folder.folderName}/\` back to \`${folder.path}\`.`
          : "This folder was not selected; nothing to restore.",
      ]),
      ["options.txt", "Copy `options.txt` back when present."],
    ];
    const body = [
      "# Totem Backup",
      "",
      "## Backup Summary",
      markdownTable([
        ["Result", result],
        ["Source path", args.sourcePath],
        ["Backup path", args.backupPath],
        [
          "Minecraft version",
          safeText(args.version) === UNKNOWN ? safeText(args.info.version) : safeText(args.version),
        ],
        ["Loader", safeText(args.info.loader)],
        ["Loader version", safeText(args.info.loaderVersion)],
        ["Duration", `${Math.max(0, args.durationMs)} ms`],
        ["Final backup size", formatBytes(finalSize)],
      ]),
      "",
      "## Minecraft Information",
      markdownTable([
        [
          "Version",
          safeText(args.info.version) === UNKNOWN
            ? safeText(args.version)
            : safeText(args.info.version),
        ],
        ["Loader", safeText(args.info.loader)],
        ["Loader version", safeText(args.info.loaderVersion)],
      ]),
      "",
      "## Backup Options",
      markdownTable(optionsRows),
      "",
      "## Folder Details",
      markdownDetails([
        "Category",
        "Selected mode",
        "Listed entries",
        "Copied files",
        "Config preservation",
        "Estimated bytes",
        "Actual bytes",
      ], folderRows),
      "",
      "## Custom Folders",
      markdownDetails([
        "ID",
        "Folder",
        "Folder name",
        "Source path",
        "Selection",
        "Copied files",
        "Estimated bytes",
        "Actual bytes",
      ], customRows),
      "",
      "## Backup Statistics",
      markdownTable(statRows),
      "",
      "## Other Output",
      markdownTable([
        [
          "Screenshots actual size",
          metrics.screenshots.present
            ? formatOptionalBytes(screenshotsActual)
            : "Omitted (not present)",
        ],
        ["options.txt actual size", formatOptionalBytes(optionsActual)],
      ]),
      "",
      "## Largest Mods",
      largestTable(mods),
      "## Largest Worlds",
      largestTable(worlds),
      "## Restore Instructions",
      markdownDetails(["Category", "Instructions"], restoreRows),
      "",
      "## System Information",
      markdownTable([
        ["Operating system", `${Deno.build.os} (${Deno.build.arch})`],
        ["Deno", Deno.version.deno],
      ]),
      "",
      "## Result",
      errors.length
        ? "The backup completed, but one or more errors occurred:"
        : "The backup completed successfully without errors.",
      ...(errors.length ? errors.map((error) => `- ${error}`) : []),
      "",
    ].join("\n");
    await Deno.writeTextFile(`${args.backupPath}/info.md`, body);
    const measured = await directorySize(args.backupPath);
    if (measured === finalSize) break;
    finalSize = measured;
  }
}
