# //////////////////////////////////////////////////////////////////////
# sudo-install-ws1.ps1

Param(
    [Parameter(Mandatory)]
    [ValidateSet("EnableVMPlatform-02", "InstallLinuxUpdatePackage-03")]
    $Step = "EnableVMPlatform-02")

$script = $myInvocation.MyCommand.Definition
$scriptPath = Split-Path -parent $script
. (Join-Path $scriptpath restart-helpers.ps1)

try {
  Start-Process $psHome\powershell.exe -Verb Runas -ArgumentList "$ScriptPath/install-wsl.ps1 -Step $Step"
} catch {
  echo "Something bad happened"
  pause
}
