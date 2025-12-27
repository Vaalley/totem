package main

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/vaalley/totem/internal/backup"
	"github.com/vaalley/totem/internal/tui"
	"github.com/vaalley/totem/internal/version"
)

// Colors matching TUI
var (
	stone      = lipgloss.Color("#A8A29E")
	stoneLight = lipgloss.Color("#D6D3D1")
	stoneDark  = lipgloss.Color("#78716C")
	orange     = lipgloss.Color("#F97316")
	grass      = lipgloss.Color("#22C55E")
	dim        = lipgloss.Color("#57534E")
	red        = lipgloss.Color("#EF4444")
)

// Styles
var (
	logoStyle = lipgloss.NewStyle().
			Foreground(stone).
			Bold(true)

	titleStyle = lipgloss.NewStyle().
			Foreground(stoneLight).
			Bold(true)

	successStyle = lipgloss.NewStyle().
			Foreground(grass).
			Bold(true)

	errorStyle = lipgloss.NewStyle().
			Foreground(red).
			Bold(true)

	labelStyle = lipgloss.NewStyle().
			Foreground(stone)

	valueStyle = lipgloss.NewStyle().
			Foreground(stoneLight)

	boxStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(stoneDark).
			Padding(1, 3).
			MarginTop(1)

	successBoxStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(grass).
			Padding(1, 3).
			MarginTop(1)

	errorBoxStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(red).
			Padding(1, 3).
			MarginTop(1)

	spinnerFrames = []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}
)

func clearScreen() {
	fmt.Print("\033[H\033[2J")
}

func showSpinner(message string, done chan bool) {
	i := 0
	spinnerStyle := lipgloss.NewStyle().Foreground(orange).Bold(true)
	for {
		select {
		case <-done:
			return
		default:
			fmt.Printf("\r  %s %s", spinnerStyle.Render(spinnerFrames[i%len(spinnerFrames)]), message)
			i++
			time.Sleep(80 * time.Millisecond)
		}
	}
}

func renderLogo() string {
	logo := `
 ████████╗ ██████╗ ████████╗███████╗███╗   ███╗
 ╚══██╔══╝██╔═══██╗╚══██╔══╝██╔════╝████╗ ████║
    ██║   ██║   ██║   ██║   █████╗  ██╔████╔██║
    ██║   ██║   ██║   ██║   ██╔══╝  ██║╚██╔╝██║
    ██║   ╚██████╔╝   ██║   ███████╗██║ ╚═╝ ██║
    ╚═╝    ╚═════╝    ╚═╝   ╚══════╝╚═╝     ╚═╝`
	return logoStyle.Render(logo)
}

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

func showSuccessScreen(result *backup.Result) {
	clearScreen()

	fmt.Println(renderLogo())
	fmt.Printf("    %s\n", lipgloss.NewStyle().Foreground(dim).Render(
		fmt.Sprintf("Minecraft Backup Utility v%s", version.Version)))
	fmt.Println()

	// Success header
	header := successStyle.Render("✓ Backup Complete!")
	fmt.Printf("  %s\n", header)

	// Stats box
	var stats strings.Builder
	stats.WriteString(fmt.Sprintf("%s %s\n",
		labelStyle.Render("Output:"),
		valueStyle.Render(result.OutputPath)))
	stats.WriteString(fmt.Sprintf("%s %s\n",
		labelStyle.Render("Duration:"),
		valueStyle.Render(result.Duration.Round(time.Millisecond).String())))
	stats.WriteString(fmt.Sprintf("%s %s\n",
		labelStyle.Render("Files:"),
		valueStyle.Render(fmt.Sprintf("%d files copied", result.TotalFiles))))

	// Item breakdown
	stats.WriteString("\n")
	stats.WriteString(labelStyle.Render("Contents:") + "\n")
	if result.Stats.ScreenshotsCopied > 0 {
		stats.WriteString(fmt.Sprintf("  📸 %d screenshots\n", result.Stats.ScreenshotsCopied))
	}
	if result.Stats.ModsListed > 0 {
		stats.WriteString(fmt.Sprintf("  📦 %d mods listed\n", result.Stats.ModsListed))
	}
	if result.Stats.ShadersListed > 0 {
		stats.WriteString(fmt.Sprintf("  ✨ %d shaders listed\n", result.Stats.ShadersListed))
	}
	if result.Stats.ShaderConfigsCopied > 0 {
		stats.WriteString(fmt.Sprintf("  ⚙️  %d shader configs\n", result.Stats.ShaderConfigsCopied))
	}
	if result.Stats.ResourcepacksListed > 0 {
		stats.WriteString(fmt.Sprintf("  🎨 %d resource packs\n", result.Stats.ResourcepacksListed))
	}
	if result.Stats.SavesCopied > 0 {
		stats.WriteString(fmt.Sprintf("  🌍 %d save files\n", result.Stats.SavesCopied))
	}
	if result.Stats.XaeroCopied > 0 {
		stats.WriteString(fmt.Sprintf("  🗺️  %d xaero files\n", result.Stats.XaeroCopied))
	}
	if result.Stats.DistantHorizonsCopied > 0 {
		stats.WriteString(fmt.Sprintf("  🏔️  %d DH files\n", result.Stats.DistantHorizonsCopied))
	}

	fmt.Println(successBoxStyle.Render(stats.String()))
	fmt.Println()
}

func showErrorScreen(result *backup.Result) {
	clearScreen()

	fmt.Println(renderLogo())
	fmt.Printf("    %s\n", lipgloss.NewStyle().Foreground(dim).Render(
		fmt.Sprintf("Minecraft Backup Utility v%s", version.Version)))
	fmt.Println()

	header := errorStyle.Render("✗ Backup Completed with Errors")
	fmt.Printf("  %s\n", header)

	var errors strings.Builder
	errors.WriteString(fmt.Sprintf("%s %s\n\n",
		labelStyle.Render("Output:"),
		valueStyle.Render(result.OutputPath)))
	errors.WriteString(errorStyle.Render("Errors:") + "\n")
	for _, err := range result.Errors {
		errors.WriteString(fmt.Sprintf("  • %s\n", err))
	}

	fmt.Println(errorBoxStyle.Render(errors.String()))
	fmt.Println()
}

func showCancelledScreen() {
	clearScreen()

	fmt.Println(renderLogo())
	fmt.Printf("    %s\n", lipgloss.NewStyle().Foreground(dim).Render(
		fmt.Sprintf("Minecraft Backup Utility v%s", version.Version)))
	fmt.Println()

	fmt.Printf("  %s\n\n", labelStyle.Render("Backup cancelled."))
}

func main() {
	// Run the TUI
	config, err := tui.Run()
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		os.Exit(1)
	}

	// If user cancelled, exit gracefully
	if config == nil {
		showCancelledScreen()
		os.Exit(0)
	}

	// Clear screen and show progress
	clearScreen()
	fmt.Println(renderLogo())
	fmt.Printf("    %s\n\n", lipgloss.NewStyle().Foreground(dim).Render(
		fmt.Sprintf("Minecraft Backup Utility v%s", version.Version)))

	// Start spinner in background
	done := make(chan bool)
	go showSpinner("Backing up your Minecraft installation...", done)

	// Perform the backup (with suppressed output)
	result, err := backup.PerformQuiet(config)
	
	// Stop spinner
	done <- true
	fmt.Print("\r" + strings.Repeat(" ", 60) + "\r") // Clear spinner line

	if err != nil {
		fmt.Printf("\n%s %v\n", errorStyle.Render("✗ Backup failed:"), err)
		os.Exit(1)
	}

	// Show result screen
	if result.Success {
		showSuccessScreen(result)
	} else {
		showErrorScreen(result)
		os.Exit(1)
	}
}
