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

        # Updating first is required, otherwise the installer just complains that
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
        Write-Information 'Installing Git, NodeJS & Python 2...'

        Invoke-WebRequest -UseBasicParsing -Uri 'https://get.scoop.sh' `
            | Invoke-Expression
        # Install git first, so that we can get the versions bucket for python27
        scoop install git
        scoop bucket add versions
        # Installing Python2 emits a deprecation warning (because it's long out of
        # support); however, PowerShell will see _anything_ going to stderr and
        # treat the result as fatal.  Redirect the output so we can continue.
        scoop install nvm python27 2>&1
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
    # do: ./$(dirname $0)/windows/install-wsl.ps1
    $script = $myInvocation.MyCommand.Definition
    $scriptPath = Split-Path -parent $script
    $sudoPath = (Join-Path $scriptpath windows\sudo-install-wsl.ps1)
    & $sudoPath -Step "A"
}
