package main

import (
	"context"
	"flag"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
)

func main() {
	socketPath := flag.String("socket", os.Getenv("SOCKET"), "socket to forward to")

	if socketPath == nil {
		log.Fatal("no socket path specified, aborting")
	}

	// A explicit dialer is required to get a DialContext.
	dialer := &net.Dialer{}

	proxy := &httputil.ReverseProxy{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return dialer.DialContext(ctx, "unix", *socketPath)
			},
		},
		Director: func(r *http.Request) {
			// The incoming URL is normally missing scheme and host.
			// Re-resolve the URL with dummy values so that it could at least get far
			// enough to hit our transport (which ignores the host name).
			base := url.URL{Scheme: "http", Host: "localhost"}
			r.URL = base.ResolveReference(r.URL)
		},
	}

	err := http.ListenAndServe(":80", proxy)
	if err != nil {
		log.Printf("stopped listening: %s", err)
	}
}
