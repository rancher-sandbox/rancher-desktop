// In order to understand this file, you need to understand that
// there are two types of .desktop files. One, referred to here as
// "application" desktop files, make the application show up in
// the launcher (and possibly other places). The other kind, referred
// to here as "autostart" .desktop files, cause the application to
// start upon login.
package autostart

import (
	"bytes"
	"errors"
	"fmt"
	"github.com/adrg/xdg"
	"os"
	"path/filepath"
	"regexp"
	"text/template"
)

const autostartFileTemplateContents = `[Desktop Entry]
Name=Rancher Desktop
Exec={{ .Exec }}
Terminal=false
Type=Application
Icon=rancher-desktop
StartupWMClass=Rancher Desktop
Categories=Development;
`

type autostartFileData struct {
	Exec string
}

var autostartDirPath string
var autostartFilePath string
var errApplicationFileNotFound = errors.New("failed to find application .desktop file")
var applicationFileNameRegex *regexp.Regexp
var autostartFileTemplate *template.Template

func init() {
	autostartDirPath = filepath.Join(xdg.ConfigHome, "autostart")
	autostartFilePath = filepath.Join(autostartDirPath, "rancher-desktop.desktop")
	// Application .desktop file names in the following formats are anticipated:
	// - rancher-desktop.desktop
	// - appimagekit_f8f0a5bb1016c0e50d21af6c04672f3e-Rancher_Desktop.desktop
	applicationFileNameRegex = regexp.MustCompile(`^.*[rR]ancher[-_][dD]esktop\.desktop$`)
	autostartFileTemplate = template.Must(template.New("autostartDesktopFile").Parse(autostartFileTemplateContents))
}

func EnsureAutostart(autostartDesired bool) error {
	os.MkdirAll(autostartDirPath, 0755)

	if autostartDesired {
		currentContents, err := os.ReadFile(autostartFilePath)
		if err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("failed to read current autostart .desktop file: %w", err)
		}
		desiredContents, err := getDesiredAutostartFileContents()
		if err != nil {
			return fmt.Errorf("failed to get desired contents of autostart .desktop file: %w", err)
		}
		if !bytes.Equal(currentContents, desiredContents) {
			err = os.WriteFile(autostartFilePath, desiredContents, 0644)
			if err != nil {
				return fmt.Errorf("failed to write autostart .desktop file: %w", err)
			}
		}
	} else {
		err := os.RemoveAll(autostartFilePath)
		if err != nil {
			return fmt.Errorf("failed to remove autostart .desktop file: %w", err)
		}
	}
	return nil
}

func getDesiredAutostartFileContents() ([]byte, error) {
	// Look for existing application .desktop files in expected locations.
	// This part applies to rpm, deb and AppImageLauncher installs.
	// We use existing application .desktop files so that there is no
	// discrepancy between the application and autostart .desktop files.
	applicationFilePath, err := findApplicationFilePath()
	if err == nil {
		contents, err := os.ReadFile(applicationFilePath)
		if err != nil {
			return []byte{}, fmt.Errorf("failed to read contents of application .desktop file %s: %w", applicationFilePath, err)
		}
		return contents, nil
	} else if !errors.Is(err, errApplicationFileNotFound) {
		return []byte{}, err
	}

	// Come up with the contents of an autostart .desktop file.
	// This should be needed only when Rancher Desktop is installed
	// via AppImage, but the user has not used AppImageLauncher to
	// integrate it with the system.
	autostartData, err := getAutostartFileData()
	if err != nil {
		return []byte{}, fmt.Errorf("failed to get autostart file data: %w", err)
	}
	contents := bytes.Buffer{}
	err = autostartFileTemplate.ExecuteTemplate(&contents, "autostartDesktopFile", autostartData)
	if err != nil {
		return []byte{}, fmt.Errorf("failed to fill autostart file template: %w", err)
	}
	return contents.Bytes(), nil
}

// Searches the system for a valid application .desktop file,
// and returns the absolute path to it.
func findApplicationFilePath() (string, error) {
	dataDirs := []string{xdg.DataHome}
	dataDirs = append(dataDirs, xdg.DataDirs...)
	for _, dataDir := range dataDirs {
		applicationDir := filepath.Join(dataDir, "applications")
		dirEntries, err := os.ReadDir(applicationDir)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return "", fmt.Errorf("failed to read data dir %q: %w", dataDir, err)
		}
		for _, dirEntry := range dirEntries {
			fileName := dirEntry.Name()
			if applicationFileNameRegex.MatchString(fileName) {
				return filepath.Join(applicationDir, fileName), nil
			}
		}
	}
	return "", errApplicationFileNotFound
}

// Gathers the info that is needed to fill out the autostart .desktop
// file template.
func getAutostartFileData() (autostartFileData, error) {
	// TODO: update this code once paths tracking is moved into rdctl
	rancherDesktopSymlinkPath := filepath.Join(xdg.Home, ".rd", "bin", "rancher-desktop")
	appImagePath, err := filepath.EvalSymlinks(rancherDesktopSymlinkPath)
	if err != nil {
		return autostartFileData{}, fmt.Errorf("failed to resolve %q: %w", rancherDesktopSymlinkPath, err)
	}

	return autostartFileData{
		Exec: appImagePath,
	}, nil
}
