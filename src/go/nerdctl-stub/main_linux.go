package main

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"slices"
	"strings"

	"golang.org/x/sys/unix"
)

const (
	// mountPointField is the zero-indexed field number inf /proc/self/mountinfo
	// that contains the mount point.
	mountPointField = 4
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

// Get the WSL mount point; typically, this is /mnt/wsl.
func getWSLMountPoint() (string, error) {
	buf, err := os.ReadFile("/proc/self/mountinfo")
	if err != nil {
		return "", fmt.Errorf("error reading mounts: %w", err)
	}
	for _, line := range strings.Split(string(buf), "\n") {
		if !strings.Contains(line, " - tmpfs ") {
			// Skip the line if the filesystem type isn't "tmpfs"
			continue
		}
		fields := strings.Split(line, " ")
		if len(fields) > mountPointField {
			return fields[mountPointField], nil
		}
	}
	return "", fmt.Errorf("could not find WSL mount root")
}

// function prepareParseArgs should be called before argument parsing to set up
// the system for arg parsing.
func prepareParseArgs() error {
	if os.Geteuid() != 0 {
		return fmt.Errorf("got unexpected euid %v", os.Geteuid())
	}
	mountPoint, err := getWSLMountPoint()
	if err != nil {
		return err
	}
	rundir := path.Join(mountPoint, "rancher-desktop/run/")
	err = os.MkdirAll(rundir, 0o755)
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
		if err != nil && !errors.Is(err, unix.EINVAL) {
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

// doBindMount does the meat of the bind mounting.  Given a path, it makes a
// mount inside workdir and returns the mounted path.
func doBindMount(sourcePath string) (string, error) {
	info, err := os.Stat(sourcePath)
	if err != nil {
		return "", fmt.Errorf("could not stat %s: %w", sourcePath, err)
	}
	var result string
	if info.IsDir() {
		result, err = os.MkdirTemp(workdir, "input.*")
		if err != nil {
			return "", err
		}
	} else {
		resultFile, err := os.CreateTemp(workdir, "input.*")
		if err != nil {
			return "", err
		}
		resultFile.Close()
		result = resultFile.Name()
	}
	err = unix.Mount(sourcePath, result, "none", unix.MS_BIND|unix.MS_REC, "")
	if err != nil {
		return "", err
	}
	return result, nil
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

	mountDir, err := doBindMount(hostPath)
	if err != nil {
		return "", nil, err
	}
	return mountDir + ":" + containerPath + readWrite, nil, nil
}

// mountArgHandler handles the argument for `nerdctl run --mount=...`
func mountArgHandler(arg string) (string, []cleanupFunc, error) {
	return mountArgProcessor(arg, doBindMount)
}

// filePathArgHandler handles arguments that take a file path for input
func filePathArgHandler(arg string) (string, []cleanupFunc, error) {
	result, err := doBindMount(arg)
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

	var cleanups []cleanupFunc
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
			mount, newCleanups, err := filePathArgHandler(v)
			if err != nil {
				_ = runCleanups(cleanups)
				return "", nil, err
			}
			v = mount
			cleanups = append(cleanups, newCleanups...)
		}
		resultParts = append(resultParts, fmt.Sprintf("%s=%s", k, v))
	}
	var result bytes.Buffer
	writer := csv.NewWriter(&result)
	if err := writer.Write(resultParts); err != nil {
		_ = runCleanups(cleanups)
		return "", nil, err
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return "", nil, err
	}
	return strings.TrimSpace(result.String()), cleanups, nil
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
