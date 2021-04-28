# //////////////////////////////////////////////////////////////////////
# install-wsl.ps1

param($Step = "A")

$workDir = (Join-Path [System.IO.Path]::GetTempPath() rdinstall)
New-Item -ItemType Directory -Force -Path $workDir

$logFile = (Join-Path $workDir restarts.txt)
$wslMsiFile = (Join-Path $workDir wsl_update_x64.msi)
$ubuntuFile = (Join-Path $workDir Ubuntu.appx)

$script = $myInvocation.MyCommand.Definition
$scriptPath = Split-Path -parent $script
. (Join-Path $scriptpath restart-helpers.ps1)
$sudoInstallScript = (Join-Path $scriptPath sudo-install-wsl.ps1)

#Requires -RunAsAdministrator
Clear-Any-Restart

if ($Step -eq "A") {
  Write-Output "Doing Step A"
  Write-Output "Doing Step A" | Out-File $logFile
  dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
  dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
  Invoke-WebRequest -Uri https://wslstorestorage.blob.core.windows.net/wslblob/wsl_update_x64.msi -OutFile wsl_update_x64.msi
  msiexec /norestart /i$wslMsiFile
  Restart-And-Resume $sudoInstallScript "B" "install"
}

if ($Step -eq "B") {
  Write-Output "Doing Step B"
  Write-Output "Doing Step B" | Out-File $logFile -Append
  wsl --set-default-version 2
  Invoke-WebRequest `
    -Uri https://wsldownload.azureedge.net/Ubuntu_1604.2019.523.0_x64.appx `
    -OutFile $ubuntuFile `
    -UseBasicParsing
  Add-AppxPackage $ubuntuFile
  echo "The final step is to start up the ubuntu subsystem and provide a username and password"
  pause
  ubuntu
}





