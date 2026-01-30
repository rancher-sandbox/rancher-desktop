package config

import (
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
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

func saveWSLEnvs(t *testing.T) {
	originalEnvs := map[string]string{}
	originalPresent := map[string]bool{}
	for _, envName := range wslDistroEnvs {
		if value, ok := os.LookupEnv(envName); ok {
			originalEnvs[envName] = value
			originalPresent[envName] = true
		} else {
			originalPresent[envName] = false
		}
	}
	t.Cleanup(func() {
		for _, envName := range wslDistroEnvs {
			if originalPresent[envName] {
				os.Setenv(envName, originalEnvs[envName])
			} else {
				os.Unsetenv(envName)
			}
		}
	})
}

func TestIsWSLDistro(t *testing.T) {
	for _, symlinkMode := range []os.FileMode{os.ModeSymlink, 0} {
		symlinkText := map[os.FileMode]string{
			os.ModeSymlink: "with wslpath symlink",
			0:              "without wslpath symlink",
		}[symlinkMode]
		for _, hasEnvs := range []bool{true, false} {
			envText := map[bool]string{
				true:  "with WSL envs",
				false: "without WSL envs",
			}[hasEnvs]
			expected := symlinkMode != 0 && hasEnvs
			testName := fmt.Sprintf("returns %t %s %s", expected, symlinkText, envText)
			t.Run(testName, func(t *testing.T) {
				saveWSLEnvs(t)
				for _, envName := range wslDistroEnvs {
					os.Unsetenv(envName)
				}
				originalLstat := lstatFunc
				t.Cleanup(func() { lstatFunc = originalLstat })
				lstatFunc = func(_ string) (os.FileInfo, error) {
					return fakeFileInfo{mode: symlinkMode}, nil
				}
				if hasEnvs {
					os.Setenv(wslDistroEnvs[0], "Ubuntu")
				}
				if expected {
					assert.True(t, isWSLDistro(), "expected isWSLDistro to be true")
				} else {
					assert.False(t, isWSLDistro(), "expected isWSLDistro to be false")
				}
			})
		}
	}
}

func TestHasWSLEnvs(t *testing.T) {
	t.Run("returns false when none set", func(t *testing.T) {
		saveWSLEnvs(t)
		for _, envName := range wslDistroEnvs {
			os.Unsetenv(envName)
		}
		assert.False(t, hasWSLEnvs(), "expected hasWSLEnvs to be false without WSL envs")
	})

	t.Run("returns true when any set", func(t *testing.T) {
		saveWSLEnvs(t)
		for _, envName := range wslDistroEnvs {
			os.Unsetenv(envName)
		}
		os.Setenv(wslDistroEnvs[0], "Ubuntu")
		assert.True(t, hasWSLEnvs(), "expected hasWSLEnvs to be true with WSL envs")
	})
}

func TestIsWSLDistroLstatError(t *testing.T) {
	saveWSLEnvs(t)
	originalLstat := lstatFunc
	t.Cleanup(func() { lstatFunc = originalLstat })
	lstatFunc = func(_ string) (os.FileInfo, error) {
		return nil, errors.New("lstat failed")
	}
	os.Setenv(wslDistroEnvs[0], "Ubuntu")
	assert.False(t, isWSLDistro(), "expected isWSLDistro to be false when lstat fails")
}
