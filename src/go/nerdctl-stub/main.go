package main

import (
	"log"
	"os"
	"os/exec"
)

func main() {
	distro := os.Getenv("RD_WSL_DISTRO")
	if distro == "" {
		distro = "rancher-desktop"
	}
	nerdctl := os.Getenv("RD_NERDCTL")
	if nerdctl == "" {
		nerdctl = "/usr/local/bin/nerdctl"
	}

	err := spawn(distro, nerdctl)
	if err != nil {
		log.Fatal(err)
	}
}

func spawn(distro string, nerdctl string) error {
	args := []string{"--distribution", distro, "--exec", nerdctl, "--address", "/run/k3s/containerd/containerd.sock"}
	args = append(args, os.Args[1:]...)
	cmd := exec.Command("wsl.exe", args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	err := cmd.Run()
	if err != nil {
		exitErr, ok := err.(*exec.ExitError)
		if ok {
			os.Exit(exitErr.ExitCode())
		} else {
			return err
		}
	}
	return nil
}
