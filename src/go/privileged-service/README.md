# Privileged Service

Rancher Desktop Privileged Service is a helper process that performs actions
requiring extended privileges on behalf of Rancher Desktop.

## Build

Rancher Desktop Privileged Service is currently only available on Windows. You can
build using the following:

On Linux or MacOs:

```bash
GOOS=windows go build .
```

On Windows

```bash
go build .
```

## Run

To run the Rancher Desktop Privileged Service you can use the following available commands.

```pwsh
.\privileged-service.exe install | start | stop | uninstall
```