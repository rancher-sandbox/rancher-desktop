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

package platform

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestParseBindString(t *testing.T) {
	t.Parallel()
	cases := map[string]struct {
		host      string
		container string
		options   string
		isPath    bool
	}{
		"host:container":            {"host", "container", "", false},
		"host:container:rw":         {"host", "container", "rw", false},
		`C:\Windows:/host`:          {"C:\\Windows", "/host", "", true},
		`C:\Windows:/host:ro`:       {"C:\\Windows", "/host", "ro", true},
		`\\?\c:\windows:/z`:         {`\\?\c:\windows`, "/z", "", true},
		`\\server\share:/share`:     {`\\server\share`, "/share", "", false},
		`\\.\pipe\foo:/pipe:foo:ro`: {`\\.\pipe\foo`, "/pipe:foo", "ro", false},
	}

	for input, expected := range cases {
		t.Run(input, func(t *testing.T) {
			host, container, options, isPath := ParseBindString(input)
			assert.Equal(t, expected.host, host)
			assert.Equal(t, expected.container, container)
			assert.Equal(t, expected.options, options)
			assert.Equal(t, expected.isPath, isPath)
		})
	}
}
