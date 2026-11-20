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
	"fmt"
	"net/http"

	"github.com/sirupsen/logrus"

	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/dockerproxy"
	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/dockerproxy/platform"
)

// mountTypeNpipe is the HostConfig.Mounts type of a named pipe mount.
const mountTypeNpipe = "npipe"

// munge POST /containers/create to use WSL paths
func mungeContainersCreate(req *http.Request, contextValue *dockerproxy.RequestContextValue, templates map[string]string) error {
	body, err := readContainersCreateBody(req)
	if err != nil {
		return err
	}
	logrus.WithField("body", fmt.Sprintf("%+v", body)).Debug("read body")

	modified := false
	for bindIndex, bind := range body.Binds {
		logrus.WithField(fmt.Sprintf("bind %d", bindIndex), bind).Debug("got bind")
		host, container, options, isPath := platform.ParseBindString(bind)
		if isPath {
			translated, err := platform.TranslatePathFromClient(req.Context(), host)
			if err != nil {
				return fmt.Errorf("could not translate bind path %s: %w", host, err)
			}
			host = translated
			modified = true
		}
		if options == "" {
			body.Binds[bindIndex] = fmt.Sprintf("%s:%s", host, container)
		} else {
			body.Binds[bindIndex] = fmt.Sprintf("%s:%s:%s", host, container, options)
		}
	}

	for _, mount := range body.Mounts {
		if mount == nil {
			continue
		}
		if mount.Type == mountTypeNpipe {
			logrus.WithField("mount", mount).Warn("named pipes are not supported")
		}
		if mount.Type != mountTypeBind {
			// We only support bind mounts for now
			continue
		}
		if !platform.IsAbsolutePath(mount.Source) {
			continue
		}
		translated, err := platform.TranslatePathFromClient(req.Context(), mount.Source)
		if err != nil {
			return fmt.Errorf("could not translate mount path %s: %w", mount.Source, err)
		}
		logrus.WithFields(logrus.Fields{
			"mount":      mount,
			"translated": translated,
		}).Trace("munging mount")
		mount.Source = translated
		modified = true
	}

	if !modified {
		return nil
	}

	return body.writeTo(req)
}

func init() {
	dockerproxy.RegisterRequestMunger(http.MethodPost, "/containers/create", mungeContainersCreate)
}
