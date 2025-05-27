/*
Copyright © 2023 SUSE LLC

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

package main

import (
	"context"

	"github.com/sirupsen/logrus"

	wslutils "github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/wsl-utils"
)

const (
	// Windows Installer property that is set if WSL was detected to be installed.
	PropWSLInstalled = "WSLINSTALLED"
	// Windows Installer property that is set if the WSL kernel needs to be upgraded.
	PropWSLKernelOutdated = "WSLKERNELOUTDATED"
)

// DetectWSLImpl checks if WSL is installed; it outputs results by setting
// Windows Installer properties.
func DetectWSLImpl(hInstall MSIHANDLE) uint32 {
	ctx := context.Background()

	writer := &msiWriter{hInstall: hInstall}
	log := logrus.NewEntry(&logrus.Logger{
		Out:       writer,
		Formatter: &logrus.TextFormatter{},
		Hooks:     make(logrus.LevelHooks),
		Level:     logrus.TraceLevel,
	})

	log.Info("Checking if WSL is installed...")
	info, err := wslutils.GetWSLInfo(ctx, log)
	if err != nil {
		log.WithError(err).Error("Failed to get WSL info")
		return 1
	}
	log.Infof("WSL install state: %+v", info)

	if info.Installed {
		if err = setProperty(hInstall, PropWSLInstalled, "1"); err != nil {
			log.WithError(err).Errorf("failed to set property %s", PropWSLInstalled)
		}
		if info.OutdatedKernel {
			if err = setProperty(hInstall, PropWSLKernelOutdated, "1"); err != nil {
				log.WithError(err).Errorf("failed to set property %s", PropWSLKernelOutdated)
			}
		}
	}
	return 0
}
