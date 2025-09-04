package rdctl

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// Run rdctl and return its standard output.
func Rdctl(ctx context.Context, args ...string) (*bytes.Buffer, error) {
	exe, err := exec.LookPath("rdctl")
	if err != nil {
		relPath := "resources/linux/bin/rdctl"
		switch runtime.GOOS {
		case "darwin":
			relPath = "resources/darwin/bin/rdctl"
		case "windows":
			relPath = `resources\win32\bin\rdctl.exe`
		}
		dir, err := os.Getwd()
		if err != nil {
			return nil, fmt.Errorf("failed to get working directory: %w", err)
		}
		for dir != filepath.Dir(dir) {
			exe = filepath.Join(dir, relPath)
			if _, err := os.Stat(exe); err == nil {
				break
			}
			dir = filepath.Dir(dir)
		}
		if dir == filepath.Dir(dir) {
			return nil, fmt.Errorf("could not find rdctl")
		}
	}
	buf := &bytes.Buffer{}
	cmd := exec.CommandContext(ctx, exe, args...)
	cmd.Stdout = buf
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return nil, err
	}
	return buf, nil
}
