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

// Package integration manages the marker file to indicate if a WSL distribution
// is being integrated with Rancher Desktop.
package integration

import (
	"errors"
	"fmt"
	"os"
)

const (
	markerPath                = "/.rancher-desktop-integration"
	markerContents            = "This file is used to mark Rancher Desktop WSL integration.\n"
	integrationFilePermission = 0o644
)

// Set the current distribution as being integrated with Rancher Desktop.
func Set() error {
	return os.WriteFile(markerPath, []byte(markerContents), integrationFilePermission)
}

// Delete any markers claiming the current distribution is integrated with
// Rancher Desktop.
func Delete() error {
	if err := os.Remove(markerPath); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

// Check if the current distribution is being integrated with Rancher Desktop;
// prints, on stdout, either "true", "false", or an error message.
func Show() error {
	if _, err := os.Stat(markerPath); err == nil {
		fmt.Println("true")
	} else if errors.Is(err, os.ErrNotExist) {
		fmt.Println("false")
	} else {
		fmt.Printf("%s\n", err)
	}
	return nil
}
