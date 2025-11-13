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

package info

import (
	"context"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/client"
)

// Info describes the output the user will receive when running `rdctl info`
// with no special options.
type Info struct {
	Version   string `json:"version" help:"Rancher Desktop application version"`
	IPAddress string `json:"ip-address" help:"IP address to use to contact the VM"`
}

// HandlerFunc is the generic interface to populate the [Info] result structure.
// The function is expected to fill in the fields it knows.
// The given client may be `nil` if the configuration is invalid.
type HandlerFunc func(context.Context, *Info, client.RDClient) error

// Handlers that have been registered; the key should be the same as the JSON
// field tag (on struct [Info]).
var Handlers map[string]HandlerFunc

// Register a handler for a given field.
func register(name string, handler HandlerFunc) {
	if Handlers == nil {
		Handlers = make(map[string]HandlerFunc)
	}
	Handlers[name] = handler
}
