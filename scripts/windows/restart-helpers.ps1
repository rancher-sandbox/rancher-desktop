# //////////////////////////////////////////////////////////////////////
# restart-helpers.ps1

function Set-Key([string] $path, [string] $key, [string] $value)
{
  Set-ItemProperty -path $path -name $key -value $value
}

function Get-Key([string] $path, [string] $key)
{
  return (Get-ItemProperty $path).$key
}


$global:RegRunKey ="HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce"
$global:restartKey = "Restart-And-Resume"
$global:powershell = (Join-Path $PSHOME "powershell.exe")
function Restart-Machine-With-Resume-Command([string] $script, [string] $step, [string] $action)
{
  $command = "$global:powershell $script -Step $step"
  Set-Key $global:RegRunKey $global:restartKey $command
  Restart-Machine-On-Acceptance -Action $action -Restart
}

function Restart-Machine-On-Acceptance([string] $action, [switch] $Restart=$false)
{
  $prompt = "A restart is needed to continue $action. You can do this later if you prefer."
  if ($Restart) {
    $prompt += "`n`nThere might be a short delay, around a minute, after restart before this script restarts.`n"
  }
  $answer = $Host.UI.PromptForChoice($prompt, 'Restart now?', @('&Yes', '&No'), 1)
  if ($answer -eq 0) {
    Restart-Computer
    exit
  }
}
