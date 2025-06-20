package dcnone

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"strings"

	dockerconfig "github.com/docker/cli/cli/config"
	"github.com/docker/docker-credential-helpers/credentials"
)

type dockerConfigType map[string]any

func getParsedConfig() (dockerConfigType, error) {
	dockerConfig := make(dockerConfigType)
	contents, err := os.ReadFile(configFile)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			// Time to create a new config (or return no data)
			return dockerConfig, nil
		}
		return dockerConfig, err
	}
	err = json.Unmarshal(contents, &dockerConfig)
	if err != nil {
		return dockerConfig, fmt.Errorf("reading config file %s: %s", configFile, err)
	}
	return dockerConfig, nil
}

func saveParsedConfig(config *dockerConfigType) error {
	contents, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	scratchFile, err := os.CreateTemp(dockerconfig.Dir(), "tmpconfig.json")
	if err != nil {
		return err
	}
	err = os.WriteFile(scratchFile.Name(), contents, 0o600)
	scratchFile.Close()
	if err != nil {
		return err
	}
	return os.Rename(scratchFile.Name(), configFile)
}

/**
 * Returns the Username and Secret associated with `urlArg`, or an error if there was a problem.
 */
func getRecordForServerURL(config *dockerConfigType, urlArg string) (string, string, error) {
	authsInterface, ok := (*config)["auths"]
	if !ok {
		return "", "", credentials.NewErrCredentialsNotFound()
	}
	auths := authsInterface.(map[string]any)
	authDataForURL, ok := auths[urlArg]
	if !ok {
		return "", "", credentials.NewErrCredentialsNotFound()
	}
	authData, ok := authDataForURL.(map[string]any)["auth"]
	if !ok {
		return "", "", credentials.NewErrCredentialsNotFound()
	}
	credentialPair, err := base64.StdEncoding.DecodeString(authData.(string))
	if err != nil {
		return "", "", fmt.Errorf("base64-decoding authdata for URL %s: %s", urlArg, err)
	}
	parts := strings.SplitN(string(credentialPair), ":", 2)
	if len(parts) == 1 {
		return "", "", fmt.Errorf("not a valid base64-encoded pair: <%s>", authData.(string))
	}
	if parts[0] == "" {
		return "", "", credentials.NewErrCredentialsMissingUsername()
	}
	return parts[0], parts[1], nil
}
