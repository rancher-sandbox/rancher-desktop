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

package iptables

import (
	"fmt"
	"os"
	"os/exec"

	"github.com/Masterminds/log-go"
)

const (
	// iptables append operation.
	AppendToChain string = "append"
	// iptables delete operation.
	DeleteFromChain = "delete"
	tapIface        = "eth0"
	tapDeviceIP     = "192.168.127.2"
)

// LoopbackRules creates a series of iptables rules associated
// with the `PREROUTING` and `POSTROUTING` chains. The `PREROUTING`
// rule is rewriting the destination IP address of any packets
// received by the local system and destined for the TAP device to 127.0.0.1.
// While the `POSTROUTING` chain rule is rewriting the source IP address of
// any packets being sent out through the gateway (`eth0`) network interface
// to the IP address of that network interface (`eth0`).
func LoopbackRules(chainOP string) error {
	chainOP = fmt.Sprintf("--%s", chainOP)

	rules := map[string][]string{
		"PREROUTING": {
			"--table", "nat",
			chainOP, "PREROUTING",
			"--destination", tapDeviceIP,
			"--jump", "DNAT",
			"--to-destination", "127.0.0.1",
		},
		"POSTROUTING": {
			"--table", "nat",
			chainOP, "POSTROUTING",
			"--out-interface", tapIface,
			"--jump", "MASQUERADE",
		},
	}

	for key, args := range rules {
		log.Debugf("running %s iptable rules: iptables %s", key, args)

		if err := execIPTable(args); err != nil {
			return err
		}
	}

	return nil
}

func execIPTable(args []string) error {
	cmd := exec.Command("iptables", args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	return cmd.Run()
}
