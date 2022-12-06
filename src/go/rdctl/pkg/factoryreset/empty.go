//go:build !windows

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

package factoryreset

import (
	"fmt"
)

func CheckProcessWindows() (bool, error) {
	return false, fmt.Errorf("internal error: GetLockfilePath shouldn't be called")
}

func KillRancherDesktop() error {
	return nil
}

func deleteWindowsData(_ bool, _ string) error {
	return fmt.Errorf("internal error: deleteWindowsData shouldn't be called")
}

func unregisterWSL() error {
	return fmt.Errorf("internal error: unregisterWSL shouldn't be called")
}
