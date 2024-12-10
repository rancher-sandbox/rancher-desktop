/*
Copyright © 2024 SUSE LLC
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

// Package iptables handles forwarding ports found in iptables DNAT
package iptables

import "github.com/lima-vm/lima/pkg/guestagent/iptables"

// Scanner is the interface that wraps the GetPorts method which
// is used to scan the iptables.
type Scanner interface {
	GetPorts() ([]iptables.Entry, error)
}

type IptablesScanner struct{}

func NewIptablesScanner() *IptablesScanner {
	return &IptablesScanner{}
}

func (i *IptablesScanner) GetPorts() ([]iptables.Entry, error) {
	return iptables.GetPorts()
}
