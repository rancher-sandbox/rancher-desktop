/*
Copyright © 2022 SUSE LLC

*/

// Package cmd is the main package for this CLI
package cmd

import (
  "encoding/json"
  "fmt"
  "io/ioutil"
  "log"
  "net/http"
  "os"
  "path/filepath"
  "strconv"

  "github.com/spf13/cobra"
)

var (
  // Used for flags
  configPath  string
  user string
  port string
  password string
)

// rootCmd represents the base command when called without any subcommands
var rootCmd = &cobra.Command{
	Use:   "rdctl",
	Short: "A CLI for Rancher Desktop",
	Long: `rdctl can be used to drive Rancher Desktop in headless mode.
Supported commands include getting the current preferences,
changing settings (with an automatic restart when needed,
and shutting Rancher Desktop down.`,
}

// Execute adds all child commands to the root command and sets flags appropriately.
// This is called by main.main(). It only needs to happen once to the rootCmd.
func Execute() {
	err := rootCmd.Execute()
	if err != nil {
		os.Exit(1)
	}
}

func init() {
  cobra.OnInitialize(initConfig)

  rootCmd.PersistentFlags().StringVar(&configPath, "config-path", "", "config file (default is $APPHOME/rancher-desktop/rd-engine.json)")
  rootCmd.PersistentFlags().StringVar(&user, "user", "", "overrides the user setting in the config file")
  rootCmd.PersistentFlags().StringVar(&port, "port", "", "overrides the port setting in the config file")
  rootCmd.PersistentFlags().StringVar(&password, "password", "", "overrides the password setting in the config file")
}

func doRequest(method string, command string)  error {
  req, err := getRequestObject(method, command)
  if err != nil {
    return err
  }
  return doRestOfRequest(req)
}

func getRequestObject(method string, command string) (*http.Request, error) {
  req, err := http.NewRequest(method, "http://localhost:" + port + "/v0/" + command, nil)
  if err != nil {
    return nil, err
  }
  req.SetBasicAuth(user, password)
  req.Header.Add("Content-Type", "text/plain")
  req.Close = true
  return req, nil
}

func doRestOfRequest(req *http.Request) error {
  client := http.Client{}
  response, err := client.Do(req)
  if err != nil {
    return err
  }
  if response.StatusCode >= 300 {
    return fmt.Errorf("got status code %d: %s", response.StatusCode, response.Status)
  }

  defer func() {
    _ = response.Body.Close()
  }()
  body, err := ioutil.ReadAll(response.Body)
  if err != nil {
    return err
  }

  fmt.Println(string(body))
  return nil
}

type CLIConfig struct {
  User string
  Password string
  Port int
}

func initConfig() {
  if configPath == "" {
    configDir, err := os.UserConfigDir()
    if err != nil {
      log.Fatal("Can't get config-dir: ", err)
    }
    configPath = filepath.Join(configDir, "rancher-desktop", "rd-engine.json")
  }
  content, err := ioutil.ReadFile(configPath)
  if err != nil {
    log.Fatalf("Error trying to read file %s: %v", configPath, err)
  }

  var settings CLIConfig
  err = json.Unmarshal(content, &settings)
  if err != nil {
    log.Fatalf("Error trying to json-load file %s: %v", configPath, err)
  }

  if user == "" {
    user = settings.User
  }
  if password == "" {
    password = settings.Password
  }
  if port == "" {
    port = strconv.Itoa(settings.Port)
  }
}


