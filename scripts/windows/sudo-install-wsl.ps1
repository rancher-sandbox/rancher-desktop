# //////////////////////////////////////////////////////////////////////
# sudo-install-ws1.ps1

Param(
    [Parameter(Mandatory)]
    [ValidateSet("BeforeRestart", "AfterRestart")]
    $Step = "BeforeRestart")

$script = $myInvocation.MyCommand.Definition
$scriptPath = Split-Path -parent $script
. (Join-Path $scriptpath restart-helpers.ps1)

try {
  Start-Process $psHome\powershell.exe -Verb Runas -ArgumentList "$ScriptPath/install-wsl.ps1 -Step $Step"
} catch {
  echo "Something bad happened"
  pause
}
