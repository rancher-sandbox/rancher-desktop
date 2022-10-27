package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func spawn(opts spawnOptions) error {
	args := []string{"--distribution", opts.distro, "--exec", opts.nerdctl, "--address", opts.containerdSocket}
	args = append(args, opts.args.args...)
	cmd := exec.Command("wsl.exe", args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	err := cmd.Run()
	for _, handler := range opts.args.cleanup {
		cleanupErr := handler()
		if cleanupErr != nil {
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

// function prepareParseArgs should be called before argument parsing to set up
// the system for arg parsing.
func prepareParseArgs() error {
	// Nothing is required on Windows.
	return nil
}

// function cleanupParseArgs should be called after the command finishes
// (regardless of whether it succeeded) to clean up any resources.
func cleanupParseArgs() error {
	// Nothing is required on Windows.
	return nil
}

// pathToWSL converts a Windows path to one that can be used in WSL.
func pathToWSL(arg string) (string, error) {
	// absPath is something like C:\Foo\Bar\Baz
	absPath, err := filepath.Abs(filepath.FromSlash(arg))
	if err != nil {
		return "", err
	}
	slashPath := filepath.ToSlash(absPath)
	vol := filepath.VolumeName(absPath)
	if len(vol) > 0 && vol[len(vol)-1] == ':' {
		volName := strings.ToLower(vol[:len(vol)-1])
		return "/mnt/" + volName + slashPath[len(vol):], nil
	}
	// volume name is not what we expected
	return slashPath, nil
}

// volumeArgHandler handles the argument for `nerdctl run --volume=...`
func volumeArgHandler(arg string) (string, []cleanupFunc, error) {
	// Valid arguments are:
	// <host path>:<container path>
	// <host path>:<container path>:rw
	// <host path>:<container path>:ro
	// Because we only have Linux containers, and this is for Windows, we don't
	// need to worry about just `<path>` (where the host and container have the
	// same path).
	cleanArg := arg
	readWrite := ""
	if strings.HasSuffix(arg, ":ro") || strings.HasSuffix(arg, ":rw") {
		readWrite = arg[len(arg)-3:]
		cleanArg = arg[:len(arg)-3]
	}
	// For now, assume the container path doesn't contain colons.
	colonIndex := strings.LastIndex(cleanArg, ":")
	if colonIndex < 0 {
		return "", nil, fmt.Errorf("Invalid volume mount: %s does not contain : separator", arg)
	}
	hostPath := cleanArg[:colonIndex]
	containerPath := cleanArg[colonIndex+1:]
	wslHostPath, err := pathToWSL(hostPath)
	if err != nil {
		return "", nil, fmt.Errorf("Could not get volume host path for %s: %w", arg, err)
	}
	return wslHostPath + ":" + containerPath + readWrite, nil, nil
}

// mountArgHandler handles the argument for `nerdctl run --mount=...`
func mountArgHandler(arg string) (string, []cleanupFunc, error) {
	var chunks [][]string
	isBind := false
	for _, chunk := range strings.Split(arg, ",") {
		parts := strings.SplitN(chunk, "=", 2)
		if len(parts) != 2 {
			// Got something with no value, e.g. --mount=...,readonly,...
			chunks = append(chunks, []string{chunk})
			continue
		}
		if parts[0] == "type" && parts[1] == "bind" {
			isBind = true
		}
		chunks = append(chunks, parts)
	}
	if !isBind {
		// Not a bind mount; don't attempt to fix anything
		return arg, nil, nil
	}
	for _, chunk := range chunks {
		if len(chunk) != 2 {
			continue
		}
		if chunk[0] != "source" && chunk[0] != "src" {
			continue
		}
		fixedPath, err := pathToWSL(chunk[1])
		if err != nil {
			return arg, nil, fmt.Errorf("could not parse %s: %w", arg, err)
		}
		chunk[1] = fixedPath
	}
	result := ""
	for _, chunk := range chunks {
		result = fmt.Sprintf("%s,%s", result, strings.Join(chunk, "="))
	}
	return result[1:], nil, nil // Skip the initial "," we added
}

// filePathArgHandler handles arguments that take a file path for input
func filePathArgHandler(arg string) (string, []cleanupFunc, error) {
	result, err := pathToWSL(arg)
	if err != nil {
		return "", nil, err
	}
	return result, nil, nil
}

// outputPathArgHandler handles arguments that take a file path to indicate
// where some file should be output.
func outputPathArgHandler(arg string) (string, []cleanupFunc, error) {
	result, err := pathToWSL(arg)
	if err != nil {
		return "", nil, err
	}
	return result, nil, nil
}
