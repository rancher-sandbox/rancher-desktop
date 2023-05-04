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

package tracker_test

import (
	"context"
	"fmt"
	"net"
	"runtime"
	"strconv"
	"syscall"
	"testing"

	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/tracker"
	"github.com/stretchr/testify/assert"
)

func TestListenerTracker(t *testing.T) {
	t.Parallel()

	listenerTracker := tracker.NewListenerTracker()
	testIPAddr := getTestIP()
	ctx := context.TODO()

	tests := []struct {
		testPort int
	}{
		{testPort: 9897},
		{testPort: 9898},
		{testPort: 9899},
	}

	for _, tt := range tests {
		testCase := tt
		t.Run(fmt.Sprintf("Should create listener with port: %d", testCase.testPort), func(t *testing.T) {
			t.Parallel()
			err := listenerTracker.AddListener(ctx, testIPAddr, testCase.testPort)
			assert.Nil(t, err)

			_, err = net.Dial("tcp", ipPortToAddr(testIPAddr, testCase.testPort))
			assert.Nil(t, err)

			err = listenerTracker.RemoveListener(ctx, testIPAddr, testCase.testPort)
			assert.Nil(t, err)

			_, err = net.Dial("tcp", ipPortToAddr(testIPAddr, testCase.testPort))
			assert.ErrorIs(t, err, syscall.ECONNREFUSED)
		})
	}
}

func ipPortToAddr(ip net.IP, port int) string {
	return net.JoinHostPort(ip.String(), strconv.Itoa(port))
}

func getTestIP() net.IP {
	if runtime.GOOS == "windows" {
		return net.IPv4(127, 0, 0, 1)
	}

	return net.IPv4(0, 0, 0, 0)
}
