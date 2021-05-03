# PowerShell script to add resources\win32\bin to the path

param($InstallDir)

$TargetUser = [System.EnvironmentVariableTarget]::User
$path = [System.Environment]::GetEnvironmentVariable('PATH', $TargetUser) -split ';'
$desiredPath = Join-Path $InstallDir 'resources\win32\bin'
if ($path -notcontains $desiredPath) {
  $path += $desiredPath
  [System.Environment]::SetEnvironmentVariable('PATH', ($path -join ';'), $TargetUser)
}
