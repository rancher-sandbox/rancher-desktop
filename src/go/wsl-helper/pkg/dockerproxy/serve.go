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
	"regexp"
	"strings"

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
	munger := newRequestMunger()
	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			logrus.WithField("request", req).
				WithField("headers", req.Header).
				WithField("url", req.URL).
				Debug("got proxy request")
			// The incoming URL is relative (to the root of the server; we need to
			// add scheme and host ("http://proxy.invalid/") to it.
			req.URL.Scheme = "http"
			req.URL.Host = "proxy.invalid"

			originalReq := *req
			originalURL := *req.URL
			originalReq.URL = &originalURL
			err := munger.Munge(req)
			if err != nil {
				logrus.WithError(err).
					WithField("original request", originalReq).
					WithField("modified request", req).
					Error("could not munge request")
			}
		},
		Transport: &http.Transport{
			Dial: func(string, string) (net.Conn, error) {
				return dialer()
			},
			DisableCompression: true, // for debugging
		},
		ModifyResponse: func(resp *http.Response) error {
			logrus.WithField("response", resp).Debug("got proxy response")
			return nil
		},
		ErrorLog: log.New(logWriter, "", 0),
	}

	err = http.Serve(listener, proxy)
	if err != nil {
		logrus.WithError(err).Error("serve exited with error")
	}

	return nil
}

// requestMunger is used to modify the incoming http.Request as required.
type requestMunger struct {
	// apiDetectPattern is used to detect the API version request path prefix.
	apiDetectPattern *regexp.Regexp
}

// newRequestMunger initializes a new requestMunger.
func newRequestMunger() *requestMunger {
	apiDetectPattern, err := regexp.Compile(`^v[0-9.]+$`)
	if err != nil {
		logrus.WithError(err).Error("could not compile path pattern")
		panic(err)
	}
	return &requestMunger{
		apiDetectPattern: apiDetectPattern,
	}
}

// Munge a given request; it is modified in-place.
func (m *requestMunger) Munge(req *http.Request) error {
	apiVersion, requestPath := m.detectAPIVersion(req.URL.Path)
	if apiVersion == "" {
		// Special case for /_ping
		return nil
	}
	logrus.WithField("path", requestPath).Debug("foo")

	return nil
}

// detectAPIVersion parses an incoming HTTP request to determine the Docker API
// version it expects to use, returning the API version (as a string, such as
// "v1.41") plus the API path (e.g. "/images/json").  The API path will always
// be prefixed by a slash.  If the request should not be munged, the API version
// will be returned as an empty string.
func (m *requestMunger) detectAPIVersion(reqPath string) (string, string) {
	cleanedReqPath := strings.TrimPrefix(reqPath, "/")
	slashIndex := strings.Index(cleanedReqPath, "/")
	if slashIndex < 0 {
		slashIndex = len(cleanedReqPath)
	}
	versionString := cleanedReqPath[:slashIndex]
	unversionedPath := cleanedReqPath[slashIndex:]
	if versionString == "_ping" {
		// Do not munge /_ping; the client looks at the returned `Api-Version`
		// header to negotiate the API to use.
		return "", reqPath
	}

	if !m.apiDetectPattern.MatchString(versionString) {
		// The first word isn't an API version; use the default version.
		versionString = defaultDockerVersion
		unversionedPath = reqPath
	}

	logrus.WithField("api-version", versionString).
		WithField("request path", unversionedPath).
		WithField("input path", reqPath).
		Debug("parsed request version")

	return versionString, unversionedPath
}
