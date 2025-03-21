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

package mungers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// readRequestBodyJSON reads the incoming HTTP request body as if it was JSON,
// unmarshalled into the provided object.  A copy of the data is placed in the
// request body, so that it can be used by downstream consumers as necessary.
//
//nolint:unused,deadcode // This function is used for the linux build and not windows
func readRequestBodyJSON(req *http.Request, data interface{}) error {
	buf, err := io.ReadAll(req.Body)
	if err != nil {
		return fmt.Errorf("could not read request body: %w", err)
	}

	err = json.Unmarshal(buf, data)
	req.Body = io.NopCloser(bytes.NewBuffer(buf))
	if err != nil {
		return fmt.Errorf("could not unmarshal request body: %w", err)
	}

	return nil
}

// readResponseBodyJSON reads the outgoing HTTP response body as if it was JSON,
// unmarshalled into the provided object.  A copy of the data is placed in the
// response body, so that it can be used directly if no modification needed to
// occur.
//
//nolint:unused,deadcode // This function is used for the linux build and not windows
func readResponseBodyJSON(resp *http.Response, data interface{}) error {
	buf, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("could not read response body: %w", err)
	}

	err = json.Unmarshal(buf, data)
	resp.Body = io.NopCloser(bytes.NewBuffer(buf))
	if err != nil {
		return fmt.Errorf("could not unmarshal response body: %w", err)
	}

	return nil
}
