# PowerShell script to ensure that WSL2 is installed on the machine.
# This script returns 0 if it did nothing, or 100 if a restart is needed.

# Magic PowerShell comment to require admin; see
# https://docs.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_requires?view=powershell-5.1#-runasadministrator
#Requires -RunAsAdministrator

param([ValidateSet("Initial", "Kernel")] $Stage = "Initial")

$Global:NeedsRestart = $false

function Install-Features {
  # Install Windows features as needed.
  $features = @('Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform')
  foreach ($feature in $features) {
    if (Get-WindowsOptionalFeature -Online -FeatureName:$feature | Where-Object State -ne Enabled) {
      Write-Output "Installing Windows feature $feature"
      Enable-WindowsOptionalFeature -FeatureName:$feature -Online -NoRestart
      $Global:NeedsRestart = $true
    }
  }
}

function Set-RunPowerShellOnce {
  Param([String] $Command)

  Write-Verbose "Setting RunOnce to run PowerShell with ${Command}"
  Set-ItemProperty `
    -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce' `
    -Name 'Rancher Desktop Install' `
    -Value "`"$PSHOME\powershell.exe`" -NoProfile -ExecutionPolicy RemoteSigned -WindowStyle Hidden $Command"
}

function Install-Kernel {
  param([switch]$CanReboot)

  # Install the updated WSL kernel, if not already installed.
  $installed = Get-WmiObject Win32_Product -Filter 'IdentifyingNumber = "{8D646799-DB00-4000-AE7A-756A05A4F1D8}"'
  if ($installed) {
    $oldVersion = [System.Version]::Parse($installed.Version)
    # The .net version comparator only does major/minor
    Write-Output "Found existing WSL kernel $oldVersion"
    if ($oldVersion -ge '5.4') {
      # The old kernel is new enough, we don't need to do anything
      return
    }
  }

  if ($Global:NeedsRestart) {
    # A restart is already scheduled (i.e. we need to install the Windows features); re-run the script on restart.
    Write-Output "Will install Linux kernel after reboot."
    $script = Join-Path ([System.IO.Path]::GetTempPath()) 'rancher-desktop-install.ps1'
    Copy-Item $PSCommandPath $script
    Set-RunPowerShellOnce "-File `"$script`" -Stage:Kernel"
    return
  }

  $tempFile = Join-Path ([System.IO.Path]::GetTempPath()) 'wsl-update.msi'
  try {
    $url = 'https://wslstorestorage.blob.core.windows.net/wslblob/wsl_update_x64.msi'
    Write-Output "Downloading Linux Kernel"
    Invoke-WebRequest -UseBasicParsing $url -OutFile $tempFile
    Write-Output "Installing new WSL kernel"
    $msiArgs = @('/passive', '/package', $tempFile)
    if ($CanReboot) {
      $msiArgs = @('/forcerestart') + $msiArgs
    }
    Start-Process -Wait 'msiexec.exe' -ArgumentList $msiArgs
    if (!$CanReboot) {
      $Global:NeedsRestart = $true
    }
  }
  finally {
    Remove-Item $tempFile
  }
}

switch ($Stage) {
  "Initial" {
    Install-Features
    Install-Kernel
    if ($Global:NeedsRestart) {
      Write-Output "A Windows restart is required."
      exit 101
    }
  }
  "Kernel" {
    # Because we're doing this on restart, we need to clean up the script
    Set-RunPowerShellOnce "-Command `"& { Remove-Item -LiteralPath '$PSCommandPath' }`""
    Install-Kernel -CanReboot
  }
}
