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
	"io"
)

// pipe bidirectionally between two streams.
func pipe(c1, c2 io.ReadWriteCloser) error {
	copy := func(reader io.Reader, writer io.Writer) <-chan error {
		ch := make(chan error)
		go func() {
			_, err := io.Copy(writer, reader)
			ch <- err
		}()
		return ch
	}

	ch1 := copy(c1, c2)
	ch2 := copy(c2, c1)
	select {
	case err := <-ch1:
		c1.Close()
		c2.Close()
		<-ch2
		if err != io.EOF {
			return err
		}
	case err := <-ch2:
		c1.Close()
		c2.Close()
		<-ch1
		if err != io.EOF {
			return err
		}
	}

	return nil
}
