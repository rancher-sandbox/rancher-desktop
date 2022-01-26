# .SYNOPSIS
# Ensure that WSL is installed on the machine.
# .NOTES
# Exit codes:
# 0 - Nothing was done.
# 101 - A restart is needed.
# 102 - Dry run, but we need to make changes.

param(
  # Installation stage; either "Initial" (default) or "Kernel".
  [ValidateSet("Initial", "Kernel")] $Stage = "Initial",
  # If set, only check if we will need to install anything.
  [Switch] $DryRun
)

# Note that this script might (synchronously) re-execute itself if it requires
# elevation.

$Global:NeedsRestart = $false

# .SYNOPSIS
# Check if the script is currently elevated.
function Get-ElevationStatus {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]$identity
  $adminRole = [Security.Principal.WindowsBuiltInRole] 'Administrator'
  return $principal.IsInRole($adminRole)
}

# .SYNOPSIS
# Re-run the script if elevation is required.  Must pass in the script arguments.
function Restart-ScriptForElevation {
  if (Get-ElevationStatus) {
    Write-Output "Script is already elevated, no need to restart; continuing with installation..."
    return
  }
  $CommandLine = "-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File `"${PSCommandPath}`" $($args)"
  Write-Output "Restarting script with arguments ${CommandLine}"
  $Process = (Start-Process -FilePath "${PSHOME}\PowerShell.exe" -Verb RunAs -Wait -PassThru -ArgumentList $CommandLine)
  Exit $Process.ExitCode
}

function Install-Features {
  # Install Windows features as needed.
  $features = @('Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform')
  foreach ($feature in $features) {
    # Get-WindowsOptionalFeature requires elevation, but Get-CimInstance is fine...
    # https://docs.microsoft.com/en-us/windows/win32/cimwin32prov/win32-optionalfeature
    # InstallState == 1 means installed
    $installed = Get-CimInstance -ClassName Win32_OptionalFeature -Filter "NAME = `"$feature`"" | Where-Object InstallState -eq 1
    if (-Not $installed) {
      if ($DryRun) {
        Exit 102
      }
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
  # Note that we have to filter by name here, since IdentifyingNumber seems to
  # change across versions.
  $installed = Get-CimInstance -ClassName Win32_Product -Filter 'NAME = "Windows Subsystem for Linux Update"'
  if ($installed) {
    $oldVersion = [System.Version]::Parse($installed.Version)
    # The .net version comparator only does major/minor
    Write-Output "Found existing WSL kernel $oldVersion"
    if ($oldVersion -ge '5.4') {
      # The old kernel is new enough, we don't need to do anything
      return
    }
  }

  if ($DryRun) {
    Exit 102
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

if (-Not $DryRun) {
  Restart-ScriptForElevation $args
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
