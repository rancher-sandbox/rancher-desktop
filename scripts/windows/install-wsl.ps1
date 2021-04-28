# //////////////////////////////////////////////////////////////////////
# install-wsl.ps1

Param([ValidateSet("BeforeRestart", "AfterRestart")]$Step = "BeforeRestart")

$workDir = (Join-Path ([System.IO.Path]::GetTempPath()) rdinstall)
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

if ($Step -eq "BeforeRestart") {
  Write-Output "Doing Step BeforeRestart"
  Write-Output "Doing Step BeforeRestart" | Out-File $logFile
  dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
  dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
  Invoke-WebRequest -Uri https://wslstorestorage.blob.core.windows.net/wslblob/wsl_update_x64.msi -OutFile wsl_update_x64.msi
  msiexec /norestart /i$wslMsiFile
  Restart-Machine-With-Resume-Command $sudoInstallScript "AfterRestart" "install"
}

if ($Step -eq "AfterRestart") {
  Write-Output "Doing Step AfterRestart"
  Write-Output "Doing Step AfterRestart" | Out-File $logFile -Append
  wsl --set-default-version 2
}





