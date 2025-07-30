/*
Copyright © 2025 SUSE LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

		http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package factoryreset

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path"

	dockerconfig "github.com/docker/cli/cli/config"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/directories"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
)

type dockerConfigType map[string]any

type PartialMeta struct {
	Metadata struct {
		Description string
	}
}

/**
 * cleanupDockerContextFiles - normally RD will remove any contexts from .docker/contexts/meta that it owns.
 * This function checks the dir for any contexts that were left behind, and deletes them.
 */
func cleanupDockerContextFiles() {
	os.RemoveAll(path.Join(dockerconfig.Dir(), "contexts", "meta", "b547d66a5de60e5f0843aba28283a8875c2ad72e99ba076060ef9ec7c09917c8"))
}

func clearDockerContext() error {
	// Ignore failure to delete this next file:
	os.Remove(path.Join(dockerconfig.Dir(), "plaintext-credentials.config.json"))

	cleanupDockerContextFiles()

	configFilePath := path.Join(dockerconfig.Dir(), "config.json")
	dockerConfigContents := make(dockerConfigType)
	contents, err := os.ReadFile(configFilePath)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			// Nothing left to do here, since the file doesn't exist
			return nil
		}
		return fmt.Errorf("factory-reset: error trying to read docker config.json: %w", err)
	}
	if err = json.Unmarshal(contents, &dockerConfigContents); err != nil {
		// If we can't json-unmarshal ~/.docker/config, nothing left to do
		return nil
	}
	currentContextName, ok := dockerConfigContents["currentContext"]
	if !ok {
		return nil
	}
	if currentContextName != "rancher-desktop" {
		return nil
	}
	delete(dockerConfigContents, "currentContext")
	contents, err = json.MarshalIndent(dockerConfigContents, "", "  ")
	if err != nil {
		return err
	}
	scratchFile, err := os.CreateTemp(dockerconfig.Dir(), "tmpconfig.json")
	if err != nil {
		return err
	}
	err = os.WriteFile(scratchFile.Name(), contents, 0o600)
	scratchFile.Close()
	if err != nil {
		return err
	}
	return os.Rename(scratchFile.Name(), configFilePath)
}

func deleteLimaVM(ctx context.Context) error {
	appPaths, err := paths.GetPaths()
	if err != nil {
		return err
	}
	if err := directories.SetupLimaHome(appPaths.AppHome); err != nil {
		return err
	}
	limactl, err := directories.GetLimactlPath()
	if err != nil {
		return err
	}
	return exec.CommandContext(ctx, limactl, "delete", "-f", "0").Run()
}
