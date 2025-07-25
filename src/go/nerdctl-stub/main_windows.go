package main

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
)

func spawn(ctx context.Context, opts spawnOptions) error {
	args := []string{"--distribution", opts.distro, "--exec", "/usr/local/bin/wsl-exec", opts.nerdctl, "--address", opts.containerdSocket}
	args = append(args, opts.args.args...)
	cmd := exec.CommandContext(ctx, "wsl.exe", args...)
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
	if vol != "" && vol[len(vol)-1] == ':' {
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
		return "", nil, fmt.Errorf("invalid volume mount: %s does not contain : separator", arg)
	}
	hostPath := cleanArg[:colonIndex]
	containerPath := cleanArg[colonIndex+1:]
	wslHostPath, err := pathToWSL(hostPath)
	if err != nil {
		return "", nil, fmt.Errorf("could not get volume host path for %s: %w", arg, err)
	}
	return wslHostPath + ":" + containerPath + readWrite, nil, nil
}

// mountArgHandler handles the argument for `nerdctl run --mount=...`
func mountArgHandler(arg string) (string, []cleanupFunc, error) {
	return mountArgProcessor(arg, pathToWSL)
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

// builderCacheArgHandler handles arguments for
// `nerdctl builder build --cache-from=` and `nerdctl builder build --cache-to=`
func builderCacheArgHandler(arg string) (string, []cleanupFunc, error) {
	return builderCacheProcessor(arg, filePathArgHandler, outputPathArgHandler)
}

// buildContextArgHandler handles arguments for
// `nerdctl builder build --build-context=`.
func buildContextArgHandler(arg string) (string, []cleanupFunc, error) {
	// The arg must be parsed as CSV (!?), and then split on `=` for key-value
	// pairs; for each value, it is either a URN with a prefix of one of
	// `urnPrefixes`, or it's a filesystem path.

	urnPrefixes := []string{"https://", "http://", "docker-image://", "target:", "oci-layout://"}
	parts, err := csv.NewReader(strings.NewReader(arg)).Read()
	if err != nil {
		return "", nil, err
	}
	var resultParts []string
	for _, part := range parts {
		kv := strings.SplitN(part, "=", 2)
		if len(kv) != 2 {
			return "", nil, fmt.Errorf("failed to parse context value %q (expected key=value)", part)
		}
		k, v := kv[0], kv[1]
		matchesPrefix := func(prefix string) bool {
			return strings.HasPrefix(v, prefix)
		}
		if !slices.ContainsFunc(urnPrefixes, matchesPrefix) {
			v, err = pathToWSL(v)
			if err != nil {
				return "", nil, err
			}
		}
		resultParts = append(resultParts, fmt.Sprintf("%s=%s", k, v))
	}
	var result bytes.Buffer
	writer := csv.NewWriter(&result)
	if err := writer.Write(resultParts); err != nil {
		return "", nil, err
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return "", nil, err
	}
	return strings.TrimSpace(result.String()), nil, nil
}

// argHandlers is the table of argument handlers.
var argHandlers = argHandlersType{
	volumeArgHandler:       volumeArgHandler,
	filePathArgHandler:     filePathArgHandler,
	outputPathArgHandler:   outputPathArgHandler,
	mountArgHandler:        mountArgHandler,
	builderCacheArgHandler: builderCacheArgHandler,
	buildContextArgHandler: buildContextArgHandler,
}
