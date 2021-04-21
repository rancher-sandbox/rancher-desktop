param (
    [switch] $SkipVisualStudio,
    [switch] $SkipGTK,
    [switch] $SkipLibJPEG,
    [switch] $SkipTools
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

if (!$SkipGTK) {
    Start-Job -Name 'GTK' -ErrorAction Stop -ScriptBlock {
        Write-Information 'Downloading GTK...'
        $GTKFile = "$ENV:TEMP\gtk.zip"

        try {
            Invoke-WebRequest -UseBasicParsing -OutFile $GTKFile `
                -Uri 'https://download.gnome.org/binaries/win64/gtk+/2.22/gtk%2B-bundle_2.22.1-20101229_win64.zip'

            Microsoft.PowerShell.Archive\Expand-Archive -Path $GTKFile -DestinationPath C:\GTK -Force
        }
        finally {
            Remove-Item $GTKFile
        }
    }
}

if (!$SkipLibJPEG) {
    Start-Job -Name 'libjpeg-turbo' -ErrorAction Stop -ScriptBlock {
        Write-Information 'Downloading libjpeg-turbo...'
        $JPEGFile = "$ENV:TEMP\jpeg-turbo.exe"

        if (Test-Path 'C:\libjpeg-turbo64\bin\turbojpeg.dll') {
          # libjpeg-turbo is already installed; skip installing it again to avoid
          # a dialog box.
          Return
        }

        try {
            # SourceForge likes to do the redirect thing, so we need to ask it for the URL
            $url = (Invoke-WebRequest -UseBasicParsing `
                    -Uri 'https://sourceforge.net/settings/mirror_choices?projectname=libjpeg-turbo&filename=2.0.6/libjpeg-turbo-2.0.6-vc64.exe' `
                | Select-Object -ExpandProperty Links `
                | Where-Object { $_.outerHTML -like '*direct link*' } `
                | Select-Object -ExpandProperty href)
            Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $JPEGFile
            & $JPEGFile /D 'C:\libjpeg-turbo64' /S
        }
        finally {
            Get-Process | Where-Object Path -eq $JPEGFile | Wait-Process
            Remove-Item $JPEGFile
        }
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
        nvm install latest
        nvm use $(nvm list | Where-Object { $_ } | Select-Object -First 1)
    }
}

# Wait for all jobs to finish.
Get-Job | Receive-Job -Wait -ErrorAction Stop
# Show that all jobs are done
Get-Job
Write-Information 'Rancher Desktop development environment setup complete.'
