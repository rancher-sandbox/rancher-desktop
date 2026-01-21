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
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"sync"

	"github.com/adrg/xdg"
	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
	"golang.org/x/sys/unix"

	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/dockerproxy"
	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/dockerproxy/models"
	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/dockerproxy/platform"
)

// For Linux (non-rancher-desktop WSL2 containers), we need to do a little more
// work.  The mounts are defined in /containers/create, but used in
// /containers/{id}/start instead; additionally, start may be called multiple
// times (or /containers/{id}/restart may be called).
// To handle this, we need to:
// - in POST /containers/create:
//   - on request, modify the bindings to point to temporary directories.
//   - on response, record the container id + bind mappings.
// - in POST /containers/{id}/start|restart|etc
//   - on request, reconstruct the bind mappings as needed.
//   - on response, remove those bind mappings.
// - in DELETE /containers/{id}
//   - remove the recording binding information
// Note that all persisted info needs to live on disk; it's possible to run
// containers while restarting the docker proxy (or indeed the machine).

// mountRoot is where we can keep our temporary mounts, relative to the WSL
// mount root (typically /mnt/wsl).
const mountRoot = "rancher-desktop/run/docker-mounts"

// contextKey is the key used to locate the bind manager in the request/response
// context.  This only lasts for a single request/response pair.
var contextKey = struct{}{}

// bindManager manages the binding data (but does not do binding itself)
type bindManager struct {
	// mountRoot is where we can keep our temporary mounts.
	mountRoot string

	// Recorded entries, keyed by the random mount point string (the leaf name
	// of the bind host location, as reported to dockerd).  Each entry is only
	// used by one container; multiple entries may map to the same host path.
	entries map[string]bindManagerEntry

	// Name of the file we use for persisting data.
	statePath string

	// Mutex for managing concurrency for the bindManager.
	sync.RWMutex
}

// bindManagerEntry is one entry in the bind manager.  If all the fields are
// empty, then the bind is incomplete (the container create failed) and it
// should not be used.
type bindManagerEntry struct {
	ContainerID string `json:"ContainerId"`
	HostPath    string
}

func newBindManager() (*bindManager, error) {
	statePath, err := xdg.StateFile("rancher-desktop/docker-binds.json")
	if err != nil {
		return nil, err
	}

	mountPoint, err := platform.GetWSLMountPoint()
	if err != nil {
		return nil, err
	}

	result := bindManager{
		mountRoot: path.Join(mountPoint, mountRoot),
		entries:   make(map[string]bindManagerEntry),
		statePath: statePath,
	}
	err = result.load()
	if err != nil {
		return nil, err
	}
	return &result, nil
}

// load the persisted bind manager data; this should only be called from
// newBindManager().
func (b *bindManager) load() error {
	file, err := os.Open(b.statePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			b.entries = make(map[string]bindManagerEntry)
			return nil
		}
		return fmt.Errorf("error opening state file %s: %w", b.statePath, err)
	}
	defer file.Close()
	err = json.NewDecoder(file).Decode(&b.entries)
	if err != nil {
		return fmt.Errorf("error reading state file %s: %w", b.statePath, err)
	}
	return nil
}

// persist the bind manager data; this should be called with the lock held.
func (b *bindManager) persist() error {
	file, err := os.CreateTemp(path.Dir(b.statePath), "docker-binds.*.json")
	if err != nil {
		return fmt.Errorf("error opening state file %s for writing: %w", b.statePath, err)
	}
	defer file.Close()
	err = json.NewEncoder(file).Encode(b.entries)
	if err != nil {
		return fmt.Errorf("error writing state file %s: %w", b.statePath, err)
	}
	if err = file.Sync(); err != nil {
		return fmt.Errorf("error syncing state file %s: %w", b.statePath, err)
	}
	if err = file.Close(); err != nil {
		return fmt.Errorf("error closing state file %s: %w", b.statePath, err)
	}
	if err := os.Rename(file.Name(), b.statePath); err != nil {
		return fmt.Errorf("error committing state file %s: %w", b.statePath, err)
	}

	logrus.WithField("path", b.statePath).Debug("persisted mount state")
	return nil
}

// makeMount creates a new, unused mount point.
func (b *bindManager) makeMount() string {
	b.Lock()
	defer b.Unlock()
	for {
		entry := uuid.New().String()
		_, ok := b.entries[entry]
		if ok {
			continue
		}
		b.entries[entry] = bindManagerEntry{}
		return entry
	}
}

// prepareMountPath creates target directory or file, as mount point
func (b *bindManager) prepareMountPath(target, bindKey string) error {
	mountPath := path.Join(b.mountRoot, bindKey)
	hostPathStat, err := os.Stat(target)
	if os.IsNotExist(err) {
		return fmt.Errorf("host path (%s) doesn't exist: %w", target, err)
	}
	var pathToCreate string
	mountingFile := false
	if hostPathStat.IsDir() {
		pathToCreate = mountPath
	} else {
		pathToCreate = b.mountRoot
		mountingFile = true
	}
	err = os.MkdirAll(pathToCreate, 0o700)
	if err != nil {
		return fmt.Errorf("could not create bind mount directory %s: %w", mountPath, err)
	}
	if mountingFile {
		// We're mounting a file; create a file to be mounted over.
		fd, err := os.Create(mountPath)
		if err != nil {
			return fmt.Errorf("could not create volume mount file %s: %w", mountPath, err)
		}
		fd.Close()
	}
	return nil
}

// containersCreateRequestBody describes the contents of a /containers/create request.
type containersCreateRequestBody struct {
	models.ContainerConfig
	HostConfig       models.HostConfig
	NetworkingConfig models.NetworkingConfig
}

// munge incoming request for POST /containers/create
func (b *bindManager) mungeContainersCreateRequest(req *http.Request, contextValue *dockerproxy.RequestContextValue, templates map[string]string) error {
	body := containersCreateRequestBody{}
	err := readRequestBodyJSON(req, &body)
	if err != nil {
		return err
	}
	logrus.WithField("body", fmt.Sprintf("%+v", body)).Trace("read body")

	// The list of bindings
	binds := make(map[string]string)

	modified := false
	for bindIndex, bind := range body.HostConfig.Binds {
		logrus.WithField(fmt.Sprintf("bind %d", bindIndex), bind).Trace("got bind")
		host, container, options, isPath := platform.ParseBindString(bind)
		if !isPath {
			continue
		}

		bindKey := b.makeMount()
		binds[bindKey] = host
		host = path.Join(b.mountRoot, bindKey)
		modified = true
		if options == "" {
			body.HostConfig.Binds[bindIndex] = fmt.Sprintf("%s:%s", host, container)
		} else {
			body.HostConfig.Binds[bindIndex] = fmt.Sprintf("%s:%s:%s", host, container, options)
		}
	}

	for _, mount := range body.HostConfig.Mounts {
		logEntry := logrus.WithField("mount", fmt.Sprintf("%+v", mount))
		if mount.Type.MountType != "bind" {
			logEntry.Trace("skipping mount of unsupported type")
			continue
		}
		if !path.IsAbs(mount.Source) {
			logEntry.Trace("skipping non-host mount")
			continue
		}

		bindKey := b.makeMount()
		target := mount.Source
		binds[bindKey] = target
		mount.Source = path.Join(b.mountRoot, bindKey)
		// Unlike .HostConfig.Binds, the source for .HostConfig.Mounts must
		// exist at container create time.
		err := b.prepareMountPath(target, bindKey)
		if err != nil {
			logEntry.WithError(err).Error("could not prepare mount volume")
			return err
		}
		logEntry.WithField("bind key", bindKey).Trace("got mount")
		modified = true
	}

	if !modified {
		return nil
	}

	(*contextValue)[contextKey] = &binds
	buf, err := json.Marshal(&body)
	if err != nil {
		logrus.WithError(err).Error("could not re-serialize modified body")
		return err
	}
	req.Body = io.NopCloser(bytes.NewBuffer(buf))
	req.ContentLength = int64(len(buf))
	req.Header.Set("Content-Length", fmt.Sprintf("%d", len(buf)))
	logrus.WithField("binds", fmt.Sprintf("%+v", binds)).Debug("modified binds")

	return nil
}

// containersCreateResponseBody describes the contents of a /containers/create response.
type containersCreateResponseBody struct {
	ID       string `json:"Id"`
	Warnings []string
}

// munge outgoing response for POST /containers/create
func (b *bindManager) mungeContainersCreateResponse(resp *http.Response, contextValue *dockerproxy.RequestContextValue, templates map[string]string) error {
	binds, ok := (*contextValue)[contextKey].(*map[string]string)
	if !ok {
		// No binds, meaning either the user didn't specify any, or we didn't need to remap.
		return nil
	}

	if resp.StatusCode != http.StatusCreated {
		// If the response wasn't a success; just clean up the bind mappings.
		b.Lock()
		for key := range *binds {
			delete(b.entries, key)
		}
		b.Unlock()
		// No need to call persist() here, since empty mounts are not written.
		return nil
	}

	var body containersCreateResponseBody
	err := readResponseBodyJSON(resp, &body)
	if err != nil {
		return err
	}

	b.Lock()
	for mountID, hostPath := range *binds {
		b.entries[mountID] = bindManagerEntry{
			ContainerID: body.ID,
			HostPath:    hostPath,
		}
	}
	err = b.persist()
	b.Unlock()
	if err != nil {
		logrus.WithError(err).Error("error writing state file")
		return fmt.Errorf("could not write state: %w", err)
	}

	logrus.WithField("binds", binds).WithField("body", body).Debug("got stored binds")
	return nil
}

// munge incoming request to activate the mount, on
// POST /containers/{id}/start
// POST /containers/{id}/restart
func (b *bindManager) mungeContainersStartRequest(req *http.Request, contextValue *dockerproxy.RequestContextValue, templates map[string]string) error {
	// Look up all the mappings this container needs
	mapping := make(map[string]string)
	b.RLock()
	for key, data := range b.entries {
		if data.ContainerID == templates["id"] {
			mapping[key] = data.HostPath
		}
	}
	b.RUnlock()
	if len(mapping) < 1 {
		return nil
	}

	// Do bind mounts
	for bindKey, target := range mapping {
		mountPath := path.Join(b.mountRoot, bindKey)
		logEntry := logrus.WithFields(logrus.Fields{
			"container": templates["id"],
			"bind":      mountPath,
			"target":    target,
		})
		err := b.prepareMountPath(target, bindKey)
		if err != nil {
			logEntry.WithError(err).Error("could not prepare mount volume")
			return err
		}
		err = unix.Mount(target, mountPath, "none", unix.MS_BIND|unix.MS_REC, "")
		if err != nil {
			logEntry.WithError(err).Error("could not perform bind mount")
			return fmt.Errorf("could not mount volume %s: %w", target, err)
		}
		logEntry.Debug("created bind mount")
	}

	(*contextValue)[contextKey] = &mapping

	return nil
}

// munge outgoing response to deactivate the mount, on
// POST /containers/{id}/start
// POST /containers/{id}/restart
func (b *bindManager) mungeContainersStartResponse(req *http.Response, contextValue *dockerproxy.RequestContextValue, templates map[string]string) error {
	binds, ok := (*contextValue)[contextKey].(*map[string]string)
	if !ok {
		// No binds, meaning we didn't do any mounting; nothing to undo here.
		return nil
	}

	for bindKey := range *binds {
		mountDir := path.Join(b.mountRoot, bindKey)
		logEntry := logrus.WithFields(logrus.Fields{
			"container": templates["id"],
			"bind":      mountDir,
		})
		err := unix.Unmount(mountDir, unix.MNT_DETACH|unix.UMOUNT_NOFOLLOW)
		if err != nil {
			logEntry.WithError(err).Error("failed to unmount")
			return fmt.Errorf("could not unmount bind mount %s: %w", mountDir, err)
		}
		err = os.Remove(mountDir)
		if err != nil {
			logEntry.WithError(err).Error("failed to remove bind directory")
			return fmt.Errorf("could not remove bind mount directory %s: %w", mountDir, err)
		}
		logEntry.Debug("removed bind mount")
	}

	return nil
}

// DELETE /containers/{id}
func (b *bindManager) mungeContainersDeleteResponse(resp *http.Response, contextValue *dockerproxy.RequestContextValue, templates map[string]string) error {
	logEntry := logrus.WithField("templates", templates)
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusNotFound {
		logEntry.WithField("status-code", resp.StatusCode).Debug("unexpected status code")
		return nil
	}
	b.Lock()
	defer b.Unlock()

	var toDelete []string
	for key, data := range b.entries {
		if data.ContainerID == templates["id"] {
			toDelete = append(toDelete, key)
		}
	}
	for _, key := range toDelete {
		delete(b.entries, key)
	}
	if err := b.persist(); err != nil {
		logrus.WithError(err).Error("error writing state file")
		return fmt.Errorf("could not write state: %w", err)
	}
	return nil
}

func init() {
	b, err := newBindManager()
	if err != nil {
		panic(err)
	}
	dockerproxy.RegisterRequestMunger(http.MethodPost, "/containers/create", b.mungeContainersCreateRequest)
	dockerproxy.RegisterResponseMunger(http.MethodPost, "/containers/create", b.mungeContainersCreateResponse)
	dockerproxy.RegisterRequestMunger(http.MethodPost, "/containers/{id}/start", b.mungeContainersStartRequest)
	dockerproxy.RegisterRequestMunger(http.MethodPost, "/containers/{id}/restart", b.mungeContainersStartRequest)
	dockerproxy.RegisterResponseMunger(http.MethodPost, "/containers/{id}/start", b.mungeContainersStartResponse)
	dockerproxy.RegisterResponseMunger(http.MethodPost, "/containers/{id}/restart", b.mungeContainersStartResponse)
	dockerproxy.RegisterResponseMunger(http.MethodDelete, "/containers/{id}", b.mungeContainersDeleteResponse)
}
