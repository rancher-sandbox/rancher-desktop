param (
    [switch] $SkipTools,
    [switch] $SkipWSL
)

$InformationPreference = 'Continue'

Write-Information 'Installing components required for Rancher Desktop development...'

# Start separate jobs for things we want to install (in subprocesses).

if (!$SkipTools) {
    Start-Job -Name 'Install Tools' -ErrorAction Stop -ScriptBlock {
        Write-Information 'Installing Git & NodeJS...'

        Invoke-WebRequest -UseBasicParsing -Uri 'https://get.scoop.sh' `
            | Invoke-Expression
        scoop install git nvm
        # Temporarily commented out until we can handle later versions of node.js:
        # nvm install latest
        # nvm use $(nvm list | Where-Object { $_ } | Select-Object -First 1)
        nvm install 14.17.0
        nvm use 14.17.0
    }
}

# Wait for all jobs to finish.
Get-Job | Receive-Job -Wait -ErrorAction Stop
# Show that all jobs are done
Get-Job
Write-Information 'Rancher Desktop development environment setup complete.'

if (! (Get-Command wsl -ErrorAction SilentlyContinue) -and !$SkipWSL) {
    Write-Information 'installing wsl.... This will require a restart'

    $targetDir = (Join-Path ([System.IO.Path]::GetTempPath()) rdinstall)
    New-Item -ItemType Directory -Force -Path $targetDir

    $files = ("install-wsl.ps1", "restart-helpers.ps1", "sudo-install-wsl.ps1", "uninstall-wsl.ps1")
    foreach ($file in $files) {
        $url = "https://raw.githubusercontent.com/rancher-sandbox/rancher-desktop/main/scripts/windows/$file"
        $outFile = (Join-Path $targetDir $file)
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $outFile
    }

    $sudoPath = (Join-Path $targetDir sudo-install-wsl.ps1)
    & $sudoPath -Step "EnableWSL-01"
}
