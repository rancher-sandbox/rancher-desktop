package autostart

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"text/template"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
)

const launchAgentFileTemplateContents = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>io.rancherdesktop.autostart</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/open</string>
        <string>-a</string>
        <string>{{ .RancherDesktopPath }}</string>
    </array>
    <key>ProcessType</key>
    <string>Interactive</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
</dict>
</plist>
`

type launchAgentFileData struct {
	RancherDesktopPath string
}

func EnsureAutostart(ctx context.Context, autostartDesired bool) error {
	// get path to LaunchAgent file
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to find home directory: %w", err)
	}
	launchAgentFilePath := filepath.Join(homeDir, "Library", "LaunchAgents", "io.rancherdesktop.autostart.plist")

	if autostartDesired {
		// ensure LaunchAgent directory is created
		launchAgentDir := filepath.Dir(launchAgentFilePath)
		err := os.MkdirAll(launchAgentDir, 0o755)
		if err != nil {
			return fmt.Errorf("failed to create LaunchAgent directory: %w", err)
		}

		// get current contents of LaunchAgent file
		currentContents, err := os.ReadFile(launchAgentFilePath)
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("failed to get current LaunchAgent file contents: %w", err)
		}

		// get desired contents of LaunchAgent file
		desiredContents, err := getDesiredLaunchAgentFileContents(ctx)
		if err != nil {
			return fmt.Errorf("failed to get desired LaunchAgent file contents: %w", err)
		}

		// update LaunchAgent file if contents differ
		if !bytes.Equal(currentContents, desiredContents) {
			err = os.WriteFile(launchAgentFilePath, desiredContents, 0o644)
			if err != nil {
				return fmt.Errorf("failed to write LaunchAgent file: %w", err)
			}
		}
	} else {
		err := os.RemoveAll(launchAgentFilePath)
		if err != nil {
			return fmt.Errorf("failed to remove LaunchAgent file: %w", err)
		}
	}
	return nil
}

func getDesiredLaunchAgentFileContents(ctx context.Context) ([]byte, error) {
	rancherDesktopPath, err := paths.GetRDLaunchPath(ctx)
	if err != nil {
		return []byte{}, fmt.Errorf("failed to get path to main Rancher Desktop executable: %w", err)
	}

	// get desired contents of LaunchAgent file
	launchAgentFileTemplate, err := template.New("launchAgentFile").Parse(launchAgentFileTemplateContents)
	if err != nil {
		return []byte{}, fmt.Errorf("failed to parse LaunchAgent file template: %w", err)
	}
	desiredContentsBuffer := &bytes.Buffer{}
	templateData := launchAgentFileData{
		RancherDesktopPath: rancherDesktopPath,
	}
	err = launchAgentFileTemplate.ExecuteTemplate(desiredContentsBuffer, "launchAgentFile", templateData)
	if err != nil {
		return []byte{}, fmt.Errorf("failed to fill LaunchAgent file template: %w", err)
	}
	return desiredContentsBuffer.Bytes(), nil
}
