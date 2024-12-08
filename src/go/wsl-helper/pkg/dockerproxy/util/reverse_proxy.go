package util

import (
	"bufio"
	"context"
	"io"
	"log"
	"net"
	"net/http"
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

	// periodicHttpFlush is a critical component for supporting
	// long-running, streaming connections like "docker log -f"
	periodicHttpFlush := func(w http.ResponseWriter, ctx context.Context) {

		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()

		// Validate flushing capability of the ResponseWriter
		flusher, ok := w.(http.Flusher)
		if !ok {
			log.Println("error: ResponseWriter does not support http.Flusher")
			return
		}

		// Continuous flushing loop with context-aware cancellation
		for {
			select {
			case <-ctx.Done():
				// Context cancellation stops the flushing
				return
			case <-ticker.C:
				select {
				case <-ctx.Done():
					return
				default:
					flusher.Flush()
				}
			}
		}
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
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer backendConn.Close()

	// Create a new HTTP request with the same headers
	url := targetProtocol + hostHeaderValue + r.RequestURI
	newReq, err := http.NewRequest(r.Method, url, r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
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
	newReq.Write(backendConn)

	// Read the response from the backend
	backendResponse, err := http.ReadResponse(bufio.NewReader(backendConn), newReq)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer backendResponse.Body.Close()

	// ModifyResponse function
	// Allows post-processing of the backend response
	if proxy.ModifyResponse != nil {
		err := proxy.ModifyResponse(backendResponse)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
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
	flusher, ok := w.(http.Flusher)
	if !ok {
		panic("expected http.ResponseWriter to be an http.Flusher")
	}
	flusher.Flush()

	// Check if the response has a status code of 101 (Switching Protocols)
	if backendResponse.StatusCode == http.StatusSwitchingProtocols {
		proxy.handleUpgradedConnection(w, backendConn)
		return
	}

	// Start periodic flushing in a background goroutine
	// Supports long-running, streaming responses
	go periodicHttpFlush(w, ctx)

	// Stream the response body back to the client
	_, err = io.Copy(w, backendResponse.Body)
	if err != nil {
		return
	}

}

// handleUpgradedConnection manages HTTP protocol upgrades (e.g., WebSocket),
// specifically tailored for Docker API's hijacking mechanism.
//
// This method:
// - Hijacks the existing connection
// - Manages buffered data
// - Enables bidirectional communication after protocol upgrade
func (*ReverseProxy) handleUpgradedConnection(w http.ResponseWriter, backendConn net.Conn) {
	// Create a ResponseController to safely hijack the connection
	rc := http.NewResponseController(w)

	// Hijack attempts to take control of the underlying connection
	// Returns:
	// - clientConn: The raw network connection
	// - bufferedClientConn: A buffered reader/writer for any pending data
	clientConn, bufferedClientConn, err := rc.Hijack()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer clientConn.Close()

	// Flush any buffered data in the writer to ensure no data is lost
	if bufferedClientConn.Writer.Buffered() > 0 {
		if err := bufferedClientConn.Writer.Flush(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	// Process any data already buffered in the reader before full duplex communication
	// This prevents losing any data that might have been read but not yet processed
	if bufferedLen := bufferedClientConn.Reader.Buffered(); bufferedLen > 0 {
		bufferedData := make([]byte, bufferedLen)
		_, err := bufferedClientConn.Reader.Read(bufferedData)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		_, err = backendConn.Write(bufferedData)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	// Cast backend and client connections to HalfReadWriteCloser
	var xBackendConn HalfReadWriteCloser
	var xClientConn HalfReadWriteCloser
	if x, ok := backendConn.(HalfReadWriteCloser); !ok {
		http.Error(w, "backend connection does not implement HalfReadCloseWriter", http.StatusInternalServerError)
		return
	} else {
		xBackendConn = x
	}
	if x, ok := clientConn.(HalfReadWriteCloser); !ok {
		http.Error(w, "client connection does not implement HalfReadCloseWriter", http.StatusInternalServerError)
		return
	} else {
		xClientConn = x
	}

	// Establish a bidirectional pipe between client and backend connections
	// This allows full-duplex communication with support for half-closes
	// Critical for Docker API's stream-based communication model
	Pipe(xClientConn, xBackendConn)

}
