package main

import (
	"context"
	"log"
	"os"
)

type spawnOptions struct {
	// distro is the name of the WSL distribution for rancher-desktop.
	distro string
	// nerdctl is the full path to a Linux-native nerdctl executable.
	nerdctl string
	// containerdSocket contains the path to the containerd socket.
	containerdSocket string
	// args are the parsed arguments for the WSL executable.
	args *parsedArgs
}

func main() {
	err := func() (err error) {
		opts := spawnOptions{
			distro:  os.Getenv("RD_WSL_DISTRO"),
			nerdctl: os.Getenv("RD_NERDCTL"),
		}
		if opts.distro == "" {
			opts.distro = "rancher-desktop"
		}
		if opts.nerdctl == "" {
			opts.nerdctl = "/usr/local/bin/nerdctl"
		}
		opts.containerdSocket = "/run/k3s/containerd/containerd.sock"

		args, err := parseArgs()
		if err == nil {
			opts.args = args
		} else {
			// If we fail to parse, display an error but still run nerdctl
			log.Printf("Error parsing arguments: %s", err)
			opts.args = &parsedArgs{args: os.Args[1:]}
		}

		defer func() {
			err = cleanupParseArgs()
			// The top-level function handles the error
		}()

		err = spawn(context.Background(), opts)
		if err != nil {
			return err
		}
		return nil
	}()
	if err != nil {
		log.Fatal(err)
	}
}
