package factoryreset

import (
	"errors"
	"os"

	"github.com/rancher-sandbox/rancher-desktop/src/go/privileged-service/pkg/manage"
	"github.com/sirupsen/logrus"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
)

const svcName = "RancherDesktopPrivilegedService"

// stopPrivilegedService will stop the Rancher Desktop privileged service if it
// is running.
func stopPrivilegedService() error {
	err := manage.ControlService(svcName, svc.Stop, svc.Stopped)
	if err == nil {
		logrus.Tracef("successfully stopped %s", svcName)
		return nil
	}
	if errors.Is(err, windows.ERROR_ACCESS_DENIED) {
		logrus.Tracef("ignoring failure to stop %s: %s", svcName, err)
		return nil
	}
	if errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
		logrus.Tracef("ignoring failure to stop %s: %s", svcName, err)
		return nil
	}
	if errors.Is(err, os.ErrDeadlineExceeded) {
		logrus.Tracef("ignoring failure to stop %s: %s", svcName, err)
		return nil
	}
	return err
}
