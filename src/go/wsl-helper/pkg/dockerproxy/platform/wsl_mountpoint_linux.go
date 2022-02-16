/*
Copyright © 2021 SUSE LLC

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

package platform

import (
	"fmt"
	"io/ioutil"
	"strings"

	"github.com/sirupsen/logrus"
)

// Get the WSL mount point; typically, this is /mnt/wsl.
// If we fail to find one, we will use /mnt/wsl instead.
func GetWSLMountPoint() (string, error) {
	buf, err := ioutil.ReadFile("/proc/self/mountinfo")
	if err != nil {
		return "", fmt.Errorf("error reading mounts: %w", err)
	}
	for _, line := range strings.Split(string(buf), "\n") {
		if !strings.Contains(line, " - tmpfs ") {
			// Skip the line if the filesystem type isn't "tmpfs"
			continue
		}
		fields := strings.Split(line, " ")
		if len(fields) >= 5 {
			if strings.HasSuffix(fields[4], "/wsl") {
				return fields[4], nil
			}
		}
	}
	logrus.Warnf("Could not find WSL mount root, falling back to /mnt/wsl")
	return "/mnt/wsl", nil
}
