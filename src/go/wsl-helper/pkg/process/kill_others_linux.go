package process

import (
	"bytes"
	"fmt"
	"io/ioutil"
	"os"
	"path"
	"strconv"
	"syscall"

	"github.com/sirupsen/logrus"
)

// KillOthers will kill any other processes with the same command line.
func KillOthers() error {
	selfPid := fmt.Sprintf("%d", os.Getpid())
	selfCmd, err := ioutil.ReadFile("/proc/self/cmdline")
	if err != nil {
		logrus.WithError(err).Error("could not read /proc/self/cmdline")
		return err
	}
	var pids []int
	// Read /proc, ignoring errors - any entries we _could_ read are returned.
	procs, _ := os.ReadDir("/proc")
	for _, proc := range procs {
		if !proc.IsDir() || proc.Name() == selfPid || proc.Name() == "self" {
			continue
		}
		procCmd, err := ioutil.ReadFile(path.Join("/proc", proc.Name(), "cmdline"))
		if err != nil {
			// pid died, or we don't have permissions, or it's not a pid.
			logrus.WithError(err).WithField("pid", proc.Name()).Debug("could not read cmdline")
			continue
		}
		if bytes.Compare(selfCmd, procCmd) == 0 {
			// A different pid has the same command line; kill it.
			pid, err := strconv.Atoi(proc.Name())
			if err == nil {
				pids = append(pids, pid)
			}
		}
	}
	for _, pid := range pids {
		proc, err := os.FindProcess(pid)
		if err == nil {
			err = proc.Signal(syscall.SIGTERM)
			if err != nil {
				logrus.WithError(err).WithField("pid", pid).Info("could not kill process; ignoring.")
			}
		}
	}
	return nil
}
