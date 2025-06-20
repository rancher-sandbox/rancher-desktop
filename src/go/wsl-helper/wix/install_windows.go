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

func setupLogger(hInstall MSIHANDLE) *logrus.Entry {
	return logrus.NewEntry(&logrus.Logger{
		Out:       &msiWriter{hInstall: hInstall},
		Formatter: &logrus.TextFormatter{},
		Hooks:     make(logrus.LevelHooks),
		Level:     logrus.TraceLevel,
	})
}

// UpdateWSLImpl updates the previously installed WSL.
// This needs to be run as the user, and may request elevation.
func UpdateWSLImpl(hInstall MSIHANDLE) uint32 {
	ctx := context.Background()
	log := setupLogger(hInstall)

	log.Info("Updating WSL...")
	err := submitMessage(hInstall, INSTALLMESSAGE_ACTIONSTART, []string{
		"", "UpdateWSL", "Updating Windows Subsystem for Linux...", "<unused>",
	})
	if err != nil {
		log.WithError(err).Info("Failed to update progress")
	}
	if err := wslutils.UpdateWSL(ctx, log); err != nil {
		log.WithError(err).Error("Updating WSL failed")
		return 1
	}

	log.Info("WSL successfully updated.")
	return 0
}
