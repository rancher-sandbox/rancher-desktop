package config

import (
	"errors"
	"os"
	"testing"
	"time"
)

type fakeFileInfo struct {
	mode os.FileMode
}

func (info fakeFileInfo) Name() string       { return "wslpath" }
func (info fakeFileInfo) Size() int64        { return 0 }
func (info fakeFileInfo) Mode() os.FileMode  { return info.mode }
func (info fakeFileInfo) ModTime() time.Time { return time.Time{} }
func (info fakeFileInfo) IsDir() bool        { return info.mode.IsDir() }
func (info fakeFileInfo) Sys() any           { return nil }

func TestIsWSLDistro(t *testing.T) {
	originalEnvs := map[string]string{}
	for _, envName := range wslDistroEnvs {
		originalEnvs[envName] = os.Getenv(envName)
	}
	t.Cleanup(func() {
		for envName, value := range originalEnvs {
			if value == "" {
				os.Unsetenv(envName)
			} else {
				os.Setenv(envName, value)
			}
		}
	})

	t.Run("returns false without WSL envs", func(t *testing.T) {
		for _, envName := range wslDistroEnvs {
			os.Unsetenv(envName)
		}
		t.Cleanup(func() {
			for envName, value := range originalEnvs {
				if value == "" {
					os.Unsetenv(envName)
				} else {
					os.Setenv(envName, value)
				}
			}
		})
		originalLstat := lstatFunc
		t.Cleanup(func() { lstatFunc = originalLstat })
		lstatFunc = func(_ string) (os.FileInfo, error) {
			return fakeFileInfo{mode: os.ModeSymlink}, nil
		}
		if isWSLDistro() {
			t.Fatalf("expected isWSLDistro to be false without WSL envs")
		}
	})

	t.Run("returns true with wslpath symlink and WSL envs", func(t *testing.T) {
		os.Setenv(wslDistroEnvs[0], "Ubuntu")
		t.Cleanup(func() {
			for envName, value := range originalEnvs {
				if value == "" {
					os.Unsetenv(envName)
				} else {
					os.Setenv(envName, value)
				}
			}
		})
		originalLstat := lstatFunc
		t.Cleanup(func() { lstatFunc = originalLstat })
		lstatFunc = func(_ string) (os.FileInfo, error) {
			return fakeFileInfo{mode: os.ModeSymlink}, nil
		}
		if !isWSLDistro() {
			t.Fatalf("expected isWSLDistro to be true with WSL envs and wslpath symlink")
		}
	})

	t.Run("returns false when wslpath is not a symlink", func(t *testing.T) {
		os.Setenv(wslDistroEnvs[0], "Ubuntu")
		t.Cleanup(func() {
			for envName, value := range originalEnvs {
				if value == "" {
					os.Unsetenv(envName)
				} else {
					os.Setenv(envName, value)
				}
			}
		})
		originalLstat := lstatFunc
		t.Cleanup(func() { lstatFunc = originalLstat })
		lstatFunc = func(_ string) (os.FileInfo, error) {
			return fakeFileInfo{mode: 0}, nil
		}
		if isWSLDistro() {
			t.Fatalf("expected isWSLDistro to be false without wslpath symlink")
		}
	})

	t.Run("returns false on lstat error", func(t *testing.T) {
		os.Setenv(wslDistroEnvs[0], "Ubuntu")
		t.Cleanup(func() {
			for envName, value := range originalEnvs {
				if value == "" {
					os.Unsetenv(envName)
				} else {
					os.Setenv(envName, value)
				}
			}
		})
		originalLstat := lstatFunc
		t.Cleanup(func() { lstatFunc = originalLstat })
		lstatFunc = func(_ string) (os.FileInfo, error) {
			return nil, errors.New("lstat failed")
		}
		if isWSLDistro() {
			t.Fatalf("expected isWSLDistro to be false when lstat fails")
		}
	})
}

func TestHasWSLEnvs(t *testing.T) {
	originalEnvs := map[string]string{}
	for _, envName := range wslDistroEnvs {
		originalEnvs[envName] = os.Getenv(envName)
	}
	t.Cleanup(func() {
		for envName, value := range originalEnvs {
			if value == "" {
				os.Unsetenv(envName)
			} else {
				os.Setenv(envName, value)
			}
		}
	})

	t.Run("returns false when none set", func(t *testing.T) {
		for _, envName := range wslDistroEnvs {
			os.Unsetenv(envName)
		}
		if hasWSLEnvs() {
			t.Fatalf("expected hasWSLEnvs to be false without WSL envs")
		}
	})

	t.Run("returns true when any set", func(t *testing.T) {
		for _, envName := range wslDistroEnvs {
			os.Unsetenv(envName)
		}
		os.Setenv(wslDistroEnvs[0], "Ubuntu")
		if !hasWSLEnvs() {
			t.Fatalf("expected hasWSLEnvs to be true with WSL envs")
		}
	})
}
