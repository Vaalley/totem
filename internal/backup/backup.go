package backup

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/vaalley/totem/internal/tui"
	"github.com/vaalley/totem/internal/version"
)

// Result holds the backup result
type Result struct {
	Success    bool
	OutputPath string
	TotalFiles int
	Errors     []string
	Stats      Stats
	Duration   time.Duration
}

// Stats tracks backup statistics
type Stats struct {
	ScreenshotsCopied    int
	ModsListed           int
	ShadersListed        int
	ShaderConfigsCopied  int
	ResourcepacksListed  int
	SavesCopied          int
	XaeroCopied          int
	DistantHorizonsCopied int
}

// MinecraftInfo holds detected MC version info
type MinecraftInfo struct {
	Version       string
	Loader        string
	LoaderVersion string
}

// FileInfo holds file name and size
type FileInfo struct {
	Name string
	Size int64
}

// MinecraftPaths holds paths within the MC installation
type MinecraftPaths struct {
	Root            string
	Screenshots     string
	Mods            string
	Shaderpacks     string
	Resourcepacks   string
	Options         string
	Saves           string
	Xaero           string
	DistantHorizons string
}

func buildPaths(root string) MinecraftPaths {
	return MinecraftPaths{
		Root:            root,
		Screenshots:     filepath.Join(root, "screenshots"),
		Mods:            filepath.Join(root, "mods"),
		Shaderpacks:     filepath.Join(root, "shaderpacks"),
		Resourcepacks:   filepath.Join(root, "resourcepacks"),
		Options:         filepath.Join(root, "options.txt"),
		Saves:           filepath.Join(root, "saves"),
		Xaero:           filepath.Join(root, "xaero"),
		DistantHorizons: filepath.Join(root, "distant_horizons_server_data"),
	}
}

// Perform performs the backup
func Perform(config *tui.Config) (*Result, error) {
	startTime := time.Now()

	result := &Result{
		Success: true,
		Errors:  []string{},
		Stats:   Stats{},
	}

	// Build paths
	paths := buildPaths(config.MinecraftPath)

	// Validate MC path exists
	if _, err := os.Stat(paths.Root); os.IsNotExist(err) {
		return nil, fmt.Errorf("minecraft path does not exist: %s", paths.Root)
	}

	// Create backup folder with timestamp
	timestamp := time.Now().Format("2006-01-02_15-04")
	backupPath := filepath.Join(config.BackupDest, "backup_"+timestamp)
	if err := os.MkdirAll(backupPath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create backup folder: %w", err)
	}

	fmt.Printf("  → Creating backup: %s\n", backupPath)

	// 1. Copy screenshots
	if exists(paths.Screenshots) {
		fmt.Println("  → Copying screenshots...")
		count, err := copyDir(paths.Screenshots, filepath.Join(backupPath, "screenshots"))
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("screenshots: %v", err))
		} else {
			result.Stats.ScreenshotsCopied = count
			result.TotalFiles += count
			fmt.Printf("    Copied %d files\n", count)
		}
	}

	// 2. List mods
	if exists(paths.Mods) {
		fmt.Println("  → Listing mods...")
		mods, err := listFiles(paths.Mods)
		if err == nil {
			result.Stats.ModsListed = len(mods)
			content := strings.Join(mods, "\n")
			os.WriteFile(filepath.Join(backupPath, "mods.txt"), []byte(content), 0644)
			fmt.Printf("    Listed %d mods\n", len(mods))
		}
	}

	// 3. Process shaderpacks
	if exists(paths.Shaderpacks) {
		fmt.Println("  → Processing shaderpacks...")
		shaders, configs, err := processShaderpacks(paths.Shaderpacks, backupPath)
		if err == nil {
			result.Stats.ShadersListed = len(shaders)
			result.Stats.ShaderConfigsCopied = configs
			fmt.Printf("    Listed %d shaders, copied %d configs\n", len(shaders), configs)
		}
	}

	// 4. List resource packs
	if exists(paths.Resourcepacks) {
		fmt.Println("  → Listing resource packs...")
		packs, err := listFiles(paths.Resourcepacks)
		if err == nil {
			result.Stats.ResourcepacksListed = len(packs)
			content := strings.Join(packs, "\n")
			os.WriteFile(filepath.Join(backupPath, "resourcepacks.txt"), []byte(content), 0644)
			fmt.Printf("    Listed %d packs\n", len(packs))
		}
	}

	// 5. Copy options.txt
	if exists(paths.Options) {
		fmt.Println("  → Copying options.txt...")
		copyFile(paths.Options, filepath.Join(backupPath, "options.txt"))
	}

	// 6. Optional: saves
	if config.IncludeSaves && exists(paths.Saves) {
		fmt.Println("  → Copying saves (this may take a while)...")
		count, err := copyDir(paths.Saves, filepath.Join(backupPath, "saves"))
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("saves: %v", err))
		} else {
			result.Stats.SavesCopied = count
			result.TotalFiles += count
			fmt.Printf("    Copied %d files\n", count)
		}
	}

	// 7. Optional: xaero
	if config.IncludeXaero && exists(paths.Xaero) {
		fmt.Println("  → Copying Xaero maps...")
		count, err := copyDir(paths.Xaero, filepath.Join(backupPath, "xaero"))
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("xaero: %v", err))
		} else {
			result.Stats.XaeroCopied = count
			result.TotalFiles += count
			fmt.Printf("    Copied %d files\n", count)
		}
	}

	// 8. Optional: Distant Horizons
	if config.IncludeDH && exists(paths.DistantHorizons) {
		fmt.Println("  → Copying Distant Horizons data...")
		count, err := copyDir(paths.DistantHorizons, filepath.Join(backupPath, "distant_horizons_server_data"))
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("distant_horizons: %v", err))
		} else {
			result.Stats.DistantHorizonsCopied = count
			result.TotalFiles += count
			fmt.Printf("    Copied %d files\n", count)
		}
	}

	// Record duration before generating info
	result.Duration = time.Since(startTime)

	// 9. Generate info.md
	fmt.Println("  → Generating info.md...")
	generateInfoMD(backupPath, config, result, paths)

	result.OutputPath = backupPath

	// 10. Zip if requested
	if config.ZipOutput {
		fmt.Println("  → Creating zip archive...")
		zipPath := backupPath + ".zip"
		if err := createZip(backupPath, zipPath); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("zip: %v", err))
		} else {
			// Remove the unzipped folder
			os.RemoveAll(backupPath)
			result.OutputPath = zipPath
			fmt.Println("    Zip created successfully")
		}
	}

	// 11. Open folder if requested
	if config.OpenWhenDone {
		openFolder(filepath.Dir(result.OutputPath))
	}

	result.Success = len(result.Errors) == 0
	return result, nil
}

// PerformQuiet performs the backup without console output (for spinner compatibility)
func PerformQuiet(config *tui.Config) (*Result, error) {
	startTime := time.Now()

	result := &Result{
		Success: true,
		Errors:  []string{},
		Stats:   Stats{},
	}

	// Build paths
	paths := buildPaths(config.MinecraftPath)

	// Validate MC path exists
	if _, err := os.Stat(paths.Root); os.IsNotExist(err) {
		return nil, fmt.Errorf("minecraft path does not exist: %s", paths.Root)
	}

	// Create backup folder with timestamp
	timestamp := time.Now().Format("2006-01-02_15-04")
	backupPath := filepath.Join(config.BackupDest, "backup_"+timestamp)
	if err := os.MkdirAll(backupPath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create backup folder: %w", err)
	}

	// 1. Copy screenshots
	if exists(paths.Screenshots) {
		count, err := copyDir(paths.Screenshots, filepath.Join(backupPath, "screenshots"))
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("screenshots: %v", err))
		} else {
			result.Stats.ScreenshotsCopied = count
			result.TotalFiles += count
		}
	}

	// 2. List mods
	if exists(paths.Mods) {
		mods, err := listFiles(paths.Mods)
		if err == nil {
			result.Stats.ModsListed = len(mods)
			content := strings.Join(mods, "\n")
			os.WriteFile(filepath.Join(backupPath, "mods.txt"), []byte(content), 0644)
		}
	}

	// 3. Process shaderpacks
	if exists(paths.Shaderpacks) {
		shaders, configs, err := processShaderpacks(paths.Shaderpacks, backupPath)
		if err == nil {
			result.Stats.ShadersListed = len(shaders)
			result.Stats.ShaderConfigsCopied = configs
		}
	}

	// 4. List resource packs
	if exists(paths.Resourcepacks) {
		packs, err := listFiles(paths.Resourcepacks)
		if err == nil {
			result.Stats.ResourcepacksListed = len(packs)
			content := strings.Join(packs, "\n")
			os.WriteFile(filepath.Join(backupPath, "resourcepacks.txt"), []byte(content), 0644)
		}
	}

	// 5. Copy options.txt
	if exists(paths.Options) {
		copyFile(paths.Options, filepath.Join(backupPath, "options.txt"))
	}

	// 6. Optional: saves
	if config.IncludeSaves && exists(paths.Saves) {
		count, err := copyDir(paths.Saves, filepath.Join(backupPath, "saves"))
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("saves: %v", err))
		} else {
			result.Stats.SavesCopied = count
			result.TotalFiles += count
		}
	}

	// 7. Optional: xaero
	if config.IncludeXaero && exists(paths.Xaero) {
		count, err := copyDir(paths.Xaero, filepath.Join(backupPath, "xaero"))
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("xaero: %v", err))
		} else {
			result.Stats.XaeroCopied = count
			result.TotalFiles += count
		}
	}

	// 8. Optional: Distant Horizons
	if config.IncludeDH && exists(paths.DistantHorizons) {
		count, err := copyDir(paths.DistantHorizons, filepath.Join(backupPath, "distant_horizons_server_data"))
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("distant_horizons: %v", err))
		} else {
			result.Stats.DistantHorizonsCopied = count
			result.TotalFiles += count
		}
	}

	// Record duration before generating info
	result.Duration = time.Since(startTime)

	// 9. Generate info.md
	generateInfoMD(backupPath, config, result, paths)

	result.OutputPath = backupPath

	// 10. Zip if requested
	if config.ZipOutput {
		zipPath := backupPath + ".zip"
		if err := createZip(backupPath, zipPath); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("zip: %v", err))
		} else {
			os.RemoveAll(backupPath)
			result.OutputPath = zipPath
		}
	}

	// 11. Open folder if requested
	if config.OpenWhenDone {
		openFolder(filepath.Dir(result.OutputPath))
	}

	result.Success = len(result.Errors) == 0
	return result, nil
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func listFiles(dir string) ([]string, error) {
	var files []string
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if !e.IsDir() {
			files = append(files, e.Name())
		}
	}
	return files, nil
}

func copyFile(src, dst string) error {
	source, err := os.Open(src)
	if err != nil {
		return err
	}
	defer source.Close()

	dest, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer dest.Close()

	_, err = io.Copy(dest, source)
	return err
}

func copyDir(src, dst string) (int, error) {
	count := 0
	err := filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		relPath, _ := filepath.Rel(src, path)
		destPath := filepath.Join(dst, relPath)

		if d.IsDir() {
			return os.MkdirAll(destPath, 0755)
		}

		if err := copyFile(path, destPath); err != nil {
			return err
		}
		count++
		return nil
	})
	return count, err
}

func processShaderpacks(srcDir, backupDir string) ([]string, int, error) {
	var shaders []string
	configCount := 0

	entries, err := os.ReadDir(srcDir)
	if err != nil {
		return nil, 0, err
	}

	configDir := filepath.Join(backupDir, "shader_configs")
	os.MkdirAll(configDir, 0755)

	for _, e := range entries {
		name := e.Name()
		if strings.HasSuffix(name, ".txt") {
			// Config file
			copyFile(filepath.Join(srcDir, name), filepath.Join(configDir, name))
			configCount++
		} else {
			// Shader pack
			shaders = append(shaders, name)
		}
	}

	// Write shaders.txt
	content := strings.Join(shaders, "\n")
	os.WriteFile(filepath.Join(backupDir, "shaders.txt"), []byte(content), 0644)

	return shaders, configCount, nil
}

// getMinecraftInfo detects Minecraft version and mod loader
func getMinecraftInfo(mcRoot string) MinecraftInfo {
	info := MinecraftInfo{
		Version:       "Unknown",
		Loader:        "Unknown",
		LoaderVersion: "Unknown",
	}

	// Check mods folder for loader indicators
	modsPath := filepath.Join(mcRoot, "mods")
	if exists(modsPath) {
		entries, _ := os.ReadDir(modsPath)
		for _, e := range entries {
			name := strings.ToLower(e.Name())
			if strings.Contains(name, "fabric") {
				info.Loader = "Fabric"
				break
			} else if strings.Contains(name, "forge") {
				info.Loader = "Forge"
				break
			} else if strings.Contains(name, "quilt") {
				info.Loader = "Quilt"
				break
			}
		}
	}

	// Try mmc-pack.json (MultiMC/Prism)
	mmcPackPath := filepath.Join(mcRoot, "..", "mmc-pack.json")
	if exists(mmcPackPath) {
		data, err := os.ReadFile(mmcPackPath)
		if err == nil {
			var mmcData struct {
				Components []struct {
					UID     string `json:"uid"`
					Version string `json:"version"`
				} `json:"components"`
			}
			if json.Unmarshal(data, &mmcData) == nil {
				for _, c := range mmcData.Components {
					if c.UID == "net.minecraft" {
						info.Version = c.Version
					} else if c.UID == "net.fabricmc.fabric-loader" {
						info.Loader = "Fabric"
						info.LoaderVersion = c.Version
					} else if c.UID == "net.minecraftforge" {
						info.Loader = "Forge"
						info.LoaderVersion = c.Version
					}
				}
			}
		}
	}

	// Try instance.cfg (MultiMC/Prism)
	instanceCfgPath := filepath.Join(mcRoot, "..", "instance.cfg")
	if exists(instanceCfgPath) {
		data, err := os.ReadFile(instanceCfgPath)
		if err == nil {
			lines := strings.Split(string(data), "\n")
			for _, line := range lines {
				if strings.HasPrefix(line, "IntendedVersion=") {
					info.Version = strings.TrimPrefix(line, "IntendedVersion=")
					info.Version = strings.TrimSpace(info.Version)
				}
			}
		}
	}

	return info
}

// getDirSize calculates directory size in bytes
func getDirSize(path string) int64 {
	var size int64
	filepath.WalkDir(path, func(_ string, d fs.DirEntry, _ error) error {
		if !d.IsDir() {
			info, err := d.Info()
			if err == nil {
				size += info.Size()
			}
		}
		return nil
	})
	return size
}

// formatBytes converts bytes to human-readable format
func formatBytes(bytes int64) string {
	if bytes == 0 {
		return "0 B"
	}
	units := []string{"B", "KB", "MB", "GB", "TB"}
	k := float64(1024)
	b := float64(bytes)
	i := 0
	for b >= k && i < len(units)-1 {
		b /= k
		i++
	}
	return fmt.Sprintf("%.1f %s", b, units[i])
}

// formatDuration formats duration as human-readable
func formatDuration(d time.Duration) string {
	secs := d.Seconds()
	if secs < 60 {
		return fmt.Sprintf("%.1f seconds", secs)
	}
	mins := int(secs / 60)
	secsRem := int(secs) % 60
	return fmt.Sprintf("%dm %ds", mins, secsRem)
}

// getLargestItems gets the largest files/folders in a directory
func getLargestItems(dirPath string, limit int) []FileInfo {
	var items []FileInfo

	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return items
	}

	for _, e := range entries {
		path := filepath.Join(dirPath, e.Name())
		var size int64
		if e.IsDir() {
			size = getDirSize(path)
		} else {
			info, err := e.Info()
			if err == nil {
				size = info.Size()
			}
		}
		items = append(items, FileInfo{Name: e.Name(), Size: size})
	}

	// Sort by size descending
	sort.Slice(items, func(i, j int) bool {
		return items[i].Size > items[j].Size
	})

	if len(items) > limit {
		return items[:limit]
	}
	return items
}

// getOSInfo returns OS and arch string
func getOSInfo() string {
	osNames := map[string]string{
		"windows": "Windows",
		"darwin":  "macOS",
		"linux":   "Linux",
	}
	osName := osNames[runtime.GOOS]
	if osName == "" {
		osName = runtime.GOOS
	}
	return fmt.Sprintf("%s (%s)", osName, runtime.GOARCH)
}

func generateInfoMD(backupPath string, config *tui.Config, result *Result, paths MinecraftPaths) {
	// Get Minecraft info
	mcInfo := getMinecraftInfo(config.MinecraftPath)

	// Get sizes
	backupSize := getDirSize(backupPath)
	modsSize := getDirSize(paths.Mods)
	savesSize := int64(0)
	if config.IncludeSaves {
		savesSize = getDirSize(paths.Saves)
	}

	// Get largest mods
	largestMods := getLargestItems(paths.Mods, 3)
	largestModsStr := ""
	if len(largestMods) > 0 {
		for _, m := range largestMods {
			largestModsStr += fmt.Sprintf("  - %s (%s)\n", m.Name, formatBytes(m.Size))
		}
	} else {
		largestModsStr = "  - None found\n"
	}

	// Get largest saves if included
	largestSavesStr := ""
	if config.IncludeSaves && exists(paths.Saves) {
		largestSaves := getLargestItems(paths.Saves, 3)
		if len(largestSaves) > 0 {
			largestSavesStr = fmt.Sprintf(`
## 🌍 Save Statistics

- **World count:** %d+ worlds
- **Total size:** %s
- **Largest worlds:**
`, len(largestSaves), formatBytes(savesSize))
			for _, s := range largestSaves {
				largestSavesStr += fmt.Sprintf("  - %s (%s)\n", s.Name, formatBytes(s.Size))
			}
		}
	}

	// Calculate total files
	totalFiles := result.Stats.ScreenshotsCopied + result.Stats.ShaderConfigsCopied +
		result.Stats.SavesCopied + result.Stats.XaeroCopied + result.Stats.DistantHorizonsCopied

	// Loader version string
	loaderStr := mcInfo.Loader
	if mcInfo.LoaderVersion != "Unknown" {
		loaderStr += fmt.Sprintf(" (%s)", mcInfo.LoaderVersion)
	}

	// Errors or success status
	statusStr := "## ✅ Status\n\nBackup completed successfully with no errors."
	if len(result.Errors) > 0 {
		statusStr = "## ⚠️ Errors\n\n"
		for _, e := range result.Errors {
			statusStr += fmt.Sprintf("- %s\n", e)
		}
	}

	content := fmt.Sprintf(`# 🗿 Totem Backup

> Generated on %s

---

## 📋 System Information

| Property | Value |
|----------|-------|
| Minecraft Version | %s |
| Mod Loader | %s |
| Operating System | %s |
| Totem Version | v` + version.Version + ` |

---

## 📦 Backup Details

| Property | Value |
|----------|-------|
| Source Path | `+"`%s`"+` |
| Backup Duration | %s |
| Total Backup Size | %s |
| Total Files Copied | %d files |

---

## 📁 Contents

| Item | Count |
|------|-------|
| Screenshots | %d files |
| Mods | %d mods (%s total) |
| Shaders | %d shaders |
| Shader Configs | %d files |
| Resource Packs | %d packs |
| Saves | %d files |
| Xaero Maps | %d files |
| Distant Horizons | %d files |

---

## 📊 Mod Statistics

- **Total Mods:** %d
- **Total Size:** %s
- **Largest Mods:**
%s%s
---

## 🔧 Restoration Guide

### 1. Screenshots
Copy the `+"`screenshots/`"+` folder back to your minecraft folder.

### 2. Mods
Re-download mods listed in `+"`mods.txt`"+` from [Modrinth](https://modrinth.com) or [CurseForge](https://curseforge.com).

### 3. Shaders
- Re-download shaders listed in `+"`shaders.txt`"+`
- Copy `+"`shader_configs/`"+` contents to your `+"`shaderpacks/`"+` folder

### 4. Resource Packs
Re-download packs listed in `+"`resourcepacks.txt`"+`.

### 5. Options
Copy `+"`options.txt`"+` to your minecraft folder.

### 6. Saves (if included)
Copy the `+"`saves/`"+` folder back to your minecraft folder.

---

%s

---

*Generated by [Totem](https://github.com/vaalley/totem) - Minecraft Backup Utility*
`,
		time.Now().Format("2006-01-02 15:04:05"),
		mcInfo.Version,
		loaderStr,
		getOSInfo(),
		config.MinecraftPath,
		formatDuration(result.Duration),
		formatBytes(backupSize),
		totalFiles,
		result.Stats.ScreenshotsCopied,
		result.Stats.ModsListed, formatBytes(modsSize),
		result.Stats.ShadersListed,
		result.Stats.ShaderConfigsCopied,
		result.Stats.ResourcepacksListed,
		result.Stats.SavesCopied,
		result.Stats.XaeroCopied,
		result.Stats.DistantHorizonsCopied,
		result.Stats.ModsListed,
		formatBytes(modsSize),
		largestModsStr,
		largestSavesStr,
		statusStr,
	)

	os.WriteFile(filepath.Join(backupPath, "info.md"), []byte(content), 0644)
}

func createZip(srcDir, destZip string) error {
	zipFile, err := os.Create(destZip)
	if err != nil {
		return err
	}
	defer zipFile.Close()

	w := zip.NewWriter(zipFile)
	defer w.Close()

	return filepath.WalkDir(srcDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		if d.IsDir() {
			return nil
		}

		relPath, _ := filepath.Rel(srcDir, path)
		f, err := w.Create(relPath)
		if err != nil {
			return err
		}

		source, err := os.Open(path)
		if err != nil {
			return err
		}
		defer source.Close()

		_, err = io.Copy(f, source)
		return err
	})
}

func openFolder(path string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", path)
	case "darwin":
		cmd = exec.Command("open", path)
	default:
		cmd = exec.Command("xdg-open", path)
	}
	cmd.Start()
}
