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

package cmd

import "fmt"

// enumValue describes an enumeration for use with github.com/spf13/pflag
type enumValue struct {
	allowed []string // Allowed values
	val     string   // Current value
}

func (v *enumValue) String() string {
	return v.val
}

func (v *enumValue) Set(newVal string) error {
	for _, candidate := range v.allowed {
		if candidate == newVal {
			v.val = candidate
			return nil
		}
	}
	return fmt.Errorf("value %q is not one of the allowed values: %+v", newVal, v.allowed)
}

func (v *enumValue) Type() string {
	return "enum"
}
