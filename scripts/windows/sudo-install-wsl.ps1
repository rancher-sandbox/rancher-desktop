# //////////////////////////////////////////////////////////////////////
# sudo-install-ws1.ps1

param($Step)
if ($Step -eq "" -or $Step -eq $null) {
  echo "Missing -Step parameter"
  exit
}

$script = $myInvocation.MyCommand.Definition
$scriptPath = Split-Path -parent $script
. (Join-Path $scriptpath restart-helpers.ps1)

try {

  Clear-Any-Restart

  Start-Process $psHome\powershell.exe -Verb Runas -ArgumentList "$ScriptPath/install-wsl.ps1 -Step $Step"
} catch {
  echo "Something bad happened"
  pause
}
