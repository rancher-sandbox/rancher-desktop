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
	"io"
	"net"
	"sync"
)

type connectionProviderFunc func([]byte) (io.ReadWriteCloser, error)

func readHeader(src io.ReadWriteCloser) ([]byte, error) {
	// read up to 64 bytes from request
	buff := make([]byte, 0xffff)
	n, err := src.Read(buff)
	if err != nil {
		return nil, err
	}
	b := buff[:n]

	return b, err
}

func pipe(wg *sync.WaitGroup, src, dst io.ReadWriter) {
	defer wg.Done()

	_, err := io.Copy(src, dst)
	if err != nil {
		fmt.Printf("copy failed '%s'\n", err)
		return
	}
}

// proxyTCPConn takes over local connection passed in, calls provider() passing
// up to 64 bytes of the received header. The provider must return a remote connection
func proxyTCPConn(src net.Conn, provider connectionProviderFunc) {
	defer src.Close()

	header, err := readHeader(src)
	if err != nil {
		fmt.Printf("error reading: %v", err)
		return
	}

	dst, err := provider(header)
	if err != nil {
		fmt.Printf("remote connection failed: %s", err)
		return
	}
	defer dst.Close()

	// send header to remote
	_, err = dst.Write(header)
	if err != nil {
		fmt.Printf("write failed '%s'\n", err)
		return
	}

	wg := &sync.WaitGroup{}
	wg.Add(2)

	go pipe(wg, src, dst)
	go pipe(wg, dst, src)

	wg.Wait()
}
