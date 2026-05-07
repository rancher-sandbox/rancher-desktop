package main

import "strings"

const seccompProfile = "/etc/rancher-desktop/seccomp.json"

// injectSeccompOpt splices --security-opt seccomp=<profile> into parsed args
// for "run" and "create" subcommands (including "container run" / "container
// create") if no seccomp option is already present.  It is called on the args
// that the stub assembles and passes to Linux nerdctl, so global flags such as
// --namespace or --address may precede the subcommand.
func injectSeccompOpt(args []string) []string {
	pos := seccompInjectionPos(args)
	if pos < 0 {
		return args
	}
	for i, arg := range args {
		if arg == "--security-opt" && i+1 < len(args) && strings.HasPrefix(args[i+1], "seccomp=") {
			return args
		}
		if strings.HasPrefix(arg, "--security-opt=seccomp=") {
			return args
		}
	}
	out := make([]string, 0, len(args)+2)
	out = append(out, args[:pos]...)
	out = append(out, "--security-opt", "seccomp="+seccompProfile)
	out = append(out, args[pos:]...)
	return out
}

// seccompInjectionPos returns the index in args at which --security-opt should
// be inserted (i.e. one past the subcommand name), or -1 if this is not a
// command that needs a seccomp profile.
//
// It uses the root command's options map to skip global flag–value pairs
// without hardcoding flag names, so it stays correct as nerdctl adds globals.
func seccompInjectionPos(args []string) int {
	rootOpts := commands[""].options

	// Skip over global flags (and their values) to reach the subcommand.
	i := 0
	for i < len(args) && strings.HasPrefix(args[i], "-") {
		flag := args[i]
		if strings.Contains(flag, "=") {
			i++ // --flag=value: value is inline, no extra element
		} else if handler, ok := rootOpts[flag]; ok && handler != nil {
			i += 2 // flag takes a separate value argument
		} else {
			i++ // boolean flag
		}
	}

	if i >= len(args) {
		return -1
	}

	switch args[i] {
	case "run", "create":
		return i + 1
	case "container":
		// "container" has no options of its own; the next element is the subcommand.
		if i+1 < len(args) && (args[i+1] == "run" || args[i+1] == "create") {
			return i + 2
		}
	}
	return -1
}
