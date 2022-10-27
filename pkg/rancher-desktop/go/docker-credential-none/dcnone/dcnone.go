// Package dcnone implements a `none` based credential helper.
// Passwords are stored base64-encoded but unencrypted in
// ~/.docker/plaintext-credentials.config.json
// in the `auths` section
// as `ServerURL: auth : base64Encode(Username + ":" + Secret)`

package dcnone

import (
	"encoding/base64"
	"errors"
	"fmt"
	"path/filepath"

	"github.com/docker/docker-credential-helpers/credentials"
	dockerconfig "github.com/docker/docker/cli/config"
)

const configFileName = "plaintext-credentials.config.json"

const VERSION = "0.6.4"

// DCNone handles secrets using HOME/.docker/plaintext-credentials.config.json as a store.
type DCNone struct{}

var configFile string

func init() {
	configFile = filepath.Join(dockerconfig.Dir(), configFileName)
	credentials.Name = "docker-credential-none"
	credentials.Package = "github.com/rancher-sandbox/rancher-desktop/src/go/docker-credential-none"
	credentials.Version = VERSION
}

// Add stores a new credentials or updates an existing one.
func (p DCNone) Add(creds *credentials.Credentials) error {
	var auths map[string]interface{}

	if creds == nil {
		return errors.New("missing credentials")
	}
	config, err := getParsedConfig()
	if err != nil {
		return err
	}
	authsInterface, ok := config["auths"]
	if ok {
		auths, ok = authsInterface.(map[string]interface{})
	}
	if !ok {
		// Either config['auths'] doesn't exist or it isn't a hash
		auths = map[string]interface{}{}
		config["auths"] = auths
	}
	payload := fmt.Sprintf("%s:%s", creds.Username, creds.Secret)
	encoded := base64.URLEncoding.EncodeToString([]byte(payload))
	auths[creds.ServerURL] = map[string]string{"auth": encoded}
	return saveParsedConfig(&config)
}

// Delete removes credentials from the store.
func (p DCNone) Delete(serverURL string) error {
	if serverURL == "" {
		return errors.New("missing server url")
	}
	config, err := getParsedConfig()
	if err != nil {
		return err
	}

	authsInterface, ok := config["auths"]
	if !ok {
		// Not an error if there's no URL (or auths)
		return nil
	}
	auths, ok := authsInterface.(map[string]interface{})
	if !ok {
		// Same as above -- if we can't get the hash we don't have a URL entry to remove
		return nil
	}
	_, ok = auths[serverURL]
	if !ok {
		// Not an error if there's no URL (or auths)
		return nil
	}
	delete(auths, serverURL)
	return saveParsedConfig(&config)
}

// Get returns the username and secret to use for a given registry server URL.
func (p DCNone) Get(serverURL string) (string, string, error) {
	if serverURL == "" {
		return "", "", errors.New("missing server url")
	}
	config, err := getParsedConfig()
	if err != nil {
		return "", "", err
	}
	username, secret, err := getRecordForServerURL(&config, serverURL)
	if err != nil {
		return "", "", err
	}
	return username, secret, nil
}

// List returns the stored URLs and corresponding usernames for a given credentials label
func (p DCNone) List() (map[string]string, error) {
	entries := make(map[string]string)
	config, err := getParsedConfig()
	if err != nil {
		return entries, err
	}
	authsInterface, ok := config["auths"]
	if ok {
		auths, ok := authsInterface.(map[string]interface{})
		if !ok {
			return entries, fmt.Errorf("Unexpected data: %v: not a hash\n", authsInterface)
		}
		for url := range auths {
			username, _, err := getRecordForServerURL(&config, url)
			if username != "" && err == nil {
				entries[url] = username
			}
		}
	}
	return entries, nil
}
