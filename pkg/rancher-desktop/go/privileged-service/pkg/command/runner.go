/*
Copyright © 2022 SUSE LLC

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

// Command package is a wrapper around exec.Command to execute various
// commands for netsh utility and firewall rule creation.
package command

import (
	"fmt"
	"os/exec"
)

// Exec wraps exec.Command, it allows caller to define
// the underlying command e.g netsh ...
func Exec(cmd string, args []string) error {
	out, err := exec.Command(cmd, args...).CombinedOutput()
	if err == nil {
		return nil
	}
	return fmt.Errorf("execute command error: %w: %s", err, out)
}
