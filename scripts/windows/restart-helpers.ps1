# //////////////////////////////////////////////////////////////////////
# restart-helpers.ps1

function Test-Key([string] $path, [string] $key)
{
  return ((Test-Path $path) -and ((Get-Key $path $key) -ne $null))
}

function Remove-Key([string] $path, [string] $key)
{
  Remove-ItemProperty -path $path -name $key
}

function Set-Key([string] $path, [string] $key, [string] $value)
{
  Set-ItemProperty -path $path -name $key -value $value
}

function Get-Key([string] $path, [string] $key)
{
  return (Get-ItemProperty $path).$key
}


$global:restartKey = "Restart-And-Resume"
function Clear-Any-Restart([string] $key=$global:restartKey)
{
  if (Test-Key $global:RegRunKey $key) {
    Remove-Key $global:RegRunKey $key
  }
}

$global:RegRunKey ="HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
$global:powershell = (Join-Path $env:windir "system32\WindowsPowerShell\v1.0\powershell.exe")
function Restart-Machine-With-Resume-Command([string] $script, [string] $step, [string] $action)
{
  $command = "$global:powershell $script -Step $step"
  Set-Key $global:RegRunKey $global:restartKey $command
  Restart-Machine-On-Acceptance -Action $action
}

function Restart-Machine-On-Acceptance([string] $action)
{
  $answer = $Host.UI.PromptForChoice("A restart is needed to continue $action. You can do this later if you prefer.", 'Restart now?', @('&Yes', '&No'), 1)
  if ($answer -eq 0) {
    Restart-Computer
    exit
  }
}
