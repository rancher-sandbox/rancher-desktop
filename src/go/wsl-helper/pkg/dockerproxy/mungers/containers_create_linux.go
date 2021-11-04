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

	"github.com/rancher-sandbox/rancher-desktop/src/wsl-helper/pkg/dockerproxy"
	"github.com/rancher-sandbox/rancher-desktop/src/wsl-helper/pkg/dockerproxy/models"
	"github.com/rancher-sandbox/rancher-desktop/src/wsl-helper/pkg/dockerproxy/platform"
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

// mountDir is where we can keep our temporary mounts.
const mountDir = "/mnt/wsl/rancher-desktop/run/docker-mounts"

// contextKey is the key used to locate the bind manager in the request/response
// context.  This only lasts for a single request/response pair.
var contextKey = struct{}{}

// bindManager manages the binding data (but does not do binding itself)
type bindManager struct {
	// Recorded entries, keyed by the random mount point string (the leaf name
	// of the bind host location, as reported to dockerd).  Each entry is only
	// used by one container; multiple entries may map to the same host path.
	Entries map[string]bindManagerEntry `json:",omitempty"`
	sync.RWMutex
}

// bindManagerEntry is one entry in the bind manager.  If all the fields are
// empty, then the bind is incomplete (the container create failed) and it
// should not be used.
type bindManagerEntry struct {
	ContainerId string
	HostPath    string
}

// makeMount creates a new, unused mount point.
func (b *bindManager) makeMount() string {
	b.Lock()
	defer b.Unlock()
	for {
		entry := uuid.New().String()
		_, ok := b.Entries[entry]
		if ok {
			continue
		}
		b.Entries[entry] = bindManagerEntry{}
		return entry
	}
}

// persist the bind manager data; this should be called with the lock held.
func (b *bindManager) persist() error {
	statePath, err := xdg.StateFile("rancher-desktop/docker-binds.json")
	if err != nil {
		return err
	}

	file, err := os.CreateTemp(path.Dir(statePath), "docker-binds-*.json")
	if err != nil {
		return fmt.Errorf("error opening state file %s for writing: %w", statePath, err)
	}
	defer file.Close()
	err = json.NewEncoder(file).Encode(b)
	if err != nil {
		return fmt.Errorf("error writing state file %s: %w", statePath, err)
	}
	if err = file.Close(); err != nil {
		return fmt.Errorf("error closing state file %s: %w", statePath, err)
	}
	if err := os.Rename(file.Name(), statePath); err != nil {
		return fmt.Errorf("error commiting state file %s: %w", statePath, err)
	}

	logrus.WithField("path", statePath).Debug("persisted mount state")
	return nil
}

var bindManagerInstance bindManager

func newBindManager() (*bindManager, error) {
	var result bindManager
	statePath, err := xdg.StateFile("rancher-desktop/docker-binds.json")
	if err != nil {
		return nil, err
	}

	file, err := os.Open(statePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			result.Entries = make(map[string]bindManagerEntry)
			return &result, nil
		}
		return nil, fmt.Errorf("error opening state file %s: %w", statePath, err)
	}
	defer file.Close()
	err = json.NewDecoder(file).Decode(&result)
	if err != nil {
		return nil, fmt.Errorf("error reading state file %s: %w", statePath, err)
	}
	return &result, nil
}

// containersCreateBody describes the contents of a /containers/create request.
type containersCreateBody struct {
	models.ContainerConfig
	HostConfig       models.HostConfig
	NetworkingConfig models.NetworkingConfig
}

// munge incoming request for POST /containers/create
func mungeContainersCreateRequest(req *http.Request, contextValue *dockerproxy.RequestContextValue, templates map[string]string) error {
	body := containersCreateBody{}
	err := readRequestBodyJSON(req, &body)
	if err != nil {
		return err
	}
	logrus.WithField("body", fmt.Sprintf("%+v", body)).Debug("read body")

	// The list of bindings
	binds := make(map[string]string)

	modified := false
	for bindIndex, bind := range body.HostConfig.Binds {
		logrus.WithField(fmt.Sprintf("bind %d", bindIndex), bind).Debug("got bind")
		host, container, options, isPath := platform.ParseBindString(bind)
		if !isPath {
			continue
		}

		bindKey := bindManagerInstance.makeMount()
		binds[bindKey] = host
		host = path.Join(mountDir, bindKey)
		modified = true
		if options == "" {
			body.HostConfig.Binds[bindIndex] = fmt.Sprintf("%s:%s", host, container)
		} else {
			body.HostConfig.Binds[bindIndex] = fmt.Sprintf("%s:%s:%s", host, container, options)
		}
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
	logrus.WithField("binds", binds).Debug("modified binds")

	return nil
}

// munge outgoing response for POST /containers/create
func mungeContainersCreateResponse(resp *http.Response, contextValue *dockerproxy.RequestContextValue, templates map[string]string) error {
	binds, ok := (*contextValue)[contextKey].(*map[string]string)
	if !ok {
		// No binds, meaning either the user didn't specify any, or we didn't need to remap.
		return nil
	}

	if resp.StatusCode != http.StatusCreated {
		// If the response wasn't a success; just clean up the bind mappings.
		bindManagerInstance.Lock()
		for key := range *binds {
			delete(bindManagerInstance.Entries, key)
		}
		bindManagerInstance.Unlock()
		// No need to call persist() here, since empty mounts are not written.
		return nil
	}

	var body struct {
		Id       string
		Warnings []string
	}
	err := readResponseBodyJSON(resp, &body)
	if err != nil {
		return err
	}

	bindManagerInstance.Lock()
	for mountId, hostPath := range *binds {
		bindManagerInstance.Entries[mountId] = bindManagerEntry{
			ContainerId: body.Id,
			HostPath:    hostPath,
		}
	}
	err = bindManagerInstance.persist()
	bindManagerInstance.Unlock()
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
func mungeContainersStartRequest(req *http.Request, contextValue *dockerproxy.RequestContextValue, templates map[string]string) error {
	// Look up all the mappings this container needs
	mapping := make(map[string]string)
	bindManagerInstance.RLock()
	for key, data := range bindManagerInstance.Entries {
		if data.ContainerId == templates["id"] {
			mapping[key] = data.HostPath
		}
	}
	bindManagerInstance.RUnlock()
	if len(mapping) < 1 {
		return nil
	}

	// Do bind mounts
	for bindKey, target := range mapping {
		mountDir := path.Join(mountDir, bindKey)
		logEntry := logrus.WithFields(logrus.Fields{
			"container": templates["id"],
			"bind":      mountDir,
			"target":    target,
		})
		err := os.MkdirAll(mountDir, 0o700)
		if err != nil {
			logEntry.WithError(err).Error("could not create mount directory")
			return fmt.Errorf("could not create volume mount %s: %w", target, err)
		}
		err = unix.Mount(target, mountDir, "none", unix.MS_BIND|unix.MS_REC, "")
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
func mungeContainersStartResponse(req *http.Response, contextValue *dockerproxy.RequestContextValue, templates map[string]string) error {
	binds, ok := (*contextValue)[contextKey].(*map[string]string)
	if !ok {
		// No binds, meaning we didn't do any mounting; nothing to undo here.
		return nil
	}

	for bindKey := range *binds {
		mountDir := path.Join(mountDir, bindKey)
		logEntry := logrus.WithFields(logrus.Fields{
			"container": templates["id"],
			"bind":      mountDir,
		})
		err := unix.Unmount(mountDir, 0)
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
func mungeContainersDeleteResponse(resp *http.Response, contextValue *dockerproxy.RequestContextValue, templates map[string]string) error {
	logEntry := logrus.WithField("templates", templates)
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusNotFound {
		logEntry.WithField("status-code", resp.StatusCode).Debug("unexpected status code")
		return nil
	}
	bindManagerInstance.Lock()
	defer bindManagerInstance.Unlock()

	var toDelete []string
	for key, data := range bindManagerInstance.Entries {
		if data.ContainerId == templates["id"] {
			toDelete = append(toDelete, key)
		}
	}
	for _, key := range toDelete {
		delete(bindManagerInstance.Entries, key)
	}
	bindManagerInstance.persist()
	return nil
}

func init() {
	b, err := newBindManager()
	if err != nil {
		panic(err)
	}
	bindManagerInstance = *b
	dockerproxy.RegisterRequestMunger(http.MethodPost, "/containers/create", mungeContainersCreateRequest)
	dockerproxy.RegisterResponseMunger(http.MethodPost, "/containers/create", mungeContainersCreateResponse)
	dockerproxy.RegisterRequestMunger(http.MethodPost, "/containers/{id}/start", mungeContainersStartRequest)
	dockerproxy.RegisterRequestMunger(http.MethodPost, "/containers/{id}/restart", mungeContainersStartRequest)
	dockerproxy.RegisterResponseMunger(http.MethodPost, "/containers/{id}/start", mungeContainersStartResponse)
	dockerproxy.RegisterResponseMunger(http.MethodPost, "/containers/{id}/restart", mungeContainersStartResponse)
	dockerproxy.RegisterResponseMunger(http.MethodDelete, "/containers/{id}", mungeContainersDeleteResponse)
}
