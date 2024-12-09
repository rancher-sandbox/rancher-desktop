package factoryreset

import (
	"context"

	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/autostart"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/process"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/wsl"
	"github.com/sirupsen/logrus"
)

func DeleteData(ctx context.Context, appPaths paths.Paths, removeKubernetesCache bool) error {
	if err := autostart.EnsureAutostart(ctx, false); err != nil {
		logrus.Errorf("Failed to remove autostart configuration: %s", err)
	}
	w := wsl.WSLImpl{}
	if err := w.UnregisterDistros(); err != nil {
		logrus.Errorf("could not unregister WSL: %s", err)
		return err
	}
	if err := process.TerminateProcessInDirectory(appPaths.ExtensionRoot, false); err != nil {
		logrus.Errorf("Failed to stop extension processes, ignoring: %s", err)
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
