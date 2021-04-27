# //////////////////////////////////////////////////////////////////////
# uninstall-wsl.ps1

param($Step = "A")

$script = $myInvocation.MyCommand.Definition
$scriptPath = Split-Path -parent $script
. (Join-Path $scriptpath restart-helpers.ps1)

#Requires -RunAsAdministrator

wslconfig /u k3s
wslconfig /u Ubuntu

Disable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -NoRestart

Prompt-Restart -Action "uninstall wsl"
