# .SYNOPSIS
# PowerShell script to uninstall Rancher Desktop Privileged Service

param($InstallDir)

# .SYNOPSIS
# Uninstalls Rancher Desktop Privileged Service
function Uninstall-PrivilegedService {
  Param([String] $InstallDir)
  Write-Output "Uninstalling Rancher Desktop Privileged Service"
  $InstallCommand = "`"${InstallDir}`" uninstall"
  Invoke-Expression -Command $InstallCommand
  exit $LASTEXITCODE
}

Uninstall-PrivilegedService (Join-Path $InstallDir 'resources\win32\internal\privileged-service.exe')
