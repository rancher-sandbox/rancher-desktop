//go:build linux || windows

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
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"regexp"
	"sync"
	"time"

	"github.com/Masterminds/semver"
	"github.com/sirupsen/logrus"

	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/dockerproxy/models"
	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/dockerproxy/platform"
	"github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper/pkg/dockerproxy/util"
)

// RequestContextValue contains things we attach to incoming requests
type RequestContextValue map[interface{}]interface{}

// requestContext is the context key for requestContextValue
var requestContext = struct{}{}

type containerInspectResponseBody struct {
	ID string `json:"Id"`
}

const dockerAPIVersion = "v1.41.0"

// Serve up the docker proxy at the given endpoint, using the given function to
// create a connection to the real dockerd.
func Serve(endpoint string, dialer func() (net.Conn, error)) error {
	listener, err := platform.Listen(endpoint)
	if err != nil {
		return err
	}

	termch := make(chan os.Signal, 1)
	signal.Notify(termch, os.Interrupt)
	go func() {
		<-termch
		signal.Stop(termch)
		err := listener.Close()
		if err != nil {
			logrus.WithError(err).Error("Error closing listener on interrupt")
		}
	}()

	logWriter := logrus.StandardLogger().Writer()
	defer logWriter.Close()
	munger := newRequestMunger()
	proxy := &util.ReverseProxy{
		Dial: func(string, string) (net.Conn, error) {
			return dialer()
		},
		Director: func(req *http.Request) {
			logrus.WithField("request", req).
				WithField("headers", req.Header).
				WithField("url", req.URL).
				Debug("got proxy request")
			// The incoming URL is relative (to the root of the server); we need
			// to add scheme and host ("http://proxy.invalid/") to it.
			req.URL.Scheme = "http"
			req.URL.Host = "proxy.invalid"

			originalReq := *req
			originalURL := *req.URL
			originalReq.URL = &originalURL
			err := munger.MungeRequest(req, dialer)
			if err != nil {
				logrus.WithError(err).
					WithField("original request", originalReq).
					WithField("modified request", req).
					Error("could not munge request")
			}
		},
		ModifyResponse: func(resp *http.Response) error {
			logEntry := logrus.WithField("response", resp)
			defer func() { logEntry.Debug("got backend response") }()

			// Check the API version response, and if there is one, make sure
			// it's not newer than the API version we support.
			backendVersion, err := semver.NewVersion(resp.Header.Get("API-Version"))
			if err == nil {
				logEntry = logEntry.WithField("backend version", backendVersion)
				if backendVersion.GreaterThan(&dockerSpec.Info.Version) {
					overrideVersion := fmt.Sprintf("v%s", dockerSpec.Info.Version.Original())
					resp.Header.Set("API-Version", overrideVersion)
					logEntry = logEntry.WithField("override version", overrideVersion)
				}
			}

			err = munger.MungeResponse(resp, dialer)
			if err != nil {
				return err
			}
			return nil
		},
	}

	server := &http.Server{
		ReadHeaderTimeout: time.Minute,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := context.WithValue(req.Context(), requestContext, &RequestContextValue{})
			newReq := req.WithContext(ctx)
			proxy.ServeHTTP(w, newReq)
		}),
	}

	logrus.WithField("endpoint", endpoint).Info("Listening")

	err = server.Serve(listener)
	if err != nil {
		logrus.WithError(err).Error("serve exited with error")
	}

	return nil
}

// requestMunger is used to modify the incoming http.Request as required.
type requestMunger struct {
	// apiDetectPattern is used to detect the API version request path prefix.
	apiDetectPattern *regexp.Regexp

	sync.RWMutex
}

// newRequestMunger initializes a new requestMunger.
func newRequestMunger() *requestMunger {
	return &requestMunger{
		apiDetectPattern: regexp.MustCompile(`^/v[0-9.]+/`),
	}
}

func (m *requestMunger) getRequestPath(req *http.Request) string {
	// Strip the version string at the start of the request, if it exists.
	requestPath := req.URL.Path
	match := m.apiDetectPattern.FindStringIndex(requestPath)
	logrus.WithFields(logrus.Fields{
		"request path": requestPath,
		"matcher":      m.apiDetectPattern,
		"match":        match,
	}).Debug("getting request path")
	if match != nil {
		return requestPath[match[1]-1:]
	}
	return requestPath
}

// MungeRequest modifies a given request in-place.
func (m *requestMunger) MungeRequest(req *http.Request, dialer func() (net.Conn, error)) error {
	requestPath := m.getRequestPath(req)
	logEntry := logrus.WithFields(logrus.Fields{
		"method": req.Method,
		"path":   requestPath,
		"phase":  "request",
	})
	mungerMapping.RLock()
	mapping, ok := mungerMapping.mungers[req.Method]
	mungerMapping.RUnlock()
	if !ok {
		logEntry.Debug("no munger with method")
		return nil
	}
	munger, templates := mapping.getRequestMunger(requestPath)
	if munger == nil {
		logEntry.Debug("request munger not found")
		return nil
	}

	// ensure id is always the long container id
	id, ok := templates["id"]
	if ok {
		inspect, err := m.CanonicalizeContainerID(req, id, dialer)
		if err != nil {
			logEntry.WithField("id", id).WithError(err).Error("unable to resolve container id")
		} else {
			templates["id"] = inspect.ID
		}
	}

	contextValue, _ := req.Context().Value(requestContext).(*RequestContextValue)
	logEntry.Debug("calling request munger")
	err := munger(req, contextValue, templates)
	if err != nil {
		logEntry.WithField("munger", munger).WithError(err).Error("munger failed")
		return fmt.Errorf("munger failed for %s: %w", requestPath, err)
	}
	return nil
}

func (m *requestMunger) MungeResponse(resp *http.Response, dialer func() (net.Conn, error)) error {
	requestPath := m.getRequestPath(resp.Request)
	logEntry := logrus.WithFields(logrus.Fields{
		"method": resp.Request.Method,
		"path":   requestPath,
		"phase":  "response",
	})
	mungerMapping.RLock()
	mapping, ok := mungerMapping.mungers[resp.Request.Method]
	mungerMapping.RUnlock()
	if !ok {
		logEntry.Debug("no munger with method")
		return nil
	}
	munger, templates := mapping.getResponseMunger(requestPath)
	if munger == nil {
		logEntry.Debug("request munger not found")
		return nil
	}

	// ensure id is always the long container id
	id, ok := templates["id"]
	if ok {
		inspect, err := m.CanonicalizeContainerID(resp.Request, id, dialer)
		if err != nil {
			logEntry.WithField("id", id).WithError(err).Error("unable to resolve container id")
		} else {
			templates["id"] = inspect.ID
		}
	}

	contextValue, _ := resp.Request.Context().Value(requestContext).(*RequestContextValue)
	logEntry.Debug("calling response munger")
	err := munger(resp, contextValue, templates)
	if err != nil {
		logEntry.WithField("munger", munger).WithError(err).Error("munger failed")
		return fmt.Errorf("munger failed for %s: %w", requestPath, err)
	}
	return nil
}

/*
CanonicalizeContainerID makes a request upstream to inspect and resolve the full id of the container
we use the provided id path template variable to make an upstream request to the docker engine api to inspect the container.
Fortunately it supports both id or name as the container identifier.
The Id returned will be the full long container id that is used to lookup in docker-binds.json.
*/
func (m *requestMunger) CanonicalizeContainerID(req *http.Request, id string, dialer func() (net.Conn, error)) (*containerInspectResponseBody, error) {
	// url for inspecting container
	inspectURL, err := req.URL.Parse(fmt.Sprintf("/%s/containers/%s/json", dockerAPIVersion, id))
	if err != nil {
		return nil, err
	}

	client := &http.Client{
		Transport: &http.Transport{
			Dial: func(string, string) (net.Conn, error) {
				return dialer()
			},
		},
	}

	// make the inspect request
	inspectRequest, err := http.NewRequestWithContext(req.Context(), "GET", inspectURL.String(), http.NoBody)
	if err != nil {
		return nil, err
	}
	inspectResponse, err := client.Do(inspectRequest)
	if err != nil {
		return nil, err
	}
	defer inspectResponse.Body.Close()

	// parse response as json
	body := containerInspectResponseBody{}
	buf, err := io.ReadAll(inspectResponse.Body)
	if err != nil {
		return nil, fmt.Errorf("could not read request body: %w", err)
	}

	err = json.Unmarshal(buf, &body)
	if err != nil {
		return nil, fmt.Errorf("could not unmarshal request body: %w", err)
	}

	return &body, nil
}

// dockerSpec contains information about the embedded OpenAPI specification for
// docker.
var dockerSpec struct {
	Info struct {
		Version semver.Version
	}
}

// requestMungerFunc is a munger for an incoming request; it also receives an
// arbitrary mapping that can be reused in the response munger, as well as a
// mapping of any path templating patterns that were matched.
type requestMungerFunc func(*http.Request, *RequestContextValue, map[string]string) error

// responseMungerFunc is a munger for an outgoing response; it also receives an
// arbitrary mapping that was initially passed to the matching request munger,
// as well a a mapping of any path templating patterns that were matched.
type responseMungerFunc func(*http.Response, *RequestContextValue, map[string]string) error

// mungerMethodMapping is a helper structure to find a munger given an API path,
// specialized for a given HTTP method (GET, POST, etc.).
// This should only be written to during init(), at which point it's protected
// by the lock on mungerMapping.
type mungerMethodMapping struct {
	// requests that are simple (have no path templating)
	requests map[string]requestMungerFunc
	// requestPatterns are requests that involve path templating
	requestPatterns map[*regexp.Regexp]requestMungerFunc
	// responses that are simple (have no path templating)
	responses map[string]responseMungerFunc
	// responsePatterns are responses that involve path templating
	responsePatterns map[*regexp.Regexp]responseMungerFunc
}

// getRequestMunger gets the munger to use for this request, as well as the
// path templating elements (if relevant for the munger).
func (m *mungerMethodMapping) getRequestMunger(apiPath string) (requestMungerFunc, map[string]string) {
	if munger, ok := m.requests[apiPath]; ok {
		return munger, nil
	}
	for pattern, munger := range m.requestPatterns {
		matches := pattern.FindStringSubmatch(apiPath)
		if matches != nil {
			names := pattern.SubexpNames()
			results := make(map[string]string)
			for i, name := range names {
				results[name] = matches[i]
			}
			return munger, results
		}
	}
	return nil, nil
}

func (m *mungerMethodMapping) getResponseMunger(apiPath string) (responseMungerFunc, map[string]string) {
	if munger, ok := m.responses[apiPath]; ok {
		return munger, nil
	}
	for pattern, munger := range m.responsePatterns {
		matches := pattern.FindStringSubmatch(apiPath)
		if matches != nil {
			names := pattern.SubexpNames()
			results := make(map[string]string)
			for i, name := range names {
				results[name] = matches[i]
			}
			return munger, results
		}
	}
	return nil, nil
}

// mungerMapping contains mungers that will handle particular API endpoints.
var mungerMapping struct {
	sync.RWMutex
	mungers map[string]*mungerMethodMapping
}

// convertPattern converts an API path to a regular expression pattern for
// matching URLs with path templating; if there are no path templates, this
// returns nil.  The returned pattern always matches the whole string.
func convertPattern(apiPath string) *regexp.Regexp {
	matches := regexp.MustCompile(`{[^}/]+}`).FindAllStringIndex(apiPath, -1)
	if len(matches) < 1 {
		return nil
	}
	lastEnd := 0
	pattern := `\A`
	for _, match := range matches {
		pattern += regexp.QuoteMeta(apiPath[lastEnd:match[0]])
		pattern += fmt.Sprintf(`(?P<%s>[^/]+)`, apiPath[match[0]+1:match[1]-1])
		lastEnd = match[1]
	}
	pattern += regexp.QuoteMeta(apiPath[lastEnd:]) + `\z`
	return regexp.MustCompile(pattern)
}

// Helper method to get a munger method mapping, or created one if it doesn't
// exist.
// This should be called with the mungerMapping lock held.
func getMungerMethodMapping(method string) *mungerMethodMapping {
	mapping, ok := mungerMapping.mungers[method]
	if !ok {
		mapping = &mungerMethodMapping{
			requests:         make(map[string]requestMungerFunc),
			requestPatterns:  make(map[*regexp.Regexp]requestMungerFunc),
			responses:        make(map[string]responseMungerFunc),
			responsePatterns: make(map[*regexp.Regexp]responseMungerFunc),
		}
		mungerMapping.mungers[method] = mapping
	}
	return mapping
}

func RegisterRequestMunger(method, apiPath string, munger requestMungerFunc) {
	mungerMapping.Lock()
	defer mungerMapping.Unlock()

	mapping := getMungerMethodMapping(method)
	if pattern := convertPattern(apiPath); pattern == nil {
		mapping.requests[apiPath] = munger
	} else {
		mapping.requestPatterns[pattern] = munger
	}
}

func RegisterResponseMunger(method, apiPath string, munger responseMungerFunc) {
	mungerMapping.Lock()
	defer mungerMapping.Unlock()

	mapping := getMungerMethodMapping(method)
	if pattern := convertPattern(apiPath); pattern == nil {
		mapping.responses[apiPath] = munger
	} else {
		mapping.responsePatterns[pattern] = munger
	}
}

func init() {
	mungerMapping.mungers = make(map[string]*mungerMethodMapping)
	err := json.Unmarshal(models.SwaggerJSON, &dockerSpec)
	if err != nil {
		panic("could not parse embedded spec version")
	}
}
