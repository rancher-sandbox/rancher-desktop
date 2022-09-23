# .SYNOPSIS
# PowerShell script to uninstall Rancher Desktop Privileged Service

param($InstallDir)

# .SYNOPSIS
# Uninstalls Rancher Desktop Privileged Service
function Uninstall-PrivilegedService {
  Param([String] $LiteralPath)
  $ExecPath = (Join-Path "${LiteralPath}" 'resources\resources\win32\internal\privileged-service.exe')
  Start-Process -FilePath ${ExecPath} -Verb RunAs -Wait -PassThru -ArgumentList "uninstall"
  exit $LASTEXITCODE
}


Uninstall-PrivilegedService ${InstallDir}
