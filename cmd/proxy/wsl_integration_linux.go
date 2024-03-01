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
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"flag"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/sirupsen/logrus"
)

var (
	debug                  bool
	upstreamAddr           string
	listenAddr             string
	keyFile                string
	certFile               string
	rootCA                 string
	upstreamClientKeyFile  string
	upstreamClientCertFile string
)

const (
	k8sAPI               = "https://192.168.1.2:6443"
	defaultListenAddr    = "127.0.0.1:6443"
	kubeAPIServerKeyFile = "/var/lib/rancher/k3s/server/tls/serving-kube-apiserver.key"
	kubeAPIServerCrtFile = "/var/lib/rancher/k3s/server/tls/serving-kube-apiserver.crt"
	rootCACrtFile        = "/var/lib/rancher/k3s/server/tls/server-ca.crt"
	clientAdminKeyFile   = "/var/lib/rancher/k3s/server/tls/client-admin.key"
	clientAdminCrtFile   = "/var/lib/rancher/k3s/server/tls/client-admin.crt"
)

func main() {
	flag.BoolVar(&debug, "debug", false, "enable additional debugging.")
	flag.StringVar(&upstreamAddr, "upstream-addr", k8sAPI, "The upstream server's address (k3s API sever).")
	flag.StringVar(&listenAddr, "listen-addr", defaultListenAddr, "The server's address in an IP:PORT format.")
	flag.StringVar(&keyFile, "key-file", kubeAPIServerKeyFile,
		"TLS private key file for downstream (incoming) connection into proxy from kubectl.")
	flag.StringVar(&certFile, "cert-file", kubeAPIServerCrtFile,
		"TLS certificate file for downstream (incoming) connection into proxy from kubectl.")
	flag.StringVar(&rootCA, "root-ca-file", rootCACrtFile,
		"root ca file for upstream connection, this is the K3s API server's root CA.")
	flag.StringVar(&upstreamClientKeyFile, "upstream-key-file", clientAdminKeyFile,
		"Clinet TLS private key file for upstream (outgoing) connection to K3s API server.")
	flag.StringVar(&upstreamClientCertFile, "upstream-cert-file", clientAdminCrtFile,
		"Client TLS certificate file for upstream (outgoing) connection to K3s API server.")
	flag.Parse()

	if debug {
		logrus.SetLevel(logrus.DebugLevel)
	}

	targetURL, err := url.Parse(upstreamAddr)
	if err != nil {
		logrus.Fatalf("invalid upstream URL: %s", upstreamAddr)
	}

	ctx, _ := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	proxy := httputil.NewSingleHostReverseProxy(targetURL)

	certPool, err := x509.SystemCertPool()
	if err != nil {
		logrus.Fatalf("failed loading System Cert Pool: %v", err)
	}

	crtByte, err := os.ReadFile(rootCA)
	if err != nil {
		logrus.Fatalf("failed reading upstream CA Cert: %v", err)
	}

	ok := certPool.AppendCertsFromPEM(crtByte)
	if !ok {
		logrus.Fatal("failed to append Root CA PEM")
	}

	upstreamKeyPair, err := tls.LoadX509KeyPair(upstreamClientCertFile, upstreamClientKeyFile)
	if err != nil {
		logrus.Fatalf("failed to load upstream certificate/key: %v", err)
	}
	proxy.Transport = &http.Transport{
		TLSClientConfig: &tls.Config{
			MinVersion:   tls.VersionTLS13, // Match k3s API TLS version
			Certificates: []tls.Certificate{upstreamKeyPair},
			RootCAs:      certPool,
		},
	}

	srv := http.Server{
		Addr:              listenAddr,
		Handler:           proxy,
		ReadHeaderTimeout: 5 * time.Second,
	}

	srv.TLSConfig = &tls.Config{
		MinVersion:               tls.VersionTLS13,
		PreferServerCipherSuites: true,
	}

	go func() {
		if err := srv.ListenAndServeTLS(certFile, keyFile); !errors.Is(err, http.ErrServerClosed) {
			logrus.Error("Error starting server:", err)
		}
	}()

	logrus.Debugf("proxy server is running on %s", listenAddr)
	<-ctx.Done()

	if err := srv.Shutdown(context.Background()); err != nil {
		logrus.Error("Error shutting down server:", err)
	}
}
