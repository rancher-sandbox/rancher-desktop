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

package machines

// Configuration used when spawning a new virtual machine.
type Config struct {
	Name      string // Name of the machine; not really used.
	Disk      string // Disk image file to use for spawning; should be a qcow2.
	JitConfig string // GitHub runner JIT configuration to be passed to the machine.
	Cpus      string // Number of CPUs in the machine
	Memory    string // Amount of memory in the machine, as 123M or 456G.
}
