// command server listens on the Unix socket `/run/guest-services/hello.sock`
// (see `everything.json`) to exercise the ability for the front end to talk to
// the back end.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
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
	data := map[string]any{"headers": req.Header}
	body, err := io.ReadAll(req.Body)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, fmt.Sprintf("failed to read body: %s", err))
		return
	}
	data["body"] = string(body)
	encoder := json.NewEncoder(w)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(data); err != nil {
		// This ends up after partially written JSON, but that's the best we can do
		// and should still show up in the result.
		_, _ = io.WriteString(w, fmt.Sprintf("failed to encode response: %w", err))
	}
}

// Handle POST returning given status
func handleWithStatus(w http.ResponseWriter, req *http.Request) {
	statusText := req.PathValue("status")
	statusCode, err := strconv.Atoi(statusText)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = fmt.Fprintf(w, "failed to parse status %s", statusText)
		return
	}
	w.WriteHeader(statusCode)
	_, _ = fmt.Fprintf(w, "returning status code %d", statusCode)
}

func main() {
	listener, err := listen()
	if err != nil {
		slog.Error("failed to listen", "error", err)
		os.Exit(1)
	}
	http.DefaultServeMux.Handle("GET /get/", http.StripPrefix("/get/", http.FileServer(http.Dir("/"))))
	http.DefaultServeMux.HandleFunc("POST /post", handlePost)
	http.DefaultServeMux.HandleFunc("/status/{status}", handleWithStatus)

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
