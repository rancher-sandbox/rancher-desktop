package cmd

import (
	"os"
	"os/exec"
	"strings"

	"github.com/sirupsen/logrus"
)

func launchApp(applicationPath string, commandLineArgs []string) error {
	commandName := "/usr/bin/open"
	args := []string{"-a", applicationPath}
	if len(commandLineArgs) > 0 {
		args = append(args, "--args")
		args = append(args, commandLineArgs...)
	}
	// Include this output because there's a delay before the UI comes up.
	// Without this line, it might look like the command doesn't work.
	logrus.Infof("About to launch %s %s ...\n", commandName, strings.Join(args, " "))
	cmd := exec.Command(commandName, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Start()
}
