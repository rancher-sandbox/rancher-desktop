# PowerShell script to remove resources\win32\bin from the path

param($InstallDir)

$TargetUser = [System.EnvironmentVariableTarget]::User
[System.Collections.ArrayList]$path = [System.Environment]::GetEnvironmentVariable('PATH', $TargetUser) -split ';'
$desiredPath = Join-Path $InstallDir 'resources\win32\bin'
if ($path -contains $desiredPath) {
  $path.Remove($desiredPath)
  [System.Environment]::SetEnvironmentVariable('PATH', ($path -join ';'), $TargetUser)
}
$path = [System.Environment]::GetEnvironmentVariable('PATH', $TargetUser) -split ';'
