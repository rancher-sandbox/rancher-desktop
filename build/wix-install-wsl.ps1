# .SYNOPSIS
# Installs WSL as part of the WiX setup.
# .NOTES
# This only installs the Windows optional features, and schedules the WSL kernel
# to be installed upon reboot.  It assumes that the kernel has not been
# previously installed (since msiexec provides that check).
# This script assumes that it's run elevated.

function Install-Features {
  # Install Windows features as needed.
  $features = @('Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform')
  foreach ($feature in $features) {
    Write-Output "Checking Windows feature $feature..."
    if ((Get-WindowsOptionalFeature -FeatureName $feature -Online).State -ne "Enabled") {
      Write-Output "Enabling Windows feature $feature..."
      Enable-WindowsOptionalFeature -All -FeatureName:$feature -Online -NoRestart
    }
  }
  Write-Output "Windows features installed."
}

function Install-Kernel {
  # Install WSL kernel on reboot.
  Write-Output "Will install Linux kernel after reboot."

  Set-ItemProperty `
    -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce' `
    -Name '!Rancher Desktop WSL Kernel Install' `
    -Value "`"$Env:SystemRoot\system32\wsl.exe`" --update"
}

Install-Features
Install-Kernel
