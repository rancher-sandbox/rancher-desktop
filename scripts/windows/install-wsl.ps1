# //////////////////////////////////////////////////////////////////////
# install-wsl.ps1
# See https://docs.microsoft.com/en-us/windows/wsl/install-win10 for the official story behind this code

Param([ValidateSet("EnableWSL-01", "EnableVMPlatform-02", "InstallLinuxUpdatePackage-03")]$Step = "EnableWSL-01")

$workDir = New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetTempPath()) -Name rdinstall

$logFile = (Join-Path $workDir restarts.txt)
$wslMsiFile = (Join-Path $workDir wsl_update_x64.msi)

$script = $myInvocation.MyCommand.Definition
$scriptPath = Split-Path -parent $script
. (Join-Path $scriptpath restart-helpers.ps1)
$sudoInstallScript = (Join-Path $scriptPath sudo-install-wsl.ps1)

# Magic PowerShell comment to require admin; see
# https://docs.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_requires?view=powershell-5.1#-runasadministrator

#Requires -RunAsAdministrator

if ($Step -eq "EnableWSL-01") {
  Write-Output "Doing Step EnableWSL-01"
  Write-Output "Doing Step EnableWSL-01" | Out-gile $logFile
  dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
  Restart-Machine-With-Resume-Command $sudoInstallScript "EnableVMPlatform-02" "installation (step 2)"
}

if ($Step -eq "EnableVMPlatform-02") {
  Write-Output "Doing Step EnableVMPlatform-02"
  Write-Output "Doing Step EnableVMPlatform-02" | out-file -Append $logFile
  dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
  Restart-Machine-With-Resume-Command $sudoInstallScript "InstallLinuxUpdatePackage-03" "installation (step 3)"
}

if ($Step -eq "InstallLinuxUpdatePackage-03") {
  Write-Output "Doing Step InstallLinuxUpdatePackage-03"
  Write-Output "Doing Step InstallLinuxUpdatePackage-03" | Out-File -Append $logFile
  Invoke-WebRequest -Uri https://wslstorestorage.blob.core.windows.net/wslblob/wsl_update_x64.msi -OutFile $wslMsiFile
  msiexec /norestart /i$wslMsiFile /passive
  wsl --set-default-version 2

  Write-Host -NoNewLine 'WSL is now installed - press any key to continue'
  $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown');
}
