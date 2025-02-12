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
	"fmt"
	"io"
)

func Pipe(c1, c2 HalfReadWriteCloser) error {
	ioCopy := func(reader io.Reader, writer io.Writer) <-chan error {
		ch := make(chan error)
		go func() {
			_, err := io.Copy(writer, reader)
			ch <- err
		}()
		return ch
	}

	ch1 := ioCopy(c1, c2)
	ch2 := ioCopy(c2, c1)
	for i := 0; i < 2; i++ {
		select {
		case err := <-ch1:
			cwErr := c2.CloseWrite()
			if cwErr != nil {
				return fmt.Errorf("error closing write end of c2: %w", cwErr)
			}
			if err != nil && err != io.EOF {
				return err
			}
		case err := <-ch2:
			cwErr := c1.CloseWrite()
			if cwErr != nil {
				return fmt.Errorf("error closing write end of c1: %w", cwErr)
			}
			if err != nil && err != io.EOF {
				return err
			}
		}
	}
	return nil
}

type HalfReadWriteCloser interface {
	// CloseWrite closes the write-side of the connection.
	CloseWrite() error
	// Write is a passthrough to the underlying connection.
	io.ReadWriteCloser
}
