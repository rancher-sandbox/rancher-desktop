package client

import (
	"fmt"
	"io"
	"net/http"
	"strings"
)

func VersionCommand(version string, command string) string {
	if version == "" {
		version = ApiVersion
	}
	if strings.HasPrefix(command, "/") {
		return fmt.Sprintf("%s%s", version, command)
	}
	return fmt.Sprintf("%s/%s", version, command)
}

func ProcessRequestForAPI(response *http.Response, err error) ([]byte, *APIError, error) {
	if err != nil {
		return nil, nil, err
	}
	errorPacket := APIError{}
	pErrorPacket := &errorPacket
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		errorPacket.Message = &response.Status
	} else {
		pErrorPacket = nil
	}
	defer response.Body.Close()

	body, err := io.ReadAll(response.Body)
	if err != nil {
		if pErrorPacket != nil {
			return nil, pErrorPacket, nil
		}
		// Only return this error if there is nothing else to report
		return nil, nil, err
	}
	return body, pErrorPacket, nil
}

func ProcessRequestForUtility(response *http.Response, err error) ([]byte, error) {
	// Combine platform-specific connection refused errors into a
	// platform-agnostic connection refused error to keep consumers
	// of this code clean.
	if err := handleConnectionRefused(err); err != nil {
		return nil, err
	}
	if response != nil && response.Body != nil {
		defer response.Body.Close()
	}

	statusMessage := ""
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		// Note that response.Status includes response.StatusCode
		switch response.StatusCode {
		case 400:
			statusMessage = response.Status
			// Prefer the error message in the body written by the command-server, not the one from the http server.
		case 401:
			return nil, fmt.Errorf("%s: user/password not accepted", response.Status)
		case 413:
			return nil, fmt.Errorf("%s", response.Status)
		case 500:
			return nil, fmt.Errorf("%s: server-side problem: please consult the server logs for more information", response.Status)
		default:
			return nil, fmt.Errorf("%s (unexpected server error)", response.Status)
		}
	}

	body, err := io.ReadAll(response.Body)
	if err != nil {
		if statusMessage != "" {
			return nil, fmt.Errorf("server error return-code %d: %s", response.StatusCode, statusMessage)
		}
		return nil, err
	} else if statusMessage != "" {
		return nil, fmt.Errorf("%s", string(body))
	}
	return body, nil
}
