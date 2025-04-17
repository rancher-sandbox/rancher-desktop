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

// Package lima contains the constants related to running Rancher Desktop using
// lima (i.e. darwin / Linux).
package lima

const (
	// The name of the lima instance, without the `lima-` prefix.
	InstanceName = "0"
	// The name of the lima instance, including the `lima-` prefix.
	InstanceFullName = "lima-" + InstanceName
)
