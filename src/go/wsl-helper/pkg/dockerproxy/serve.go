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
	"errors"
	"fmt"
	"net"
	"os"
	"os/signal"
)

// serve up the docker proxy at the given endpoint, using the given function to
// create a connection to the real dockerd.
func serve(endpoint string, dialer func() (net.Conn, error)) error {
	listener, err := listen(endpoint)
	if err != nil {
		return err
	}

	fmt.Printf("got listener %+v\n", listener)

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

	for {
		clientConn, err := listener.Accept()
		if err != nil {
			if errors.Is(err, errListenerClosed) {
				// If the connection is already closed, just return
				return nil
			}
			fmt.Printf("error accepting: %s\n", err)
			continue
		}

		go func(clientConn net.Conn) {
			conn, err := dialer()
			if err != nil {
				fmt.Printf("Error dialing: %s\n", err)
				return
			}
			defer conn.Close()

			fmt.Printf("Got client %+v\n", clientConn)
			fmt.Printf("Dialed: %+v\n", conn)

			err = pipe(clientConn, conn)
			if err != nil {
				fmt.Printf("Error copying: %s\n", err)
			}
		}(clientConn)
	}
}
