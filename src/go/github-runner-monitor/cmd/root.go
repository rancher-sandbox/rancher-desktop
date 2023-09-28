/*
Copyright © 2023 SUSE LLC

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

// Package cmd handles the command lines.
package cmd

import (
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"time"

	"github.com/rancher-sandbox/rancher-desktop/src/go/github-runner-monitor/pkg/monitor"
	"github.com/sirupsen/logrus"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	"golang.org/x/sys/unix"
)

var rootCmd = &cobra.Command{
	Use:   "github-runner-linux",
	Short: "Manage ephemeral GitHub runners for Rancher Desktop",
	PersistentPreRun: func(cmd *cobra.Command, args []string) {
		logrus.SetLevel(logrus.InfoLevel + logrus.Level(viper.GetInt("verbose")))
		logrus.SetFormatter(&logrus.TextFormatter{FullTimestamp: true})
	},
	Args: cobra.ExactArgs(0),
	RunE: func(cmd *cobra.Command, args []string) error {
		var err error
		ctx, stop := signal.NotifyContext(cmd.Context(), unix.SIGINT, unix.SIGTERM, unix.SIGHUP)
		defer stop()

		config := monitor.Config{
			RunnerCount:   viper.GetInt("runner-count"),
			CheckInterval: viper.GetDuration("check-interval"),
			AuthToken:     viper.GetString("github-auth-token"),
			Owner:         viper.GetString("owner"),
			Repo:          viper.GetString("repo"),
			Labels:        viper.GetStringSlice("labels"),
			Cpus:          viper.GetInt("cpus"),
			Memory:        viper.GetInt("memory"),
			Disk:          viper.GetString("disk"),
		}

		if config.Disk == "" {
			executable, err := os.Executable()
			if err != nil {
				return fmt.Errorf("failed to find executable: %w", err)
			}
			dir := filepath.Dir(executable)
			files, err := os.ReadDir(dir)
			if err != nil {
				return fmt.Errorf("failed to find disk image: %w", err)
			}
			for _, file := range files {
				if !file.IsDir() && filepath.Ext(file.Name()) == ".qcow2" {
					config.Disk = filepath.Join(dir, file.Name())
					break
				}
			}
			if config.Disk == "" {
				return fmt.Errorf("failed to auto-detect disk image: %w", err)
			}
		} else {
			if config.Disk, err = filepath.Abs(config.Disk); err != nil {
				return fmt.Errorf("failed to resolve disk image: %w", err)
			}
		}

		if err = monitor.Monitor(ctx, config); err != nil {
			return fmt.Errorf("failed to monitor: %w", err)
		}

		return nil
	},
}

// Execute the command line.
func Execute() {
	cobra.CheckErr(rootCmd.Execute())
}

func init() {
	rootCmd.PersistentFlags().CountP("verbose", "v", "Enable extra logging")
	flags := rootCmd.Flags()
	flags.IntP("runner-count", "c", 1, "Number of runners to keep at once")
	flags.Duration("check-interval", time.Minute, "Interval between checking for runners")
	flags.String("github-auth-token", "", "GitHub authentication token with \"repo\" scope")
	flags.StringP("owner", "o", "rancher-sandbox", "GitHub owner")
	flags.StringP("repo", "r", "rancher-desktop", "GitHub repository")
	flags.StringSliceP("labels", "l", []string{"self-hosted", "Linux", "X64", "ephemeral"}, "Labels to apply to the runners")
	flags.Int("cpus", 3, "Number of vCPUs per runner")
	flags.Int("memory", 6*1024, "Memory amount per runner, in megabytes")
	flags.String("disk", "", "Disk image to use for the VM")
	flags.SortFlags = false
	cobra.OnInitialize(initConfig)
}

func initConfig() {
	viper.SetEnvKeyReplacer(strings.NewReplacer("-", "_"))
	viper.AutomaticEnv()
	if err := viper.BindPFlags(rootCmd.Flags()); err != nil {
		logrus.WithError(err).Fatal("Failed to set up flags")
	}
}
