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

package mungers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"os"
	"path"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/rancher-sandbox/rancher-desktop/src/wsl-helper/pkg/dockerproxy"
	"github.com/rancher-sandbox/rancher-desktop/src/wsl-helper/pkg/dockerproxy/models"
)

func TestBindManagerPersist(t *testing.T) {
	original := &bindManager{
		statePath: path.Join(t.TempDir(), "state.json"),
	}
	// Loading a file that doesn't exist should succeed
	err := original.load()
	require.NoError(t, err)
	assert.Empty(t, original.Entries)
	assert.NoFileExists(t, original.statePath)
	original.Entries = map[string]bindManagerEntry{
		"foo": bindManagerEntry{
			ContainerId: "hello",
			HostPath:    "world",
		},
	}
	err = original.persist()
	require.NoError(t, err)
	assert.FileExists(t, original.statePath)
	loaded := &bindManager{
		statePath: original.statePath,
	}
	err = loaded.load()
	require.NoError(t, err)
	assert.Equal(t, original, loaded)
}

func TestContainersCreate(t *testing.T) {
	// Create a bind manager
	bindManager := &bindManager{
		Entries:   make(map[string]bindManagerEntry),
		statePath: path.Join(t.TempDir(), "state.json"),
	}

	// Emit the request
	ctx := context.Background()
	buf, err := json.Marshal(&containersCreateRequestBody{
		HostConfig: models.HostConfig{
			Binds: []string{
				"/foo",
			},
		},
	})
	require.NoError(t, err)
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"http://nowhere.invalid/",
		io.NopCloser(bytes.NewReader(buf)))
	require.NoError(t, err)
	contextValue := &dockerproxy.RequestContextValue{}
	templates := make(map[string]string)
	err = bindManager.mungeContainersCreateRequest(req, contextValue, templates)
	require.NoError(t, err)

	// Handle the response
	buf, err = json.Marshal(&containersCreateResponseBody{
		Id: "hello",
	})
	require.NoError(t, err)
	resp := &http.Response{
		StatusCode:    http.StatusCreated,
		Body:          io.NopCloser(bytes.NewBuffer(buf)),
		ContentLength: int64(len(buf)),
		Request:       req,
	}
	err = bindManager.mungeContainersCreateResponse(resp, contextValue, templates)
	require.NoError(t, err)

	// Read the request body
	var requestBody containersCreateRequestBody
	err = readRequestBodyJSON(req, &requestBody)
	assert.NoError(t, err)
	assert.Len(t, requestBody.HostConfig.Binds, 1)

	// Read the response body
	var responseBody containersCreateResponseBody
	err = readResponseBodyJSON(resp, &responseBody)
	assert.NoError(t, err)

	// Assert state
	assert.Len(t, bindManager.Entries, 1)
	var mountId string
	var entry bindManagerEntry
	for mountId, entry = range bindManager.Entries {
	}
	assert.NotEmpty(t, mountId)
	assert.Equal(t, "hello", entry.ContainerId)
	assert.Equal(t, "hello", responseBody.Id)
	expectedMount := path.Join(mountDir, mountId)
	expectedBind := fmt.Sprintf("%s:/foo", expectedMount)
	assert.Equal(t, expectedBind, requestBody.HostConfig.Binds[0])
}

func TestContainersStart(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("test requires privileges (use go test -exec sudo)")
	}

	hostPath := t.TempDir()
	bindManager := &bindManager{
		Entries: map[string]bindManagerEntry{
			"mount-id": bindManagerEntry{
				ContainerId: "container-id",
				HostPath:    hostPath,
			},
		},
		statePath: path.Join(t.TempDir(), "state.json"),
	}
	req, err := http.NewRequestWithContext(
		context.Background(),
		http.MethodPost,
		"http://nowhere.invalid/",
		io.NopCloser(bytes.NewReader([]byte{})))
	require.NoError(t, err)
	resp := &http.Response{
		StatusCode:    http.StatusOK,
		Body:          io.NopCloser(bytes.NewBuffer([]byte{})),
		ContentLength: int64(0),
		Request:       req,
	}
	contextValue := &dockerproxy.RequestContextValue{}
	templates := map[string]string{
		"id": "container-id",
	}
	err = bindManager.mungeContainersStartRequest(req, contextValue, templates)
	assert.NoError(t, err)
	assert.DirExists(t, path.Join(mountDir, "mount-id"))

	// getBindMounts returns a map of bind mount directory -> underlying path
	// Note that this may also return items that are not bind mounts.
	getBindMounts := func() (map[string]string, error) {
		mountBuf, err := ioutil.ReadFile("/proc/self/mountinfo")
		if err != nil {
			return nil, fmt.Errorf("could not read /proc/self/mountinfo: %w", err)
		}

		result := make(map[string]string)
		for _, line := range strings.Split(string(mountBuf), "\n") {
			fields := strings.Fields(line)
			if len(fields) < 5 {
				continue
			}
			sourcePath := fields[3]
			destPath := fields[4]
			result[destPath] = sourcePath
		}
		return result, nil
	}

	mounts, err := getBindMounts()
	if assert.NoError(t, err) {
		assert.Contains(t, mounts, path.Join(mountDir, "mount-id"))
		assert.Equal(t, hostPath, mounts[path.Join(mountDir, "mount-id")])
	}

	err = bindManager.mungeContainersStartResponse(resp, contextValue, templates)
	assert.NoError(t, err)

	// Check that the bind mount went away
	mounts, err = getBindMounts()
	if assert.NoError(t, err) {
		assert.NotContains(t, mounts, path.Join(mountDir, "mount-id"))
	}
}

func TestContainerDelete(t *testing.T) {
	hostPath := t.TempDir()
	bindManager := &bindManager{
		Entries: map[string]bindManagerEntry{
			"mount-id": bindManagerEntry{
				ContainerId: "container-id",
				HostPath:    hostPath,
			},
		},
		statePath: path.Join(t.TempDir(), "state.json"),
	}

	req, err := http.NewRequestWithContext(
		context.Background(),
		http.MethodDelete,
		"http://nowhere.invalid/",
		io.NopCloser(bytes.NewReader([]byte{})))
	require.NoError(t, err)
	resp := &http.Response{
		StatusCode:    http.StatusNoContent,
		Body:          io.NopCloser(bytes.NewBuffer([]byte{})),
		ContentLength: int64(0),
		Request:       req,
	}
	contextValue := &dockerproxy.RequestContextValue{}
	templates := map[string]string{
		"id": "container-id",
	}

	err = bindManager.mungeContainersDeleteResponse(resp, contextValue, templates)
	assert.NoError(t, err)
	assert.Empty(t, bindManager.Entries)
}
