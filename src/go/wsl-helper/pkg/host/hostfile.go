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
package host

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

const GatewayIP = "192.168.1.2"
const GatewayDomain = "gateway.rancher-desktop.internal"
const defaultHostFilePath = "/etc/hosts"

// AppendHostFile reads the content of a host file
// and appends a slice of entries to the file. The entries are
// provided in the following format, e.g.:
//
//	newEntries := []string{
//	  "127.0.0.1 example.com",
//	  "127.0.0.1 another-example.com",
//	}
func AppendHostFile(entries []string) error {
	hostFile, err := os.OpenFile(defaultHostFilePath, os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return err
	}
	defer hostFile.Close()

	writer := bufio.NewWriter(hostFile)

	writer.WriteString(fmt.Sprintln("# BEGIN Rancher Desktop configuration."))
	for _, entry := range entries {

		_, err := writer.WriteString(strings.ReplaceAll(entry, ",", " ") + "\n")
		if err != nil {
			return fmt.Errorf("error writing to /etc/hosts file: %w", err)
		}
	}
	writer.WriteString(fmt.Sprintln("# END Rancher Desktop configuration."))

	if err = writer.Flush(); err != nil {
		return fmt.Errorf("error flushing writer: %w", err)
	}

	return nil
}
