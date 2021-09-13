# This script is executed on Windows to regenerate the nerdctl stub argument
# parsers.  This must be executed on Windows as we need a stable platform to be
# able to find nerdctl.

$ENV:GOOS = "linux"

Set-Location src/go/nerdctl-stub/generate
go build .
wsl.exe -d rancher-desktop --exec ./generate
Remove-Item ./generate
gofmt -w ../nerdctl_commands_generated.go
