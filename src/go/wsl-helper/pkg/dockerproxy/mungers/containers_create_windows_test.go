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
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/dockerproxy"
	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/dockerproxy/models"
	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/dockerproxy/platform"
)

func TestContainersCreate(t *testing.T) {
	t.Run("bind", func(t *testing.T) {
		ctx := context.Background()
		bindPath := t.TempDir()
		body := containersCreateBody{
			HostConfig: models.HostConfig{
				Binds: []string{
					fmt.Sprintf("%s:/host", bindPath),
				},
			},
		}
		buf, err := json.Marshal(&body)
		require.NoError(t, err)
		req, err := http.NewRequestWithContext(
			ctx,
			http.MethodPost,
			"http://nowhere.invalid/",
			io.NopCloser(bytes.NewReader(buf)))
		require.NoError(t, err)
		contextValue := &dockerproxy.RequestContextValue{}
		templates := make(map[string]string)
		err = mungeContainersCreate(req, contextValue, templates)
		require.NoError(t, err)

		err = readRequestBodyJSON(req, &body)
		assert.NoError(t, err)
		slashPath, err := platform.TranslatePathFromClient(t.Context(), bindPath)
		assert.NoError(t, err)
		expectedBind := fmt.Sprintf("%s:/host", slashPath)
		assert.Equal(t, []string{expectedBind}, body.HostConfig.Binds)
	})

	t.Run("mount", func(t *testing.T) {
		ctx := context.Background()
		bindPath := t.TempDir()
		mount := models.Mount{
			Consistency: "cached",
			Source:      bindPath,
			Target:      "/host",
			Type:        struct{ models.MountType }{"bind"},
		}
		body := containersCreateBody{
			HostConfig: models.HostConfig{
				Mounts: []*models.Mount{&mount},
			},
		}
		buf, err := json.Marshal(&body)
		require.NoError(t, err)
		req, err := http.NewRequestWithContext(
			ctx,
			http.MethodPost,
			"http://nowhere.invalid/",
			io.NopCloser(bytes.NewReader(buf)))
		require.NoError(t, err)
		contextValue := &dockerproxy.RequestContextValue{}
		templates := make(map[string]string)
		err = mungeContainersCreate(req, contextValue, templates)
		require.NoError(t, err)

		err = readRequestBodyJSON(req, &body)
		assert.NoError(t, err)
		expected := mount
		slashPath, err := platform.TranslatePathFromClient(t.Context(), bindPath)
		expected.Source = slashPath
		assert.NoError(t, err)
		require.NotEmpty(t, body.HostConfig.Mounts)
		require.NotNil(t, body.HostConfig.Mounts[0])
		assert.Equal(t, expected, *body.HostConfig.Mounts[0])
	})
}
