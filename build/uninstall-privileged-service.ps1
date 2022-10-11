# .SYNOPSIS
# PowerShell script to uninstall Rancher Desktop Privileged Service

# .SYNOPSIS
# Uninstalls Rancher Desktop Privileged Service
function Uninstall-PrivilegedService {
  $ServiceExec = 'privileged-service.exe'
  $ExecPath = (Join-Path "${PSScriptRoot}" ${ServiceExec})
  Start-Process -FilePath ${ExecPath} -Verb RunAs -Wait -PassThru -ArgumentList "uninstall"
  exit $LASTEXITCODE
}


Uninstall-PrivilegedService
