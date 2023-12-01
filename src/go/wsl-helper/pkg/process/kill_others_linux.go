package process

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path"
	"strconv"
	"syscall"

	"github.com/sirupsen/logrus"
)

// KillOthers will kill any other processes with the executable.
func KillOthers(args ...string) error {
	selfPid := fmt.Sprintf("%d", os.Getpid())
	selfFile, err := os.Readlink("/proc/self/exe")
	if err != nil {
		logrus.WithError(err).Error("could not read /proc/self/exe")
		return err
	}
	// We compare the arguments against /proc/*/cmdline, which contains a null-
	// separated list of arguments.  Convert it a byte array here so we can do
	// a bytes.Compare later.
	var argsBytes []byte
	for _, arg := range args {
		argsBytes = append(argsBytes, []byte(arg)...)
		argsBytes = append(argsBytes, byte(0))
	}
	var pids []int
	// Read /proc, ignoring errors - any entries we _could_ read are returned.
	procs, _ := os.ReadDir("/proc")
	for _, proc := range procs {
		if !proc.IsDir() || proc.Name() == selfPid || proc.Name() == "self" {
			continue
		}
		procFile, err := os.Readlink(path.Join("/proc", proc.Name(), "exe"))
		if err != nil {
			// pid died, or we don't have permissions, or it's not a pid.
			if !errors.Is(err, os.ErrNotExist) {
				logrus.WithError(err).WithField("pid", proc.Name()).Debug("could not read exe")
			}
			continue
		}
		if selfFile != procFile {
			logrus.WithFields(logrus.Fields{
				"pid":                 proc.Name(),
				"expected executable": selfFile,
				"executable":          procFile,
			}).Trace("pid has different executable")
			continue
		}
		procCmd, err := os.ReadFile(path.Join("/proc", proc.Name(), "cmdline"))
		if err != nil {
			// pid died, or we don't have permissions, or it's not a pid.
			logrus.WithError(err).WithField("pid", proc.Name()).Debug("could not read command line")
			continue
		}
		procArgs := bytes.SplitN(procCmd, []byte{0}, 2)
		if len(procArgs) < 2 {
			logrus.WithField("pid", proc.Name()).Trace("pid has no args")
			continue
		} else if !bytes.HasPrefix(procArgs[1], argsBytes) {
			// pid args are not the expected args
			logrus.WithFields(logrus.Fields{
				"pid":           proc.Name(),
				"expected args": string(argsBytes),
				"actual args":   string(procArgs[1]),
			}).Trace("pid has incorrect arguments")
			continue
		}
		pid, err := strconv.Atoi(proc.Name())
		if err == nil {
			pids = append(pids, pid)
		}
	}
	for _, pid := range pids {
		logrus.WithField("pid", pid).Debug("Attempting to kill pid")
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
