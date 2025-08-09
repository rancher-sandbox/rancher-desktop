package paths

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/utils"
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
	// Directory holding Lima state (Unix-specific).
	Lima string `json:"lima,omitempty"`
	// Directory holding provided binary resources.
	Integration string `json:"integration,omitempty"`
	// Directory that holds resource files in the RD installation.
	Resources string `json:"resources"`
	// Deployment Profile System-wide startup settings path.
	DeploymentProfileSystem string `json:"deploymentProfileSystem,omitempty"`
	// Secondary Deployment Profile System-wide startup settings path.
	AltDeploymentProfileSystem string `json:"altDeploymentProfileSystem,omitempty"`
	// Deployment Profile User startup settings path.
	DeploymentProfileUser string `json:"deploymentProfileUser,omitempty"`
	// Directory that holds extension data.
	ExtensionRoot string `json:"extensionRoot"`
	// Directory that holds snapshots
	Snapshots string `json:"snapshots,omitempty"`
	// Directory containing user-managed containerd-shims
	ContainerdShims string `json:"containerdShims,omitempty"`
	// Previous location of Electron user data (e.g. cookies) up to Rancher Desktop 1.16.
	// Current location is `$AppHome/electron` and does not need special treatment.
	OldUserData string `json:"oldUserData,omitempty"`
}

var rdctlPathOverride string

// Get the path to the resources directory (the parent directory of the
// platform-specific directory); this is used to fill in [Paths.Resources].
func GetResourcesPath() (string, error) {
	var rdctlPath string
	if rdctlPathOverride != "" {
		rdctlPath = rdctlPathOverride
	} else {
		rdctlSymlinkPath, err := os.Executable()
		if err != nil {
			return "", fmt.Errorf("failed to get path to rdctl: %w", err)
		}
		rdctlPath, err = filepath.EvalSymlinks(rdctlSymlinkPath)
		if err != nil {
			return "", fmt.Errorf("failed to resolve %q: %w", rdctlSymlinkPath, err)
		}
	}
	return utils.GetParentDir(rdctlPath, 3), nil
}
