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

const (
	GatewayIP           = "192.168.1.2"
	GatewayDomain       = "gateway.rancher-desktop.internal"
	defaultHostFilePath = "/etc/hosts"
	beginConfig         = "# BEGIN Rancher Desktop configuration."
	endConfig           = "# END Rancher Desktop configuration."
)

// AppendHostsFile reads the content of a host file
// and appends a slice of entries to the file. The entries are
// provided in the following format, e.g.:
//
//	newEntries := []string{
//	  "127.0.0.1,example.com",
//	  "127.0.0.1,another-example.com",
//	}
func AppendHostsFile(entries []string) error {
	exist, err := entryExist(entries)
	if err != nil {
		return err
	}
	if exist {
		return nil
	}

	hostFile, err := os.OpenFile(defaultHostFilePath, os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return err
	}
	defer hostFile.Close()

	writer := bufio.NewWriter(hostFile)

	_, err = writer.WriteString(fmt.Sprintln(beginConfig))
	if err != nil {
		return err
	}
	for _, entry := range entries {

		_, err := writer.WriteString(strings.ReplaceAll(entry, ",", " ") + "\n")
		if err != nil {
			return fmt.Errorf("error writing to /etc/hosts file: %w", err)
		}
	}
	_, err = writer.WriteString(fmt.Sprintln(endConfig))
	if err != nil {
		return err
	}

	if err = writer.Flush(); err != nil {
		return fmt.Errorf("error flushing writer: %w", err)
	}

	return nil
}

// RemoveHostsFileEntry reads the content of a host file
// and removes any specific host declaration that belongs
// to Rancher Desktop.
func RemoveHostsFileEntry() error {
	exist, err := configExist()
	if err != nil {
		return err
	}
	if !exist {
		return nil
	}

	hostsFile, err := os.Open(defaultHostFilePath)
	if err != nil {
		return err
	}
	defer hostsFile.Close()

	tempFile, err := os.CreateTemp("", "tempfile")
	if err != nil {
		return err
	}
	defer tempFile.Close()

	insideRancherConfig := false

	scanner := bufio.NewScanner(hostsFile)
	for scanner.Scan() {
		line := scanner.Text()

		// Check if we are inside Rancher Desktop configuration
		if strings.Contains(line, beginConfig) {
			insideRancherConfig = true
			continue
		} else if strings.Contains(line, endConfig) {
			insideRancherConfig = false
			continue
		}

		// Keep lines that are not inside the Rancher Desktop configuration
		if !insideRancherConfig {
			_, err := tempFile.WriteString(line + "\n")
			if err != nil {
				return err
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return err
	}

	if err := tempFile.Close(); err != nil {
		return err
	}

	// Replace the original file with the temporary file
	if err := os.Rename(tempFile.Name(), defaultHostFilePath); err != nil {
		return err
	}

	return nil
}

func configExist() (bool, error) {
	hostFile, err := os.OpenFile(defaultHostFilePath, os.O_RDWR, 0644)
	if err != nil {
		return false, err
	}
	defer hostFile.Close()
	scanner := bufio.NewScanner(hostFile)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.Contains(line, beginConfig) {
			return true, nil
		}
	}
	return false, nil
}

func entryExist(entries []string) (bool, error) {
	hostFile, err := os.OpenFile(defaultHostFilePath, os.O_RDWR, 0644)
	if err != nil {
		return false, err
	}
	defer hostFile.Close()
	scanner := bufio.NewScanner(hostFile)
	for scanner.Scan() {
		line := scanner.Text()
		for _, entry := range entries {
			if strings.Contains(line, strings.ReplaceAll(entry, ",", " ")) {
				return true, nil
			}
		}
	}
	return false, nil
}
