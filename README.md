# 🗿 Totem

A beautiful TUI for backing up your Minecraft installation. Built with
[Bun](https://bun.sh) and TypeScript.

![Totem CLI Screenshot](./image.png)

## Features

- 🎮 **Interactive checkbox UI** - Arrow keys to navigate, space to toggle
- 📸 **Screenshots** - Full folder backup
- 📦 **Mods, Shaders, Resource Packs** - Saved as text lists
- ⚙️ **Shader Configs** - Copied to separate folder
- 🌍 **World Saves** - Optional full backup (can be large!)
- 🗺️ **Xaero's Maps** - Optional backup
- 🏔️ **Distant Horizons** - Optional LOD data backup
- 🗜️ **Zip compression** - Optional archive output
- 📂 **Auto-open** - Opens backup folder when done

## Installation

```bash
# Clone the repo
git clone https://github.com/vaalley/totem.git
cd totem

# Install dependencies
bun install
```

## Usage

```bash
# Run interactively
bun run start

# Or directly
bun run index.ts
```

## Build Executable

Create a standalone `.exe` that doesn't require Bun:

```bash
bun run build
# Creates totem.exe
```

## Backup Output

```
backup_2024-12-16_16-20/
├── screenshots/           # Full folder copy
├── mods.txt               # Mod names
├── shaders.txt            # Shader pack names
├── shader_configs/        # Shader config files
├── resourcepacks.txt      # Resource pack names
├── saves/                 # World saves (optional)
├── xaero/                 # Xaero maps (optional)
├── distant_horizons.../   # DH data (optional)
├── options.txt            # Minecraft options
└── info.md                # Backup metadata
```

## Development

```bash
# Lint
bun run lint

# Lint with auto-fix
bun run lint:fix

# Type check
bunx tsc --noEmit
```

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Language**: TypeScript
- **TUI**: [@inquirer/prompts](https://www.npmjs.com/package/@inquirer/prompts)
- **Styling**: [chalk](https://www.npmjs.com/package/chalk)
- **Linting**: [oxlint](https://oxc.rs)

## License

MIT
