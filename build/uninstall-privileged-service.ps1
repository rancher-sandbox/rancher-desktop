# .SYNOPSIS
# PowerShell script to uninstall Rancher Desktop Privileged Service

param($ServiceExecutable)

# .SYNOPSIS
# Uninstalls Rancher Desktop Privileged Service
function Uninstall-PrivilegedService {
  Param([String] $ServiceExecutable)
  Write-Output "Uninstalling Rancher Desktop Privileged Service"
  $Process = (Start-Process -FilePath "${ServiceExecutable}" -Verb RunAs -Wait -PassThru -ArgumentList "uninstall")
  exit $Process.ExitCode
}

Uninstall-PrivilegedService (Join-Path $ServiceExecutable 'resources\win32\internal\privileged-service.exe')
