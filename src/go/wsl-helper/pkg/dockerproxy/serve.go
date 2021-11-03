//go:build linux || windows
// +build linux windows

/*
Copyright © 2021 SUSE LLC

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

package dockerproxy

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"os"
	"os/signal"

	"github.com/sirupsen/logrus"

	"github.com/rancher-sandbox/rancher-desktop/src/wsl-helper/pkg/dockerproxy/platform"
)

const (
	// defaultDockerVersion is the Docker API version to use for unversioned
	// requests.
	defaultDockerVersion = "v1.41"
)

// Serve up the docker proxy at the given endpoint, using the given function to
// create a connection to the real dockerd.
func Serve(endpoint string, dialer func() (net.Conn, error)) error {

	logrus.SetLevel(logrus.DebugLevel)
	logrus.SetFormatter(&logrus.TextFormatter{
		ForceColors: true,
	})

	listener, err := platform.Listen(endpoint)
	if err != nil {
		return err
	}

	logrus.WithField("listener", listener).Debug("got listener")

	termch := make(chan os.Signal, 1)
	signal.Notify(termch, os.Interrupt)
	go func() {
		<-termch
		signal.Stop(termch)
		err := listener.Close()
		if err != nil {
			fmt.Printf("Error closing listener on interrupt: %s\n", err)
		}
	}()

	logWriter := logrus.StandardLogger().Writer()
	defer logWriter.Close()
	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			logrus.WithField("request", req).
				WithField("url", req.URL).
				Debug("got proxy request")
			// The incoming URL is relative (to the root of the server; we need to
			// add scheme and host ("http://proxy.invalid/") to it.
			req.URL.Scheme = "http"
			req.URL.Host = "proxy.invalid"
		},
		Transport: &http.Transport{
			Dial: func(string, string) (net.Conn, error) {
				return dialer()
			},
			DisableCompression: true, // for debugging
		},
		ErrorLog: log.New(logWriter, "", 0),
	}

	err = http.Serve(listener, proxy)
	if err != nil {
		logrus.WithError(err).Error("serve exited with error")
	}

	return nil
}
