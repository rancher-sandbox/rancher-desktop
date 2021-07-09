# PowerShell script to remove resources\win32\bin from the path

param($InstallDir)

function Remove-FromPath {
  Param([string] $LiteralPath)

  $TargetUser = [System.EnvironmentVariableTarget]::User
  [System.Collections.ArrayList]$path = [System.Environment]::GetEnvironmentVariable('PATH', $TargetUser) -split ';'
  if ($path -contains $LiteralPath) {
    $path.Remove($LiteralPath)
    [System.Environment]::SetEnvironmentVariable('PATH', ($path -join ';'), $TargetUser)
  }
}

Remove-FromPath (Join-Path $InstallDir 'resources\resources\win32\bin')
Remove-FromPath (Join-Path $InstallDir 'resources\resources\linux\bin')
