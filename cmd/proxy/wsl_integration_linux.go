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

package main

import (
	"flag"
	"net/http"
	"net/http/httputil"
	"net/url"

	"github.com/sirupsen/logrus"
)

var (
	debug        bool
	upstreamAddr string
	listenAddr   string
)

const (
	k8sAPI            = "http://192.168.1.2:6443"
	defaultListenAddr = "127.0.0.1:6443"
)

func main() {
	flag.BoolVar(&debug, "debug", false, "enable additional debugging")
	flag.StringVar(&upstreamAddr, "upstream-addr", k8sAPI, "The upstream server's address.")
	flag.StringVar(&listenAddr, "listen-addr", defaultListenAddr, "The server's address in an IP:PORT format.")
	flag.Parse()

	if debug {
		logrus.SetLevel(logrus.DebugLevel)
	}

	targetURL, err := url.Parse(upstreamAddr)
	if err != nil {
		logrus.Fatalf("invalid upstream URL: %s", upstreamAddr)
	}

	proxy := httputil.NewSingleHostReverseProxy(targetURL)

	logrus.Debugf("proxy server is running on %s", listenAddr)
	err = http.ListenAndServe(listenAddr, proxy) //nolint:gosec // No security concern for not having timeout here.
	if err != nil {
		logrus.Error("Error starting server:", err)
	}
}
