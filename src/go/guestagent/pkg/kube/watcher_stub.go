//go:build !linux

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

package kube

import (
	"context"
	"fmt"
	"net"

	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/tracker"
)

func WatchForServices(
	ctx context.Context,
	configPath string,
	k8sServiceListenerIP net.IP,
	portTracker tracker.Tracker,
) error {
	return fmt.Errorf("not implemented for non-linux")
}
