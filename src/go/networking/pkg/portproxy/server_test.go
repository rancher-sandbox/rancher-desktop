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
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"syscall"
	"testing"
	"time"

	"github.com/docker/go-connections/nat"
	"github.com/stretchr/testify/require"
	"golang.org/x/net/nettest"

	"github.com/rancher-sandbox/rancher-desktop/src/go/guestagent/pkg/types"
	"github.com/rancher-sandbox/rancher-desktop/src/go/networking/pkg/portproxy"
)

func TestNewPortProxyUDP(t *testing.T) {
	testServerIP, err := availableIP()
	require.NoError(t, err, "cannot continue with the test since there are no available IP addresses")

	remoteAddr := net.JoinHostPort(testServerIP, "0")
	targetAddr, err := net.ResolveUDPAddr("udp", remoteAddr)
	require.NoError(t, err)
	targetConn, err := net.ListenUDP("udp", targetAddr)
	require.NoError(t, err)

	t.Logf("created the following UDP target listener: %s", targetConn.LocalAddr().String())

	localListener, err := nettest.NewLocalListener("unix")
	require.NoError(t, err)
	defer localListener.Close()

	proxyConfig := &portproxy.ProxyConfig{
		UpstreamAddress: testServerIP,
		UDPBufferSize:   1024,
	}
	portProxy := portproxy.NewPortProxy(t.Context(), localListener, proxyConfig)
	go portProxy.Start()

	_, testPort, err := net.SplitHostPort(targetConn.LocalAddr().String())
	require.NoError(t, err)

	port, err := nat.NewPort("udp", testPort)
	require.NoError(t, err)

	portMapping := types.PortMapping{
		Remove: false,
		Ports: nat.PortMap{
			port: []nat.PortBinding{
				{
					HostIP:   "127.0.0.1",
					HostPort: testPort,
				},
			},
		},
	}
	t.Logf("sending the following portMapping to portProxy: %+v", portMapping)
	err = marshalAndSend(localListener, portMapping)
	require.NoError(t, err)

	// indicate when UDP mappings are ready
	for len(portProxy.UDPPortMappings()) == 0 {
		time.Sleep(100 * time.Millisecond)
	}

	t.Log("UDP port mappings are set up")

	localAddr := net.JoinHostPort("127.0.0.1", testPort)
	sourceAddr, err := net.ResolveUDPAddr("udp", localAddr)
	require.NoError(t, err)
	sourceConn, err := net.DialUDP("udp", nil, sourceAddr)
	require.NoError(t, err)
	t.Logf("dialing in to the following UDP connection: %s", localAddr)

	expectedString := "this is what we expect"
	_, err = sourceConn.Write([]byte(expectedString))
	require.NoError(t, err)

	targetConn.SetDeadline(time.Now().Add(time.Second * 5))

	b := make([]byte, len(expectedString))
	n, _, err := targetConn.ReadFromUDP(b)
	require.NoError(t, err)
	require.Equal(t, n, len(expectedString))
	require.Equal(t, string(b), expectedString)

	targetConn.Close()
	sourceConn.Close()
	portProxy.Close()
}

func TestNewPortProxyTCP(t *testing.T) {
	expectedResponse := "called the upstream server"

	testServerIP, err := availableIP()
	require.NoError(t, err, "cannot continue with the test since there are no available IP addresses")

	listener, err := net.Listen("tcp", fmt.Sprintf("%s:", testServerIP))
	require.NoError(t, err)
	defer listener.Close()

	testServer := http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			fmt.Fprint(w, expectedResponse)
		}),
	}
	defer testServer.Close()
	testServer.SetKeepAlivesEnabled(false)
	go testServer.Serve(listener)

	_, testPort, err := net.SplitHostPort(listener.Addr().String())
	require.NoError(t, err)

	localListener, err := nettest.NewLocalListener("unix")
	require.NoError(t, err)
	defer localListener.Close()

	proxyConfig := &portproxy.ProxyConfig{
		UpstreamAddress: testServerIP,
	}
	portProxy := portproxy.NewPortProxy(t.Context(), localListener, proxyConfig)
	go portProxy.Start()

	getURL := fmt.Sprintf("http://localhost:%s", testPort)
	resp, err := httpGetRequest(t.Context(), getURL)
	require.ErrorIsf(t, err, syscall.ECONNREFUSED, "no listener should be available for port: %s", testPort)
	if resp != nil {
		resp.Body.Close()
	}

	port, err := nat.NewPort("tcp", testPort)
	require.NoError(t, err)

	portMapping := types.PortMapping{
		Remove: false,
		Ports: nat.PortMap{
			port: []nat.PortBinding{
				{
					HostIP:   "127.0.0.1",
					HostPort: testPort,
				},
			},
		},
	}
	t.Logf("sending the following portMapping to portProxy: %+v", portMapping)
	err = marshalAndSend(localListener, portMapping)
	require.NoError(t, err)

	resp, err = httpGetRequest(t.Context(), getURL)
	require.NoError(t, err)
	require.Equal(t, resp.StatusCode, http.StatusOK)
	defer resp.Body.Close()
	bodyBytes, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.Equal(t, string(bodyBytes), expectedResponse)

	portMapping = types.PortMapping{
		Remove: true,
		Ports: nat.PortMap{
			port: []nat.PortBinding{
				{
					HostIP:   "127.0.0.1",
					HostPort: testPort,
				},
			},
		},
	}
	err = marshalAndSend(localListener, portMapping)
	require.NoError(t, err)

	resp, err = httpGetRequest(t.Context(), getURL)
	require.Errorf(t, err, "the listener for port: %s should already be closed", testPort)
	require.ErrorIs(t, err, syscall.ECONNREFUSED)
	if resp != nil {
		resp.Body.Close()
	}

	testServer.Close()
	portProxy.Close()
}

func httpGetRequest(ctx context.Context, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	return resp, nil
}

func marshalAndSend(listener net.Listener, portMapping types.PortMapping) error {
	b, err := json.Marshal(portMapping)
	if err != nil {
		return err
	}
	testDialer := net.Dialer{
		Timeout: 5 * time.Second,
	}
	c, err := testDialer.DialContext(context.Background(), listener.Addr().Network(), listener.Addr().String())
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
