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

	wslutils "github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/wsl-utils"
	"github.com/sirupsen/logrus"
)

// InstallWindowsFeatureImpl installs the Windows features necessary for WSL to
// be installed.  This needs to be run elevated.
func InstallWindowsFeatureImpl(hInstall MSIHANDLE) uint32 {
	ctx := context.Background()

	writer := &msiWriter{hInstall: hInstall}
	log := logrus.NewEntry(&logrus.Logger{
		Out:       writer,
		Formatter: &logrus.TextFormatter{},
		Hooks:     make(logrus.LevelHooks),
		Level:     logrus.TraceLevel,
	})

	log.Infof("Installing Windows feature...")
	submitMessage(hInstall, INSTALLMESSAGE_ACTIONSTART, []string{
		"", "InstalWindowsFeature", "Installing required Windows features...", "<unused>",
	})
	if err := wslutils.DismDoInstall(ctx, log); err != nil {
		log.WithError(err).Error("Failed to install feature")
		return 1
	}

	return 0
}

// InstallWSLImpl installs WSL.
// This assumes WSL was not previously installed.
// This needs to be run as the user.
func InstallWSLImpl(hInstall MSIHANDLE) uint32 {
	ctx := context.Background()

	writer := &msiWriter{hInstall: hInstall}
	log := logrus.NewEntry(&logrus.Logger{
		Out:       writer,
		Formatter: &logrus.TextFormatter{},
		Hooks:     make(logrus.LevelHooks),
		Level:     logrus.TraceLevel,
	})

	log.Info("Installing WSL...")
	submitMessage(hInstall, INSTALLMESSAGE_ACTIONSTART, []string{
		"", "InstallWSL", "Installing Windows Subsystem for Linux...", "<unused>",
	})
	if err := wslutils.InstallWSL(ctx, log); err != nil {
		log.WithError(err).Error("Installing WSL failed")
		return 1
	}

	log.Info("WSL successfully installed.")
	return 0
}
