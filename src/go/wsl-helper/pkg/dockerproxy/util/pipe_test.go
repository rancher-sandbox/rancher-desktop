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

package util

import (
	"bytes"
	"io"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
)

// bidirectionalHalfClosePipe is a testing utility that simulates a bidirectional pipe
// with the ability to half-close connections. It's designed to mimic scenarios
// like interactive command-line operations where a client can send data and
// then half-close the connection while waiting for a response.
type bidirectionalHalfClosePipe struct {
	r io.ReadCloser
	w io.WriteCloser
}

// newBidirectionalHalfClosePipe creates two interconnected bidirectional pipe endpoints.
//
// The function returns two bidirectionalHalfClosePipe instances that are connected
// such that what is written to one's write endpoint can be read from the other's
// read endpoint, and vice versa.
//
// Returns:
//   - h1: First bidirectional pipe endpoint
//   - h2: Second bidirectional pipe endpoint
func newBidirectionalHalfClosePipe() (h1, h2 *bidirectionalHalfClosePipe) {
	pr1, pw1 := io.Pipe()
	pr2, pw2 := io.Pipe()

	h1 = &bidirectionalHalfClosePipe{
		r: pr1, w: pw2,
	}

	h2 = &bidirectionalHalfClosePipe{
		r: pr2, w: pw1,
	}
	return
}

func (h *bidirectionalHalfClosePipe) CloseWrite() error {
	return h.w.Close()
}

func (h *bidirectionalHalfClosePipe) Close() error {
	wErr := h.w.Close()
	rErr := h.r.Close()

	if wErr != nil {
		return wErr
	}
	return rErr
}

func (h *bidirectionalHalfClosePipe) Read(p []byte) (n int, err error) {
	return h.r.Read(p)
}

func (h *bidirectionalHalfClosePipe) Write(p []byte) (n int, err error) {
	return h.w.Write(p)
}

// TestPipe verifies the functionality of the bidirectional pipe utility.
//
// The test simulates a scenario similar to interactive command execution,
// such as a docker run -i command, which requires bidirectional communication.
// This test case mimics scenarios like:
// - Sending input to a Docker container via stdin
// - Half-closing the input stream
// - Receiving output from the container
//
// The test steps are:
// 1. A client sends data
// 2. The client half-closes the connection
// 3. The server reads the data
// 4. The server sends a return response
// 5. The server half-closes the connection
//
// This approach is particularly relevant for interactive Docker runs where
// the client needs to send input and then wait for the container's response,
// while maintaining the ability to close streams independently.
func TestPipe(t *testing.T) {
	h1a, h1b := newBidirectionalHalfClosePipe()
	h2a, h2b := newBidirectionalHalfClosePipe()
	var wg sync.WaitGroup
	wg.Add(2)

	// Goroutine simulating the client-side operation
	go func() {
		defer wg.Done()
		dataToSend := bytes.NewBufferString("some data")
		_, err := h1a.Write(dataToSend.Bytes())
		assert.NoError(t, err)
		h1a.CloseWrite()

		output, err := io.ReadAll(h1a)
		assert.NoError(t, err)
		assert.EqualValues(t, output, "return data")
	}()

	// Goroutine simulating the server-side operation
	go func() {
		defer wg.Done()
		output, err := io.ReadAll(h2b)
		assert.NoError(t, err)
		assert.EqualValues(t, output, "some data")

		dataToSend := bytes.NewBufferString("return data")
		_, err = h2b.Write(dataToSend.Bytes())
		assert.NoError(t, err)

		h2b.CloseWrite()
	}()

	err := Pipe(h1b, h2a)
	assert.NoError(t, err)
	wg.Wait()
}
