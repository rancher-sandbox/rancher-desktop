package cmd

import (
	"os"
	"os/exec"
	"strings"
	"syscall"

	"github.com/sirupsen/logrus"
)

func launchApp(applicationPath string, commandLineArgs []string) error {
	// Include this output because there's a delay before the UI comes up.
	// Without this line, it might look like the command doesn't work.
	logrus.Infof("About to launch %s %s ...\n", applicationPath, strings.Join(commandLineArgs, " "))
	cmd := exec.Command(applicationPath, commandLineArgs...)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		NoInheritHandles: true,
	}
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Start()
}
