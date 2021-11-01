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
	"bytes"
	"errors"
	"io"
	"testing"

	"github.com/stretchr/testify/assert"
)

type nopReadWriteCloser struct {
	io.ReadWriter
}

func (nopReadWriteCloser) Close() error {
	return nil
}

type passthroughReadWriteCloser struct {
	io.ReadCloser
	io.WriteCloser
}

func newPipeReadWriter() io.ReadWriteCloser {
	r, w := io.Pipe()
	return &passthroughReadWriteCloser{
		ReadCloser:  r,
		WriteCloser: w,
	}
}

func (p *passthroughReadWriteCloser) Close() error {
	err := p.ReadCloser.Close()
	if err != nil && !errors.Is(err, io.ErrClosedPipe) {
		return err
	}
	err = p.WriteCloser.Close()
	if err != nil && !errors.Is(err, io.ErrClosedPipe) {
		return err
	}
	return nil
}

func TestPipe(t *testing.T) {
	rw := newPipeReadWriter()
	output := bytes.Buffer{}
	data := &passthroughReadWriteCloser{
		ReadCloser:  nopReadWriteCloser{bytes.NewBufferString("some data")},
		WriteCloser: nopReadWriteCloser{&output},
	}
	err := pipe(rw, data)
	if assert.NoError(t, err) {
		assert.Equal(t, "some data", output.String())
	}
}
