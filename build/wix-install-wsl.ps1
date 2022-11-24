# .SYNOPSIS
# Installs WSL as part of the WiX setup.
# .NOTES
# This installs the required Windows optional features, and (if necessary)
# schedules the WSL kernel to be installed.  It assumes that the MSI version of
# the WSL kernel has not been installed (since msiexec provides that check).
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

# Check if the Appx version of WSL has been installed.
if (Get-AppxPackage -Name MicrosoftCorporationII.WindowsSubsystemForLinux) {
  Write-Output "Found WSL installed from the Windows Store, skipping."
  exit
}

Install-Features
Install-Kernel
