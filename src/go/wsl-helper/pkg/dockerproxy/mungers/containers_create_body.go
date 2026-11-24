//go:build linux || windows

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: SUSE LLC
// SPDX-FileCopyrightText: The Rancher Desktop Authors

package mungers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// mountTypeBind is the HostConfig.Mounts type of a bind mount.
const mountTypeBind = "bind"

// containersCreateBody is a POST /containers/create request body.  The mungers
// rewrite only HostConfig.Binds and the sources of bind mounts in
// HostConfig.Mounts, so this type decodes only Binds, and the type and source
// of each mount.  Every other value goes on to dockerd as the client wrote it,
// apart from its JSON formatting (whitespace, key order and string escapes).
// So the proxy forwards fields that this code does not know, such as those
// that newer API versions add.  But if a newer version adds a field that holds
// a host path, or a mount type whose source is a host path, the proxy forwards
// that path without rewriting it.
type containersCreateBody struct {
	Binds  []string
	Mounts []*containersCreateMount

	// raw is the request body as the client sent it.
	raw []byte
	// top is the decoded top-level object.
	top map[string]json.RawMessage
	// hostConfig is the decoded HostConfig object, nil if absent or null.
	hostConfig map[string]json.RawMessage
	// The keys that the client used for HostConfig, Binds and Mounts; empty if the
	// field is absent or null.
	hostConfigKey, bindsKey, mountsKey string
}

// containersCreateMount is one entry in HostConfig.Mounts.
type containersCreateMount struct {
	Type   string
	Source string

	// fields is the decoded mount object.
	fields map[string]json.RawMessage
	// sourceKey is the key that the client used for Source; empty if absent or null.
	sourceKey string
	// originalSource is Source as the client sent it.
	originalSource string
}

// findKey returns the key in object that matches name exactly, or else one that
// matches it case-insensitively, because dockerd decodes the body with
// encoding/json, which matches field names that way.  It returns an empty string
// if there is no such key, or if its value is null.
//
// Call findKey only on an object whose JSON passed checkDuplicateKeys, so that
// at most one key matches name.  If two keys matched, dockerd would decode both
// into the same field, but findKey would return only the exact match, or an
// arbitrary one if neither matched exactly.
func findKey(object map[string]json.RawMessage, name string) string {
	key := ""
	if _, ok := object[name]; ok {
		key = name
	} else {
		for candidate := range object {
			if strings.EqualFold(candidate, name) {
				key = candidate
				break
			}
		}
	}
	if key == "" || string(bytes.TrimSpace(object[key])) == "null" {
		return ""
	}
	return key
}

// checkDuplicateKeys returns an error if two keys of the JSON object in raw
// match case-insensitively, as encoding/json matches keys to struct fields.
// When such keys name a field of dockerd's request types, dockerd decodes
// both into that field, in document order.  But the mungers decode the object
// into a map, which keeps only the last of two identical keys.  Of two keys
// that differ in case, the mungers rewrite only one.  And writeTo re-encodes
// the map with its keys sorted.  Each of these can change the value that
// dockerd reads.  The proxy doesn't know dockerd's types, so it forwards a
// body with any such pair as the client sent it, without translating any
// path in it.
func checkDuplicateKeys(raw json.RawMessage) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	if token != json.Delim('{') {
		return nil
	}
	var keys []string
	for decoder.More() {
		if token, err = decoder.Token(); err != nil {
			return err
		}
		key, _ := token.(string)
		for _, other := range keys {
			if strings.EqualFold(key, other) {
				return fmt.Errorf("duplicate keys %q and %q", other, key)
			}
		}
		keys = append(keys, key)
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return err
		}
	}
	return nil
}

// decodeField decodes the value of the field named name into value, and
// returns the key that the client used for it.  It leaves value untouched if
// the field is absent or null.
func decodeField(object map[string]json.RawMessage, name string, value any) (string, error) {
	key := findKey(object, name)
	if key == "" {
		return "", nil
	}
	if err := json.Unmarshal(object[key], value); err != nil {
		return "", fmt.Errorf("could not unmarshal %s: %w", name, err)
	}
	return key, nil
}

// readContainersCreateBody reads a POST /containers/create request body.  It
// puts the original bytes back into the request first, so that the request
// still reaches dockerd unchanged if decoding fails or finds duplicate keys.
func readContainersCreateBody(req *http.Request) (*containersCreateBody, error) {
	buf, err := io.ReadAll(req.Body)
	if err != nil {
		return nil, fmt.Errorf("could not read request body: %w", err)
	}
	req.Body = io.NopCloser(bytes.NewReader(buf))
	body := &containersCreateBody{raw: buf}
	if err := json.Unmarshal(buf, &body.top); err != nil {
		return nil, fmt.Errorf("could not unmarshal request body: %w", err)
	}
	if err := checkDuplicateKeys(buf); err != nil {
		return nil, err
	}

	body.hostConfigKey, err = decodeField(body.top, "HostConfig", &body.hostConfig)
	if err != nil {
		return nil, err
	}
	if body.hostConfigKey != "" {
		if err := checkDuplicateKeys(body.top[body.hostConfigKey]); err != nil {
			return nil, err
		}
	}
	body.bindsKey, err = decodeField(body.hostConfig, "Binds", &body.Binds)
	if err != nil {
		return nil, err
	}
	var mounts []json.RawMessage
	body.mountsKey, err = decodeField(body.hostConfig, "Mounts", &mounts)
	if err != nil {
		return nil, err
	}
	for _, raw := range mounts {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(raw, &fields); err != nil {
			return nil, fmt.Errorf("could not unmarshal mount: %w", err)
		}
		if fields == nil {
			body.Mounts = append(body.Mounts, nil)
			continue
		}
		if err := checkDuplicateKeys(raw); err != nil {
			return nil, err
		}
		mount := &containersCreateMount{fields: fields}
		if _, err := decodeField(fields, "Type", &mount.Type); err != nil {
			return nil, err
		}
		mount.sourceKey, err = decodeField(fields, "Source", &mount.Source)
		if err != nil {
			return nil, err
		}
		mount.originalSource = mount.Source
		body.Mounts = append(body.Mounts, mount)
	}
	return body, nil
}

// marshalJSON encodes value like json.Marshal, but without escaping <, > and &
// in strings.
func marshalJSON(value any) (json.RawMessage, error) {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buf.Bytes(), []byte("\n")), nil
}

// writeTo replaces the request body with one that has the rewritten Binds and
// mount sources.
func (body *containersCreateBody) writeTo(req *http.Request) error {
	buf := body.raw
	if body.hostConfigKey != "" {
		var err error
		if body.bindsKey != "" {
			if body.hostConfig[body.bindsKey], err = marshalJSON(body.Binds); err != nil {
				return fmt.Errorf("could not marshal Binds: %w", err)
			}
		}
		if body.mountsKey != "" {
			mounts := make([]json.RawMessage, len(body.Mounts))
			for i, mount := range body.Mounts {
				if mount == nil {
					mounts[i] = json.RawMessage("null")
					continue
				}
				if mount.Source != mount.originalSource {
					key := mount.sourceKey
					if key == "" {
						key = "Source"
					}
					if mount.fields[key], err = marshalJSON(mount.Source); err != nil {
						return fmt.Errorf("could not marshal mount source: %w", err)
					}
				}
				if mounts[i], err = marshalJSON(mount.fields); err != nil {
					return fmt.Errorf("could not marshal mount: %w", err)
				}
			}
			if body.hostConfig[body.mountsKey], err = marshalJSON(mounts); err != nil {
				return fmt.Errorf("could not marshal Mounts: %w", err)
			}
		}
		if body.top[body.hostConfigKey], err = marshalJSON(body.hostConfig); err != nil {
			return fmt.Errorf("could not marshal HostConfig: %w", err)
		}
		if buf, err = marshalJSON(body.top); err != nil {
			return fmt.Errorf("could not marshal body: %w", err)
		}
	}
	req.Body = io.NopCloser(bytes.NewReader(buf))
	req.ContentLength = int64(len(buf))
	req.Header.Set("Content-Length", fmt.Sprintf("%d", len(buf)))
	return nil
}

// String returns the request body as the client sent it, for logging.
func (body *containersCreateBody) String() string {
	return string(body.raw)
}

// String returns the mount as JSON, for logging.
func (mount *containersCreateMount) String() string {
	buf, err := marshalJSON(mount.fields)
	if err != nil {
		return fmt.Sprintf("%+v", mount.fields)
	}
	return string(buf)
}
