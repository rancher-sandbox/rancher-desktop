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
package portproxy_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"

	"github.com/docker/go-connections/nat"
	"github.com/rancher-sandbox/rancher-desktop-agent/pkg/types"
	"github.com/rancher-sandbox/rancher-desktop-networking/pkg/portproxy"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/require"
	"golang.org/x/net/nettest"
)

func TestNewPortProxy(t *testing.T) {
	logrus.SetLevel(logrus.DebugLevel)

	expectedResponse := "called the upstream server"

	testServerIP, err := availableIP()
	require.NoError(t, err, "cannot continue with the test since there are no availabe IP addresses")

	testServerPort, err := getFreePort()
	require.NoError(t, err)

	testPort := strconv.Itoa(testServerPort)
	testServerURL := url.URL{
		Scheme: "http",
		Host:   fmt.Sprintf("%s:%s", testServerIP, testPort),
	}

	testServer, err := newTestServerWithURL(testServerURL.Host, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, expectedResponse)
	}))

	require.NoError(t, err)

	localListener, err := nettest.NewLocalListener("unix")
	require.NoError(t, err)
	defer localListener.Close()

	portProxy := portproxy.NewPortProxy(localListener, testServerIP)
	go portProxy.Accept()

	port, err := nat.NewPort("tcp", testPort)
	require.NoError(t, err)

	portMapping := types.PortMapping{
		Remove: false,
		Ports: nat.PortMap{
			port: []nat.PortBinding{
				{
					HostIP:   testServerIP,
					HostPort: testPort,
				},
			},
		},
	}
	err = marshalAndSend(localListener, portMapping)
	require.NoError(t, err)

	res, err := http.Get(fmt.Sprintf("http://localhost:%s", testPort))
	require.NoError(t, err)
	require.Equal(t, res.StatusCode, http.StatusOK)
	defer res.Body.Close()
	bodyBytes, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	require.Equal(t, string(bodyBytes), expectedResponse)


	portMapping = types.PortMapping{
		Remove: true,
		Ports: nat.PortMap{
			port: []nat.PortBinding{
				{
					HostIP:   testServerIP,
					HostPort: testPort,
				},
			},
		},
	}
	err = marshalAndSend(localListener, portMapping)
	require.NoError(t, err)


	res2, err := http.Get(fmt.Sprintf("http://localhost:%s", testPort))
	require.NoError(t, err)
	fmt.Println(res2.StatusCode)
	//require.NotEqual(t, res2.StatusCode, http.StatusOK)
	defer res2.Body.Close()
	bodyBytes, err = io.ReadAll(res2.Body)
	require.NoError(t, err)
	fmt.Println(string(bodyBytes))
	require.Equal(t, string(bodyBytes), expectedResponse)


	testServer.Close()
	portProxy.Close()
}

func marshalAndSend(listener net.Listener, portMapping types.PortMapping) error {
	b, err := json.Marshal(portMapping)
	if err != nil {
		return err
	}
	c, err := net.Dial(listener.Addr().Network(), listener.Addr().String())
	if err != nil {
		return err
	}
	_, err = c.Write(b)
	if err != nil {
		return err
	}
	return c.Close()
}

func availableIP() (string, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return "", err
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 {
			continue // interface down
		}
		if iface.Flags&net.FlagLoopback != 0 {
			continue // loopback interface
		}
		addrs, err := iface.Addrs()
		if err != nil {
			return "", err
		}
		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil || ip.IsLoopback() {
				continue
			}
			ip = ip.To4()
			if ip == nil {
				continue // not an ipv4 address
			}
			return ip.String(), nil
		}
	}
	return "", errors.New("are you connected to the network?")
}

func getFreePort() (port int, err error) {
	var a *net.TCPAddr
	if a, err = net.ResolveTCPAddr("tcp", "localhost:0"); err == nil {
		var l *net.TCPListener
		if l, err = net.ListenTCP("tcp", a); err == nil {
			defer l.Close()
			return l.Addr().(*net.TCPAddr).Port, nil
		}
	}
	return
}

func newTestServerWithURL(URL string, handler http.Handler) (*httptest.Server, error) {
	ts := httptest.NewUnstartedServer(handler)
	if URL != "" {
		l, err := net.Listen("tcp", URL)
		if err != nil {
			return nil, err
		}
		ts.Listener.Close()
		ts.Listener = l
	}
	ts.Start()
	return ts, nil
}
