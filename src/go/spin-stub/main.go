package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

const appName = "rancher-desktop"

func main() {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		panic(fmt.Sprintf("failed to get user home directory: %s", err))
	}
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		localAppData = filepath.Join(homeDir, "AppData", "Local")
	}
	err = os.Setenv("SPIN_DATA_DIR", filepath.Join(localAppData, appName, "spin"))
	if err != nil {
		panic(fmt.Sprintf("failed to set SPIN_DATA_DIR: %s", err))
	}
	exe, err := os.Executable()
	if err != nil {
		panic(fmt.Sprintf("failed to get executable path: %s", err))
	}
	spin := filepath.Join(filepath.Dir(filepath.Dir(exe)), "internal", "spin.exe")
	command := exec.Command(spin, os.Args[1:]...)
	command.Stdin = os.Stdin
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	err = command.Run()
	if err != nil {
		panic(fmt.Sprintf("failed to execute command: %s", err))
	}
}
