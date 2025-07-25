package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

const appName = "rancher-desktop"

func main() {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		panic(fmt.Errorf("failed to retrieve the user's home directory: %w", err))
	}
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		localAppData = filepath.Join(homeDir, "AppData", "Local")
	}
	err = os.Setenv("SPIN_DATA_DIR", filepath.Join(localAppData, appName, "spin"))
	if err != nil {
		panic(fmt.Errorf("failed to set SPIN_DATA_DIR: %w", err))
	}
	exe, err := os.Executable()
	if err != nil {
		panic(fmt.Errorf("failed to get executable path: %w", err))
	}
	spin := filepath.Join(filepath.Dir(filepath.Dir(exe)), "internal", "spin.exe")
	command := exec.CommandContext(context.Background(), spin, os.Args[1:]...)
	command.Stdin = os.Stdin
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	err = command.Run()
	var exitError *exec.ExitError
	if errors.As(err, &exitError) {
		os.Exit(exitError.ExitCode())
	}
	if err != nil {
		panic(fmt.Errorf("failed to execute command: %w", err))
	}
}
