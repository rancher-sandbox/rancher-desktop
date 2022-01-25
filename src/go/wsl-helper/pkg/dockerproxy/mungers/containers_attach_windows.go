/*
Copyright © 2022 SUSE LLC

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
	"context"
	"net/http"
	"sync"

	"github.com/sirupsen/logrus"

	"github.com/rancher-sandbox/rancher-desktop/src/wsl-helper/pkg/dockerproxy"
)

// A containerEntry describes a wait for an outstanding container.
type containerEntry struct {
	// A channel that will be closed once the container is removed.
	channel chan struct{}
	// Synchronization to ensure we only close the channel once.
	sync.Once
}

// attachManager watches /containers/{id}/attach and /containers/{id}/wait so
// that we manually close the attached connection when the container has been
// removed.  This is necessary as our use of httputil.ReverseProxy does not
// appear to close it correctly.
//
// Note that this means that if no client ever calls /containers/{id}/wait then
// we will never correctly close the connection correctly; this should be okay
// as the clients we care about do.
//
// This appears to only be required on Windows; also, the /containers/{id}/wait
// endpoint appears to be functioning correctly and closes the connection.
type attachManager struct {
	sync.Mutex
	containers map[string]*containerEntry
}

// munge POST /containers/{id}/attach to close the connection when the wait is
// complete.
//
// Note that this function tries to not return an error; if something unexpected
// happens, we don't do the extra hooking to correctly terminate interactive
// sessions, but that's still better than not starting the container.
func (a *attachManager) mungeContainersAttachResponse(resp *http.Response, contextValue *dockerproxy.RequestContextValue, templates map[string]string) error {
	logEntry := logrus.WithField("path", resp.Request.URL.Path)
	id, ok := templates["id"]
	if !ok {
		logEntry.Error("no container ID found")
		return nil
	}
	cancelFunc, ok := (*contextValue)[dockerproxy.CancelContext].(context.CancelFunc)
	if !ok {
		logEntry.Error("could not get cancel function")
		return nil
	}

	var entry *containerEntry
	{
		a.Lock()
		entry, ok = a.containers[id]
		if !ok {
			// Not waiting yet; make a new entry so we can wait.
			entry = &containerEntry{channel: make(chan struct{})}
			a.containers[id] = entry
		}
		a.Unlock()
	}
	go func() {
		<-entry.channel
		logEntry.Trace("force closing response")
		cancelFunc()
	}()
	return nil
}

// Munge POST /containers/{id}/wait response to check when a given container
// has been removed, to trigger force closing of /containers/{id}/attach
// Note that this means if the client never calls /container{id}/wait we will
// never force close the /container/{id}/attach connection.
func (a *attachManager) mungeContainersWaitResponse(resp *http.Response, contextValue *dockerproxy.RequestContextValue, templates map[string]string) error {
	logEntry := logrus.WithField("path", resp.Request.URL.Path)
	id, ok := templates["id"]
	if !ok {
		logEntry.Error("no container ID found")
		return nil
	}
	resp.Header.Set("Connection", "close")
	var entry *containerEntry
	a.Lock()
	if entry, ok = a.containers[id]; !ok {
		entry = &containerEntry{channel: make(chan struct{})}
		a.containers[id] = entry
	}
	a.Unlock()
	go func() {
		<-resp.Request.Context().Done()
		entry.Do(func() {
			logEntry.Trace("/wait completed, closing corresponding /attach")
			close(entry.channel)
			a.Lock()
			delete(a.containers, id)
			a.Unlock()
		})
	}()
	return nil
}

func init() {
	a := attachManager{
		containers: make(map[string]*containerEntry),
	}
	dockerproxy.RegisterResponseMunger(http.MethodPost, "/containers/{id}/attach", a.mungeContainersAttachResponse)
	dockerproxy.RegisterResponseMunger(http.MethodPost, "/containers/{id}/wait", a.mungeContainersWaitResponse)
}
