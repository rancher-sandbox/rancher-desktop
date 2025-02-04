package wslutils

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"

	"golang.org/x/sys/windows"
)

// WSLRunner is an interface to describe running wsl.exe
type WSLRunner interface {
	// WithStdout causes the command to emit stdout to the given writer, instead
	// of os.Stdout.
	WithStdout(io.Writer) WSLRunner
	// WithStdErr causes the command to emit stderr to the given writer, instead
	// of os.Stderr.
	WithStderr(io.Writer) WSLRunner
	// Run the command and return any errors.
	Run(ctx context.Context, args ...string) error
}

type wslRunnerImpl struct {
	stdout io.Writer
	stderr io.Writer
	runFn  func(context.Context, ...string) error
}

func NewWSLRunner() WSLRunner {
	result := &wslRunnerImpl{}
	result.runFn = result.run
	return result
}

func (r *wslRunnerImpl) WithStdout(w io.Writer) WSLRunner {
	r.stdout = w
	return r
}

func (r *wslRunnerImpl) WithStderr(w io.Writer) WSLRunner {
	r.stderr = w
	return r
}

func (r *wslRunnerImpl) Run(ctx context.Context, args ...string) error {
	return r.runFn(ctx, args...)
}

func (r *wslRunnerImpl) run(ctx context.Context, args ...string) error {
	systemDir, err := windows.GetSystemDirectory()
	if err != nil {
		return fmt.Errorf("failed to get system directory: %w", err)
	}
	wslPath := filepath.Join(systemDir, "wsl.exe")
	cmd := exec.CommandContext(ctx, wslPath, args...)
	cmd.Env = append(cmd.Env, os.Environ()...)
	cmd.Env = append(cmd.Env, "WSL_UTF8=1")
	cmd.Stdout = r.stdout
	cmd.Stderr = r.stderr
	cmd.SysProcAttr = &windows.SysProcAttr{HideWindow: true}
	err = cmd.Run()
	if err != nil {
		return err
	}

	return nil
}
