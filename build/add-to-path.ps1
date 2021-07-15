# PowerShell script to add resources\win32\bin to the path

param($InstallDir)

function Add-ToPath {
  Param([String] $LiteralPath)

  $TargetUser = [System.EnvironmentVariableTarget]::User
  $path = [System.Environment]::GetEnvironmentVariable('PATH', $TargetUser) -split ';'
  if ($path -notcontains $LiteralPath) {
    $path += $LiteralPath
    [System.Environment]::SetEnvironmentVariable('PATH', ($path -join ';'), $TargetUser)
    Write-Output "Adding Kubernetes tools to PATH."
  }
}

Add-ToPath (Join-Path $InstallDir 'resources\resources\win32\bin')
Add-ToPath (Join-Path $InstallDir 'resources\resources\linux\bin')
