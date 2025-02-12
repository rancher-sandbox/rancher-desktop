package util

import (
	"bufio"
	"context"
	"io"
	"log"
	"net"
	"net/http"
	"sync"
	"time"
)

const (
	hostHeaderValue = "api.moby.localhost"
	targetProtocol  = "http://"
)

// ReverseProxy is a custom reverse proxy specifically designed for Rancher Desktop's
// Docker API communication. Unlike the standard library's ReverseProxy, this
// implementation provides explicit support for half-close connections and
// HTTP protocol upgrades required by the Docker API.
//
// Key design features:
// - Handles HTTP protocol upgrades (WebSocket-like connections)
// - Supports half-close TCP connections
// - Provides hooks for request/response modification
// - Designed for specific Docker API interaction requirements
type ReverseProxy struct {
	// Dial provides a custom connection establishment method
	Dial func(network, addr string) (net.Conn, error)

	// Director allows modification of the outgoing request before forwarding
	Director func(*http.Request)

	// ModifyResponse enables post-processing of the backend response
	ModifyResponse func(*http.Response) error

	// ErrorLog defines an optional logger for recording errors encountered
	// during request proxying. If not provided, the standard logger from
	// the log package is used instead.
	ErrorLog *log.Logger
}

// ServeHTTP implements the http.Handler interface, routing incoming
// HTTP requests through the custom reverse proxy
func (proxy ReverseProxy) ServeHTTP(rw http.ResponseWriter, r *http.Request) {
	proxy.forwardRequest(rw, r)
}

// forwardRequest is the core method that handles request proxying,
// with special handling for Docker API-specific requirements.
//
// Primary responsibilities:
// - Establish backend connection
// - Forward request to backend
// - Handle response streaming
// - Support protocol upgrades
// - Ensure proper connection management
func (proxy *ReverseProxy) forwardRequest(w http.ResponseWriter, r *http.Request) {
	// Early check to ensure the ResponseWriter supports http.Flusher.
	// This allows immediate error feedback to the client if the required
	// functionality is not available, rather than failing later during streaming.
	flusher, ok := w.(http.Flusher)
	if !ok {
		proxy.sendError(w, "expected http.ResponseWriter to be an http.Flusher", http.StatusInternalServerError)
		return
	}

	// Leverage the original request's context as the base
	ctx := r.Context()

	// Create a new context with cancellation to ensure we can stop the flush
	// The context will be canceled when the request is done or if needed earlier
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	// Establish a connection to the backend using a custom Dial method
	backendConn, err := proxy.Dial("", "")
	if err != nil {
		proxy.sendError(w, "failed to connect to the backend: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer backendConn.Close()

	// Create a new HTTP request with the same headers
	url := targetProtocol + hostHeaderValue + r.RequestURI
	newReq, err := http.NewRequestWithContext(ctx, r.Method, url, r.Body)
	if err != nil {
		proxy.sendError(w, "failed to create a request for the backend: "+err.Error(), http.StatusInternalServerError)
		return
	}
	newReq.Header = r.Header

	// Director function
	// Allows complete customization of the outgoing request
	if proxy.Director != nil {
		proxy.Director(newReq)
	}
	// Prevent automatic connection closure
	newReq.Close = false

	// Forward the modified request to the backend
	if err = newReq.Write(backendConn); err != nil {
		proxy.sendError(w, "failed to forward the request to the backend: "+err.Error(), http.StatusBadGateway)
		return
	}

	// Read the response from the backend
	backendResponse, err := http.ReadResponse(bufio.NewReader(backendConn), newReq)
	if err != nil {
		proxy.sendError(w, "failed to read the response from the backend: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer backendResponse.Body.Close()

	// ModifyResponse function
	// Allows post-processing of the backend response
	if proxy.ModifyResponse != nil {
		err := proxy.ModifyResponse(backendResponse)
		if err != nil {
			proxy.sendError(w, "failed to modify the response from the backend: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}

	// Propagate backend response headers to the client
	for key, values := range backendResponse.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}

	// Write the response status code and headers and flush it immediately
	w.WriteHeader(backendResponse.StatusCode)
	flusher.Flush()

	// Check if the response has a status code of 101 (Switching Protocols)
	if backendResponse.StatusCode == http.StatusSwitchingProtocols {
		proxy.handleUpgradedConnection(w, backendConn)
		return
	}

	// Stream the response body back to the client
	// flushedWriter is a critical component for supporting
	// long-running, streaming connections like "docker log -f"
	fw := newFlushedWriter(ctx, w)
	_, err = io.Copy(fw, backendResponse.Body)
	if err != nil {
		proxy.logf("failed to stream the response body to the client: %v", err)
	}
}

// handleUpgradedConnection manages HTTP protocol upgrades (e.g., WebSocket),
// specifically tailored for Docker API's hijacking mechanism.
//
// This method:
// - Hijacks the existing connection
// - Manages buffered data
// - Enables bidirectional communication after protocol upgrade
func (proxy *ReverseProxy) handleUpgradedConnection(w http.ResponseWriter, backendConn net.Conn) {
	// Cast writer to safely hijack the connection
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		proxy.logf("client response writer does not support http.Hijacker")
		return
	}

	// Hijack attempts to take control of the underlying connection
	// Returns:
	// - clientConn: The raw network connection
	// - bufferedClientConn: A buffered reader/writer for any pending data
	clientConn, bufferedClientConn, err := hijacker.Hijack()
	if err != nil {
		proxy.logf("cannot hijack client connection: %v", err)
		return
	}
	defer clientConn.Close()

	// Flush any buffered data in the writer to ensure no data is lost
	if bufferedClientConn.Writer.Buffered() > 0 {
		if err := bufferedClientConn.Writer.Flush(); err != nil {
			proxy.logf("failed to flush client connection: %v", err)
			return
		}
	}

	// Process any data already buffered in the reader before full duplex communication
	// This prevents losing any data that might have been read but not yet processed
	if bufferedLen := bufferedClientConn.Reader.Buffered(); bufferedLen > 0 {
		bufferedData := make([]byte, bufferedLen)
		_, err := bufferedClientConn.Reader.Read(bufferedData)
		if err != nil {
			proxy.logf("failed to read buffered data from the client: %v", err)
			return
		}
		_, err = backendConn.Write(bufferedData)
		if err != nil {
			proxy.logf("failed to write buffered data to the backend: %v", err)
			return
		}
	}

	// Cast backend and client connections to HalfReadWriteCloser
	var halfCloserBackendConn HalfReadWriteCloser
	var halfCloserClientConn HalfReadWriteCloser
	if halfCloser, ok := backendConn.(HalfReadWriteCloser); !ok {
		proxy.logf("backend connection does not implement HalfReadCloseWriter")
		return
	} else {
		halfCloserBackendConn = halfCloser
	}
	if halfCloser, ok := clientConn.(HalfReadWriteCloser); !ok {
		proxy.logf("client connection does not implement HalfReadCloseWriter")
		return
	} else {
		halfCloserClientConn = halfCloser
	}

	// Establish a bidirectional pipe between client and backend connections
	// This allows full-duplex communication with support for half-closes
	// Critical for Docker API's stream-based communication model
	if err := Pipe(halfCloserClientConn, halfCloserBackendConn); err != nil {
		proxy.logf("piping client to backend failed: %v", err)
	}
}

func (proxy *ReverseProxy) sendError(w http.ResponseWriter, msg string, statusCode int) {
	proxy.logf(msg)
	http.Error(w, msg, statusCode)
}

func (p *ReverseProxy) logf(format string, args ...any) {
	logger := p.ErrorLog
	if logger == nil {
		logger = log.Default()
	}
	logger.Printf(format, args...)
}

// flushedWriter wraps an io.Writer with periodic flushing capability.
// It ensures that data is periodically flushed to the underlying writer.
type flushedWriter struct {
	w     io.Writer       // Underlying writer to which data is written.
	mu    sync.Mutex      // Mutex to protect concurrent access to the writer and dirty flag.
	ctx   context.Context // Context to control the lifecycle of the periodic flusher.
	dirty bool            // Flag indicating whether the writer may have unflushed data.
}

// NewFlushedWriter creates and initializes a new flushedWriter instance.
// The provided writer w must implement both io.Writer and http.Flusher interfaces.
// If w does not implement http.Flusher, the writer will work but no periodic
// flushing will be performed. It is the caller's responsibility to ensure
// that w implements http.Flusher before instantiation if periodic flushing
// is required.
func newFlushedWriter(ctx context.Context, w io.Writer) *flushedWriter {
	fw := &flushedWriter{
		w:   w,
		ctx: ctx,
	}

	// periodicFlusher runs a loop that periodically flushes the writer
	periodicFlusher := func(flusher http.Flusher) {
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()

		for {
			select {
			case <-fw.ctx.Done():
				return
			case <-ticker.C:
				fw.mu.Lock()
				if fw.dirty {
					flusher.Flush()
					fw.dirty = false
				}
				fw.mu.Unlock()
			}
		}
	}

	// Type assert the writer to http.Flusher
	if flusher, ok := w.(http.Flusher); ok {
		// Start periodic flushing in a goroutine
		go periodicFlusher(flusher)
	}

	return fw
}

// Write implements io.Writer and protects the underlying writer with a mutex
func (fw *flushedWriter) Write(p []byte) (n int, err error) {
	fw.mu.Lock()
	defer fw.mu.Unlock()

	n, err = fw.w.Write(p)
	if n > 0 {
		fw.dirty = true
	}
	return n, err
}
