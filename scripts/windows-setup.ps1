param (
    [switch] $SkipVisualStudio,
    [switch] $SkipTools,
    [switch] $SkipWSL
)

$InformationPreference = 'Continue'

Write-Information 'Installing components required for Rancher Desktop development...'

# Start separate jobs for things we want to install (in subprocesses).

if (!$SkipVisualStudio) {
    Start-Job -Name 'Visual Studio' -ErrorAction Stop -ScriptBlock {
        $location = Get-CimInstance -ClassName MSFT_VSInstance `
            | Where-Object { $_.IsComplete } `
            | Select-Object -First 1 -ExpandProperty InstallLocation
        # This path appears to be hard-coded:
        # https://docs.microsoft.com/en-us/visualstudio/install/modify-visual-studio#open-the-visual-studio-installer
        $installer = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vs_installer.exe'

        # Updating first is required; otherwise, the installer just complains that
        # the installer itself is out of date.
        Write-Information 'Updating Visual Studio components...'
        & $installer update --installPath $location --passive
        Write-Information 'Waiting for Visual Studio update to complete...'
        Get-Process | Where-Object Name -in ('setup', 'vs_installer') | Wait-Process

        Write-Information 'Installing additional Visual Studio components...'
        & $installer modify --installPath $location --passive `
            --add Microsoft.VisualStudio.Component.VC.v141.x86.x64 `
            --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64
        Write-Information 'Waiting for Visual Studio installation to complete...'
        Get-Process | Where-Object Name -in ('setup', 'vs_installer') | Wait-Process

        # Tell NPM to use MSBuild from the just-updated copy of Visual Studio.
        # This is required as otherwise node-gyp will be unable to find it.
        $msbuild = Join-Path $location 'MSBuild/Current/Bin/MSBuild.exe'
        Write-Output "msbuild_path=${msbuild}" `
            | Out-File -Encoding UTF8 -FilePath ~/.npmrc
    }
}


if (!$SkipTools) {
    Start-Job -Name 'Install Tools' -ErrorAction Stop -ScriptBlock {
        Write-Information 'Installing Tools...'

        Invoke-WebRequest -UseBasicParsing -Uri 'https://get.scoop.sh' `
            | Invoke-Expression
        scoop install 7zip git go mingw nvm python unzip
        # Install and use latest node 18* version
        nvm install 18
        nvm use $(nvm list | Select-String '[18\.[0-9.]+]' | Select-Object -First 1 | ForEach-Object { $_.Matches.Value })
        # Install the yarn package manager
        npm install --global yarn
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
