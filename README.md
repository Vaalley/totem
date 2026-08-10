# Totem

Totem is a Deno 2 + TypeScript terminal user interface (TUI) for making **selective Minecraft Java
Edition instance backups**. The workflow is intentionally inspection-first: enter the instance
directory, let Totem inspect what is present, review recursive byte estimates, and then choose what
to copy.

Totem is a backup/export tool, not a restore system. It does not reinstall Minecraft, merge a backup
into an instance, download mods, or provide cloud storage.

## Requirements and supported platforms

- [Deno 2](https://deno.com/). The first run may need network access so Deno can cache the JSR
  dependencies.
- A Minecraft Java Edition instance directory. Minecraft itself does not need to be installed on the
  machine running Totem.

Totem runs from source on platforms supported by Deno. The project currently builds and publishes
native x64 release artifacts for Windows, Linux, and macOS:

- `totem-windows-x64.exe`
- `totem-linux-x64.tar.gz`
- `totem-macos-x64.tar.gz`

Other operating systems and CPU architectures may run the Deno source where Deno supports them, but
are not current release artifacts. The usual instance locations are `%APPDATA%\.minecraft` on
Windows, `~/.minecraft` on Linux, and `~/Library/Application Support/minecraft` on macOS; custom
launcher and instance paths are supported.

## Install a published release

Download the artifact for your platform from the GitHub release. Windows releases are the raw
`totem-windows-x64.exe`; run that executable directly. Linux and macOS releases are gzip-compressed
POSIX archives, so extract the matching archive before running the binary:

```sh
# Linux
tar -xzf totem-linux-x64.tar.gz
chmod +x totem-linux-x64   # use this if extraction did not preserve executable permissions
./totem-linux-x64

# macOS
tar -xzf totem-macos-x64.tar.gz
chmod +x totem-macos-x64   # use this if extraction did not preserve executable permissions
./totem-macos-x64
```

The standalone release binaries do not require Deno. The first run still asks for the Minecraft
instance path described below.

## Install and run

Clone the repository, then start the TUI:

```sh
deno task start
```

This task is equivalent to:

```sh
deno run --allow-read --allow-write --allow-env --allow-run src/main.ts
```

The first prompt asks for the **Minecraft instance path**. Totem validates that path and inspects it
before asking for a destination or backup selections. For each present `mods/`, `resourcepacks/`,
and `shaderpacks/` folder, the TUI shows a recursive source-byte estimate and asks for one of these
modes:

- **Manifest** — writes a deterministic UTF-8 inventory of names (files and directories, sorted by
  entry name), plus available applicable configuration files. The estimate is the generated manifest
  bytes plus those configuration bytes. This mode does not copy the mod, resource-pack, or
  shader-pack payloads.
- **Full** — recursively copies the entire source folder. The estimate is the recursive source byte
  total. The copied folder keeps its source name (`mods/`, `resourcepacks/`, or `shaderpacks/`) so
  it can be copied back or shared directly.

The TUI only offers a choice for a known folder that is actually present. Missing optional folders
are normal and are skipped; they are not errors.

`config/` at the Minecraft instance root is **mod configuration**, not a second Minecraft
installation. When `mods/` is selected, Totem preserves this directory in both manifest and full
mods selections when it is present. It is copied recursively in the output and included in the
manifest estimate. This keeps mod settings alongside a manifest or a full mod backup.

If `saves/` is present, Totem asks separately whether to include it. It never assumes that a world
should be copied. When present, these known mod-created folders are also detected and offered as
individual toggles with friendly labels:

| Prompt label                 | Source folder                   |
| ---------------------------- | ------------------------------- |
| Xaero map data               | `xaero/`                        |
| Distant Horizons server data | `distant_horizons_server_data/` |
| JourneyMap data              | `journeymap/`                   |
| VoxelMap data                | `voxelmap/`                     |
| MapWriter data               | `mapwriter/`                    |
| Litematica data              | `litematica/`                   |
| Replay recordings            | `replay_recordings/`            |

In addition to these friendly known entries, Totem inspects the Minecraft instance root for
additional mod-data folders. Discovery is limited to immediate top-level directories; Totem does not
search recursively for new custom-folder roots or offer arbitrary nested directories as toggles.
Directories already handled by another selection and standard Minecraft/runtime directories are
excluded case-insensitively, including `config/`, `screenshots/`, `mods/`, `shaderpacks/`,
`resourcepacks/`, `saves/`, `logs/`, `crash-reports/`, `versions/`, `assets/`, `libraries/`,
`resources/`, `cache/`, `defaultconfigs/`, `.fabric/`, and `.mixin.out/`, along with other ordinary
runtime directories.

Each additional folder receives a stable custom ID, uses its actual folder name as its prompt label,
and keeps its actual source path. Totem estimates each candidate's full recursive byte size for the
toggle. Only custom folders selected in the prompt are copied, recursively, using their actual
folder paths and names; detected but unselected folders remain outside the backup.

When `screenshots/` is present, it is copied recursively, preserving its relative tree; it is
omitted when absent. `options.txt` is copied when present. The remaining choices are whether to
create a ZIP archive and whether to open the completed output location in the operating system's
file manager. For uncompressed output, **Open when done** opens the backup directory; when ZIP
output is enabled, it opens the containing output location where the sibling ZIP and backup
directory were written.

## Output layouts

Totem creates a collision-safe backup directory below the selected destination. Optional entries are
omitted when their source folder is absent or their prompt is declined. Every successful backup
includes `info.md`, which records detected Minecraft/loader metadata, selections, copy statistics,
duration, and surfaced file-system errors.

With **Manifest** selected for the three standard content folders, the directory looks like:

```text
<destination>/<backup-name>/
├── screenshots/                    # recursive copy, when present; omitted otherwise
├── mods.txt                        # when mods/ was present and selected as manifest
├── config/                         # mod configs; with a manifest mods selection, if present
├── resourcepacks.txt               # when resourcepacks/ was selected as manifest
├── shaders.txt                     # when shaderpacks/ was selected as manifest
├── shader-configs/                 # applicable root shader .txt configs, when present
├── options.txt                     # when present
├── saves/                          # when present and separately confirmed
├── xaero/                          # when present and toggled on
├── distant_horizons_server_data/   # when present and toggled on
├── journeymap/                     # when present and toggled on
├── voxelmap/                       # when present and toggled on
├── mapwriter/                      # when present and toggled on
├── litematica/                     # when present and toggled on
├── replay_recordings/              # when present and toggled on
└── info.md
```

Manifest files list both files and directories and are stable for unchanged input. Root-level `.txt`
shader configurations are preserved under `shader-configs/` and are not counted as shader payload
entries in `shaders.txt`.

With **Full** selected for the three standard content folders, the content folders retain their
copy/paste-ready names:

```text
<destination>/<backup-name>/
├── screenshots/                    # recursive copy, when present; omitted otherwise
├── mods/                           # full recursive copy, when selected
├── config/                         # mod configs, with a full mods selection, if present
├── resourcepacks/                  # full recursive copy, when selected
├── shaderpacks/                    # full recursive copy, when selected
├── options.txt                     # when present
├── saves/                          # when present and separately confirmed
├── <enabled detected custom folders>/
└── info.md
```

Manifest and full can be chosen independently per standard folder, so a backup may contain (for
example) `mods/` and `resourcepacks.txt` at the same time. A selected custom folder or `saves/` is
copied recursively with its source folder name. Custom folders are not invented when absent.

If ZIP output is selected, Totem writes a sibling `<backup-name>.zip` beside the directory. The TUI
shows the generated paths; the completion result identifies the ZIP as `outputPath` and keeps the
directory as `directoryPath`. ZIP creation is local and does not upload anything.

## Options, permissions, and commands

| Option                | When shown                                                           | Effect                                                                                                             |
| --------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Manifest or Full      | For each present `mods/`, `resourcepacks/`, `shaderpacks/`           | Choose inventory/config output or a full recursive copy.                                                           |
| Include saves         | Only when `saves/` is present                                        | Separately confirm copying worlds and their data.                                                                  |
| Custom-folder toggles | When a known or eligible additional immediate root folder is present | Copy only selected mod-created data recursively.                                                                   |
| ZIP output            | Always                                                               | Create a sibling ZIP beside the backup directory.                                                                  |
| Open when done        | Always                                                               | Open the backup directory for uncompressed output; open its containing output location when ZIP output is enabled. |

`deno task start` grants exactly `--allow-read --allow-write --allow-env --allow-run`:

- read access for inspection and source files;
- write access for the backup directory and optional ZIP;
- environment access for platform and path detection; and
- run access only for the optional file-manager opener.

Totem passes the output path as an argument; it does not build shell command strings or interpolate
paths into a shell. The compile task embeds the same runtime permissions:

```sh
deno task compile
```

The compile task runs:

```sh
deno eval "await Deno.mkdir('dist', { recursive: true });" && deno compile --allow-read --allow-write --allow-env --allow-run --output dist/totem src/main.ts
```

This creates `dist/totem` (or the platform executable name) after preparing `dist/`. For
development, the repository also defines these exact commands:

```sh
deno task check
deno task test
deno task test:watch
```

## Validation and error behavior

- An empty, missing, or non-directory instance path is actionable: Totem reports that the source
  must be a readable directory and does not start a backup.
- Missing optional folders are expected. Totem skips them and does not ask for toggles or modes that
  cannot apply.
- Read, write, recursive-copy, manifest, and ZIP failures are surfaced in the TUI result and
  recorded in `info.md`; metadata failures are surfaced in the TUI result and recorded in `info.md`
  when that file can be written. They are not silently converted into a successful backup.
- The destination cannot be the source instance or a directory inside it. Totem rejects that
  selection before copying.
- Totem never silently overwrites an existing output directory. It chooses a collision-safe name and
  reports the resulting paths.

## Scope boundaries

Totem intentionally does not snapshot every file in a Minecraft instance. Logs, launcher state,
arbitrary root configuration files, and unselected worlds, custom folders, or standard content
folders remain outside the backup. Manifest mode inventories names and preserves applicable
configuration; it is not an installer. Full mode copies only the folders explicitly selected in the
TUI.

There is no restore command, cloud or remote storage, scheduling, incremental deduplication,
encryption, Minecraft installation, or mod/resource/shader download service.

## Attribution and license

Totem is Copyright (c) Vaalley and is released under the [MIT License](LICENSE).
