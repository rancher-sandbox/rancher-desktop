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
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"runtime"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/client"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/shell"
)

type interfaceInfo struct {
	InterfaceName string `json:"ifname"`
	Flags         []string
	State         string `json:"operstate"`
	MACAddress    string `json:"address"`
	Addresses     []struct {
		Family       string
		Local        string
		PrefixLength uint `json:"prefixlen"`
		Broadcast    string
		Scope        string
	} `json:"addr_info"`
}

func getIPAddress(ctx context.Context, result *Info, _ client.RDClient) error {
	cmd, err := shell.SpawnCommand(ctx, "ip", "-json", "address", "show")
	if err != nil {
		return err
	}
	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return err
	}

	var interfaces []interfaceInfo
	if err := json.Unmarshal(buf.Bytes(), &interfaces); err != nil {
		return err
	}

	// The list of interface names to try, varying by OS.
	interfaceNames := map[string][]string{
		"darwin":  {"rd0", "vznat", "rd1", "eth0"},
		"linux":   {"eth0"},
		"windows": {"eth0"},
	}[runtime.GOOS]

	for _, ifaceName := range interfaceNames {
		for _, iface := range interfaces {
			if iface.InterfaceName != ifaceName {
				continue
			}
			for _, addr := range iface.Addresses {
				if addr.Family == "inet" && addr.Scope == "global" {
					result.IPAddress = addr.Local
					return nil
				}
			}
		}
	}

	return fmt.Errorf("failed to find IP address")
}

func init() {
	register("ip-address", getIPAddress)
}
