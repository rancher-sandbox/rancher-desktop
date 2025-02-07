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

package utils

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
)

var (
	ErrExecIptablesRule  = errors.New("failed updating iptables rules")
	ErrIPAddressNotFound = errors.New("IP address not found in line")
)

// NormalizeHostIP checks if the provided IP address is valid.
// The valid options are "127.0.0.1" and "0.0.0.0". If the input is "127.0.0.1",
// it returns "127.0.0.1". Any other address will be mapped to "0.0.0.0".
func NormalizeHostIP(ip string) string {
	if ip == "127.0.0.1" || ip == "localhost" {
		return ip
	}
	return "0.0.0.0"
}

func GenerateID(entry string) string {
	hasher := sha256.New()
	hasher.Write([]byte(entry))
	return hex.EncodeToString(hasher.Sum(nil))
}
