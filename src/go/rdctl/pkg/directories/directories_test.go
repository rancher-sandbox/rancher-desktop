/*
Copyright © 2024 SUSE LLC

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

package directories_test

import (
	"testing"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/directories"
	"github.com/stretchr/testify/assert"
)

func TestGetApplicationDirectory(t *testing.T) {
	_, err := directories.GetApplicationDirectory()
	assert.NoError(t, err)
	// `go test` makes a temporary directory, so we can't sensibly test the
	// return value.
}
