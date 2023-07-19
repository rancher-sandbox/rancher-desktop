package factoryreset

import (
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/autostart"
	"github.com/sirupsen/logrus"
)

func DeleteData(removeKubernetesCache bool) error {
	if err := autostart.EnsureAutostart(false); err != nil {
		logrus.Errorf("Failed to remove autostart configuration: %s", err)
	}
	if err := unregisterWSL(); err != nil {
		logrus.Errorf("could not unregister WSL: %s", err)
		return err
	}
	if err := deleteWindowsData(!removeKubernetesCache, "rancher-desktop"); err != nil {
		logrus.Errorf("could not delete data: %s", err)
		return err
	}
	if err := clearDockerContext(); err != nil {
		logrus.Errorf("could not clear docker context: %s", err)
		return err
	}
	logrus.Infoln("successfully cleared data.")
	return nil
}
