# //////////////////////////////////////////////////////////////////////
# uninstall-wsl.ps1

$script = $myInvocation.MyCommand.Definition
$scriptPath = Split-Path -parent $script
. (Join-Path $scriptpath restart-helpers.ps1)

# Magic PowerShell comment to require admin; see
# https://docs.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_requires?view=powershell-5.1#-runasadministrator

#Requires -RunAsAdministrator

wslconfig /u k3s

Disable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -NoRestart

Restart-Machine-On-Acceptance -Action "uninstall wsl"
