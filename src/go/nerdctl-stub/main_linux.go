package main

import (
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"golang.org/x/sys/unix"
)

func spawn(opts spawnOptions) error {
	args := []string{"--distribution", opts.distro, "--exec", opts.nerdctl, "--address", opts.containerdSocket}
	args = append(args, opts.args.args...)
	cmd := exec.Command("wsl.exe", args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	err := cmd.Run()
	for _, cleanup := range opts.args.cleanup {
		if cleanupErr := cleanup(); cleanupErr != nil {
			log.Printf("Error cleaning up: %s", cleanupErr)
		}
	}
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

var workdir string

// function prepareParseArgs should be called before argument parsing to set up
// the system for arg parsing.
func prepareParseArgs() error {
	if os.Geteuid() != 0 {
		return fmt.Errorf("Got unexpected euid %v", os.Geteuid())
	}
	rundir := "/mnt/wsl/rancher-desktop/run/"
	err := os.MkdirAll(rundir, 0755)
	if err != nil {
		return err
	}
	d, err := os.MkdirTemp(rundir, "nerdctl-tmp.*")
	if err != nil {
		return err
	}
	workdir = d
	return nil
}

// function cleanupParseArgs should be called after the command finishes
// (regardless of whether it succeeded) to clean up any resources.
func cleanupParseArgs() error {
	if workdir == "" {
		return nil
	}
	entries, err := os.ReadDir(workdir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	for _, entry := range entries {
		entryPath := filepath.Join(workdir, entry.Name())
		err = unix.Unmount(entryPath, 0)
		if err != nil {
			log.Printf("Error unmounting %s: %s", entryPath, err)
		}
		err = os.Remove(entryPath)
		if err != nil {
			log.Printf("Error removing mount directory %s: %s", entryPath, err)
		}
	}
	err = os.Remove(workdir)
	if err != nil {
		return err
	}
	return nil
}

// volumeArgHandler handles the argument for `nerdctl run --volume=...`
func volumeArgHandler(arg string) (string, []cleanupFunc, error) {
	// args is of format [host:]container[:ro|:rw]
	readWrite := ""
	if strings.HasSuffix(arg, ":rw") || strings.HasSuffix(arg, ":ro") {
		readWrite = arg[len(arg)-3:]
		arg = arg[:len(arg)-3]
	}
	colonIndex := strings.Index(arg, ":")
	hostPath := ""
	containerPath := ""
	if colonIndex < 0 {
		// No colon, host and container path is the same.
		hostPath = arg
		containerPath = arg
	} else {
		hostPath = arg[:colonIndex]
		containerPath = arg[colonIndex+1:]
	}

	mountDir, err := os.MkdirTemp(workdir, "mount.*")
	if err != nil {
		return "", nil, err
	}
	err = unix.Mount(hostPath, mountDir, "none", unix.MS_BIND|unix.MS_REC, "")
	if err != nil {
		return "", nil, err
	}
	return mountDir + ":" + containerPath + readWrite, nil, nil
}

// filePathArgHandler handles arguments that take a file path for input
func filePathArgHandler(arg string) (string, []cleanupFunc, error) {
	result, err := os.MkdirTemp(workdir, "input.*")
	if err != nil {
		return "", nil, err
	}
	err = unix.Mount(arg, result, "none", unix.MS_BIND|unix.MS_REC, "")
	if err != nil {
		return "", nil, err
	}
	return result, nil, nil
}

// outputPathArgHandler handles arguments that take a file path to indicate
// where some file should be output.
func outputPathArgHandler(arg string) (string, []cleanupFunc, error) {
	file, err := os.CreateTemp(workdir, "output.*")
	if err != nil {
		return "", nil, err
	}
	err = file.Close()
	if err != nil {
		return "", nil, err
	}
	// Some arguments error out if the file exists already.
	err = os.Remove(file.Name())
	if err != nil {
		return "", nil, err
	}
	callback := func() error {
		defer os.Remove(file.Name())
		input, err := os.Open(file.Name())
		if err != nil {
			return err
		}
		defer input.Close()
		output, err := os.Create(arg)
		if err != nil {
			return err
		}
		defer output.Close()
		_, err = io.Copy(output, input)
		if err != nil {
			return err
		}
		// Since the executable is setuid, we need to make sure the normal
		// user owns the output file.
		err = os.Chown(arg, os.Getuid(), os.Getgid())
		if err != nil {
			return err
		}
		return nil
	}
	return file.Name(), []cleanupFunc{callback}, nil
}
