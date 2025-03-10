// command server listens on the Unix socket `/run/guest-services/hello.sock`
// (see `everything.json`) to exercise the ability for the front end to talk to
// the back end.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
)

const (
	addr = "/run/guest-services/hello.sock"
)

// Listen on a port and return the listener
func listen() (net.Listener, error) {
	err := os.Remove(addr)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		slog.Error("failed to remove old socket", "socket", addr, "error", err)
	}
	listener, err := net.Listen("unix", addr)
	if err == nil {
		return listener, nil
	}
	listener, err = net.Listen("tcp", "")
	if err != nil {
		return nil, fmt.Errorf("failed to listen on fallback TCP: %w", err)
	}
	return listener, nil
}

// Handle HTTP POST requests
func handlePost(w http.ResponseWriter, req *http.Request) {
	_, _ = io.Copy(w, req.Body)
}

func main() {
	listener, err := listen()
	if err != nil {
		slog.Error("failed to listen", "error", err)
		os.Exit(1)
	}
	http.DefaultServeMux.Handle("GET /", http.FileServer(http.Dir("/")))
	http.DefaultServeMux.HandleFunc("POST /", handlePost)

	server := &http.Server{}
	ch := make(chan os.Signal)
	errCh := make(chan error)
	signal.Notify(ch, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-ch
		errCh <- server.Shutdown(context.Background())
	}()

	slog.Info("Serving HTTP", "address", listener.Addr().String())
	err = server.Serve(listener)
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server closed", "error", err)
		os.Exit(1)
	}
	if err = <-errCh; err != nil {
		slog.Error("failed to shutdown server", "error", err)
		os.Exit(1)
	}
}
