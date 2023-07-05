package paths

import (
	"fmt"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/utils"
	"os"
	"path/filepath"
)

const appName = "rancher-desktop"

type Paths struct {
	// Main location for application data.
	AppHome string `json:"appHome"`
	// Secondary location for application data.
	AltAppHome string `json:"altAppHome"`
	// Directory which holds configuration.
	Config string `json:"config"`
	// Directory which holds logs.
	Logs string `json:"logs"`
	// Directory which holds caches that may be removed.
	Cache string `json:"cache"`
	// Directory holding the WSL distribution (Windows-specific).
	WslDistro string `json:"wslDistro,omitempty"`
	// Directory holding the WSL data distribution (Windows-specific).
	WslDistroData string `json:"wslDistroData,omitempty"`
	// Directory holding Lima state (macOS-specific).
	Lima string `json:"lima,omitempty"`
	// Directory holding provided binary resources.
	Integration string `json:"integration,omitempty"`
	// The directory that used to hold provided binary integrations.
	OldIntegration string `json:"oldIntegration,omitempty"`
	// Directory that holds resource files in the RD installation.
	Resources string `json:"resources"`
	// Deployment Profile System-wide startup settings path.
	DeploymentProfileSystem string `json:"deploymentProfileSystem,omitempty"`
	// Deployment Profile User startup settings path.
	DeploymentProfileUser string `json:"deploymentProfileUser,omitempty"`
	// Directory that holds extension data.
	ExtensionRoot string `json:"extensionRoot"`
}

func getResourcesPath() (string, error) {
	rdctlSymlinkPath, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("failed to get path to rdctl: %w", err)
	}
	rdctlPath, err := filepath.EvalSymlinks(rdctlSymlinkPath)
	if err != nil {
		return "", fmt.Errorf("failed to resolve %q: %w", rdctlSymlinkPath, err)
	}
	return utils.GetParentDir(rdctlPath, 3), nil
}
