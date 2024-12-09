package process_test

import (
	"os"
	"testing"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/process"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFindPidOfProcess(t *testing.T) {
	exe, err := os.Executable()
	require.NoError(t, err)
	pid, err := process.FindPidOfProcess(exe)
	require.NoError(t, err)
	assert.Equal(t, os.Getpid(), pid)
}
