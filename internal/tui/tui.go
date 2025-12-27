package tui

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/vaalley/totem/internal/version"
)

// Config holds the user's selections
type Config struct {
	MinecraftPath string
	BackupDest    string
	ZipOutput     bool
	IncludeSaves  bool
	IncludeXaero  bool
	IncludeDH     bool
	OpenWhenDone  bool
}

// Stage represents the current TUI stage
type Stage int

const (
	StageOptions Stage = iota
	StageMCPath
	StageBackupDest
	StageDone
)

// Option represents a toggleable option
type Option struct {
	Name    string
	Desc    string
	Checked bool
	Icon    string
}

// Model is the bubbletea model
type Model struct {
	stage      Stage
	options    []Option
	cursor     int
	textInput  textinput.Model
	mcPath     string
	backupDest string
	quitting   bool
	cancelled  bool
	width      int
	height     int
}

// Colors - Stone/Earth palette with orange accent
var (
	stone      = lipgloss.Color("#A8A29E") // Warm gray stone
	stoneLight = lipgloss.Color("#D6D3D1") // Light stone
	stoneDark  = lipgloss.Color("#78716C") // Dark stone
	sand       = lipgloss.Color("#E7E5E4") // Sand/beach
	orange     = lipgloss.Color("#F97316") // Orange accent
	grass      = lipgloss.Color("#22C55E") // Grass green
	night      = lipgloss.Color("#1C1917") // Night sky
	dim        = lipgloss.Color("#57534E") // Dim text
	white      = lipgloss.Color("#FAFAF9") // White
)

// Styles
var (
	// Logo style
	logoStyle = lipgloss.NewStyle().
			Foreground(stone).
			Bold(true)

	// Main container
	containerStyle = lipgloss.NewStyle().
			Padding(1, 3)

	// Section header
	sectionStyle = lipgloss.NewStyle().
			Foreground(orange).
			Bold(true).
			PaddingLeft(1).
			MarginTop(1)

	// Option box
	optionBoxStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(stoneDark).
			Padding(1, 2).
			MarginTop(1)

	// Option styles
	optionStyle = lipgloss.NewStyle().
			Foreground(sand)

	selectedOptionStyle = lipgloss.NewStyle().
				Foreground(orange).
				Bold(true)

	// Checkbox styles
	checkboxChecked   = lipgloss.NewStyle().Foreground(grass).Bold(true)
	checkboxUnchecked = lipgloss.NewStyle().Foreground(stoneDark)
	cursorActive      = lipgloss.NewStyle().Foreground(orange).Bold(true)

	// Description style
	descStyle = lipgloss.NewStyle().
			Foreground(dim).
			Italic(true)

	// Warning badge
	warningBadge = lipgloss.NewStyle().
			Background(orange).
			Foreground(night).
			Bold(true).
			Padding(0, 1).
			MarginLeft(1)

	// Input box
	inputBoxStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(orange).
			Padding(1, 2).
			MarginTop(1)

	// Input label
	inputLabelStyle = lipgloss.NewStyle().
			Foreground(sand).
			Bold(true).
			MarginBottom(1)

	// Progress styles
	progressActive   = lipgloss.NewStyle().Foreground(orange).Bold(true)
	progressComplete = lipgloss.NewStyle().Foreground(grass)
	progressPending  = lipgloss.NewStyle().Foreground(stoneDark)

	// Help bar
	helpStyle = lipgloss.NewStyle().
			Foreground(dim).
			MarginTop(2).
			Padding(0, 1)

	// Key badge
	keyStyle = lipgloss.NewStyle().
			Background(stoneDark).
			Foreground(sand).
			Padding(0, 1).
			MarginRight(1)

	// Subtitle
	subtitleStyle = lipgloss.NewStyle().
			Foreground(dim)

	// Divider
	dividerStyle = lipgloss.NewStyle().
			Foreground(stoneDark)
)

func initialModel() Model {
	ti := textinput.New()
	ti.Placeholder = "Enter path..."
	ti.Focus()
	ti.CharLimit = 256
	ti.Width = 55
	ti.PromptStyle = lipgloss.NewStyle().Foreground(orange)
	ti.TextStyle = lipgloss.NewStyle().Foreground(sand)
	ti.PlaceholderStyle = lipgloss.NewStyle().Foreground(dim)
	ti.Cursor.Style = lipgloss.NewStyle().Foreground(orange)

	return Model{
		stage: StageOptions,
		options: []Option{
			{Name: "Compress backup", Desc: "Create a .zip archive", Checked: false, Icon: "📦"},
			{Name: "Include saves", Desc: "World saves", Checked: false, Icon: "🌍"},
			{Name: "Include Xaero maps", Desc: "Minimap data", Checked: false, Icon: "🗺️"},
			{Name: "Include Distant Horizons", Desc: "LOD chunks", Checked: false, Icon: "🏔️"},
			{Name: "Open when done", Desc: "Open in explorer", Checked: true, Icon: "📂"},
		},
		textInput: ti,
		width:     80,
		height:    24,
	}
}

func (m Model) Init() tea.Cmd {
	return textinput.Blink
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "esc":
			m.quitting = true
			m.cancelled = true
			return m, tea.Quit
		}

		switch m.stage {
		case StageOptions:
			return m.updateOptions(msg)
		case StageMCPath, StageBackupDest:
			return m.updateTextInput(msg)
		}
	}

	if m.stage == StageMCPath || m.stage == StageBackupDest {
		var cmd tea.Cmd
		m.textInput, cmd = m.textInput.Update(msg)
		return m, cmd
	}

	return m, nil
}

func (m Model) updateOptions(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "up", "k":
		if m.cursor > 0 {
			m.cursor--
		}
	case "down", "j":
		if m.cursor < len(m.options)-1 {
			m.cursor++
		}
	case " ", "x":
		m.options[m.cursor].Checked = !m.options[m.cursor].Checked
	case "a":
		allChecked := true
		for _, opt := range m.options {
			if !opt.Checked {
				allChecked = false
				break
			}
		}
		for i := range m.options {
			m.options[i].Checked = !allChecked
		}
	case "enter":
		m.stage = StageMCPath
		m.textInput.Placeholder = "C:\\Users\\...\\minecraft or ~/.minecraft"
		m.textInput.SetValue("")
	}
	return m, nil
}

func (m Model) updateTextInput(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "enter":
		value := m.textInput.Value()
		if m.stage == StageMCPath {
			if value == "" {
				return m, nil
			}
			m.mcPath = value
			m.stage = StageBackupDest
			m.textInput.SetValue("")
			homeDir, _ := os.UserHomeDir()
			defaultDest := filepath.Join(homeDir, "TotemBackups")
			m.textInput.Placeholder = defaultDest
		} else if m.stage == StageBackupDest {
			if value == "" {
				homeDir, _ := os.UserHomeDir()
				m.backupDest = filepath.Join(homeDir, "TotemBackups")
			} else {
				m.backupDest = value
			}
			m.stage = StageDone
			m.quitting = true
			return m, tea.Quit
		}
	}

	var cmd tea.Cmd
	m.textInput, cmd = m.textInput.Update(msg)
	return m, cmd
}

func (m Model) View() string {
	if m.quitting && m.stage == StageDone {
		return ""
	}

	var s strings.Builder

	// Header
	s.WriteString(m.renderHeader())

	// Content
	switch m.stage {
	case StageOptions:
		s.WriteString(m.renderOptions())
	case StageMCPath:
		s.WriteString(m.renderMCPath())
	case StageBackupDest:
		s.WriteString(m.renderBackupDest())
	}

	return containerStyle.Render(s.String())
}

func (m Model) renderHeader() string {
	logo := `
 ████████╗ ██████╗ ████████╗███████╗███╗   ███╗
 ╚══██╔══╝██╔═══██╗╚══██╔══╝██╔════╝████╗ ████║
    ██║   ██║   ██║   ██║   █████╗  ██╔████╔██║
    ██║   ██║   ██║   ██║   ██╔══╝  ██║╚██╔╝██║
    ██║   ╚██████╔╝   ██║   ███████╗██║ ╚═╝ ██║
    ╚═╝    ╚═════╝    ╚═╝   ╚══════╝╚═╝     ╚═╝`

	styledLogo := logoStyle.Render(logo)

	subtitle := subtitleStyle.Render(
		fmt.Sprintf("    Minecraft Backup Utility v%s", version.Version))

	divider := dividerStyle.Render("\n" + strings.Repeat("─", 50) + "\n")

	return styledLogo + "\n" + subtitle + divider
}

func (m Model) renderOptions() string {
	var s strings.Builder

	title := sectionStyle.Render("⚙️  Backup Options")
	s.WriteString(title + "\n")

	var optionsContent strings.Builder
	for i, opt := range m.options {
		cursor := "  "
		if m.cursor == i {
			cursor = cursorActive.Render("▸ ")
		}

		checkbox := checkboxUnchecked.Render("○")
		if opt.Checked {
			checkbox = checkboxChecked.Render("●")
		}

		nameStyle := optionStyle
		if m.cursor == i {
			nameStyle = selectedOptionStyle
		}

		line := fmt.Sprintf("%s%s  %s %s",
			cursor,
			checkbox,
			opt.Icon,
			nameStyle.Render(opt.Name),
		)

		desc := descStyle.Render(" " + opt.Desc)

		if opt.Name == "Include saves" {
			desc += warningBadge.Render("LARGE")
		}

		optionsContent.WriteString(line + desc + "\n")
	}

	s.WriteString(optionBoxStyle.Render(optionsContent.String()))

	s.WriteString("\n\n")
	s.WriteString(m.renderProgress(1, 3))
	s.WriteString("\n" + m.renderHelp([]string{"↑↓", "space", "a", "enter", "esc"}, []string{"move", "toggle", "all", "next", "quit"}))

	return s.String()
}

func (m Model) renderMCPath() string {
	var s strings.Builder

	title := sectionStyle.Render("📂  Minecraft Installation")
	s.WriteString(title + "\n")

	var inputContent strings.Builder
	inputContent.WriteString(inputLabelStyle.Render("Enter path to .minecraft folder") + "\n")
	inputContent.WriteString(m.textInput.View())

	s.WriteString(inputBoxStyle.Render(inputContent.String()))

	s.WriteString("\n\n")
	s.WriteString(m.renderProgress(2, 3))
	s.WriteString("\n" + m.renderHelp([]string{"enter", "esc"}, []string{"confirm", "cancel"}))

	return s.String()
}

func (m Model) renderBackupDest() string {
	var s strings.Builder

	title := sectionStyle.Render("💾  Backup Destination")
	s.WriteString(title + "\n")

	var inputContent strings.Builder
	inputContent.WriteString(inputLabelStyle.Render("Where to save? (Enter for default)") + "\n")
	inputContent.WriteString(m.textInput.View())

	s.WriteString(inputBoxStyle.Render(inputContent.String()))

	s.WriteString("\n\n")
	s.WriteString(m.renderProgress(3, 3))
	s.WriteString("\n" + m.renderHelp([]string{"enter", "esc"}, []string{"start backup", "cancel"}))

	return s.String()
}

func (m Model) renderProgress(current, total int) string {
	var bar strings.Builder

	for i := 1; i <= total; i++ {
		if i < current {
			bar.WriteString(progressComplete.Render("━━━━"))
		} else if i == current {
			bar.WriteString(progressActive.Render("━━━━"))
		} else {
			bar.WriteString(progressPending.Render("────"))
		}
		if i < total {
			if i < current {
				bar.WriteString(progressComplete.Render("●"))
			} else if i == current {
				bar.WriteString(progressActive.Render("◉"))
			} else {
				bar.WriteString(progressPending.Render("○"))
			}
		}
	}

	label := subtitleStyle.Render(fmt.Sprintf("  Step %d of %d", current, total))

	return bar.String() + label
}

func (m Model) renderHelp(keys, descs []string) string {
	var items []string
	for i, key := range keys {
		item := keyStyle.Render(key) + lipgloss.NewStyle().Foreground(dim).Render(descs[i])
		items = append(items, item)
	}
	return helpStyle.Render(strings.Join(items, "  "))
}

// GetConfig returns the config from the model
func (m Model) GetConfig() *Config {
	if m.cancelled {
		return nil
	}
	return &Config{
		MinecraftPath: m.mcPath,
		BackupDest:    m.backupDest,
		ZipOutput:     m.options[0].Checked,
		IncludeSaves:  m.options[1].Checked,
		IncludeXaero:  m.options[2].Checked,
		IncludeDH:     m.options[3].Checked,
		OpenWhenDone:  m.options[4].Checked,
	}
}

// Run starts the TUI and returns the user's configuration
func Run() (*Config, error) {
	m := initialModel()
	p := tea.NewProgram(m, tea.WithAltScreen())

	finalModel, err := p.Run()
	if err != nil {
		return nil, err
	}

	return finalModel.(Model).GetConfig(), nil
}
