
$InformationPreference = 'Continue'

## Update the Visual Studio Installer.  This can take a long time, so start this
# first before doing anything else.
Write-Information 'Updating Visual Studio components...'
& 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vs_installer.exe' update `
    --installPath 'C:\Program Files (x86)\Microsoft Visual Studio\2019\Community' `
    --passive

## Download GTK
Write-Information 'Downloading GTK...'
$GTKFile = "$ENV:TEMP\gtk.zip"

try {
    Invoke-WebRequest -Uri 'https://download.gnome.org/binaries/win64/gtk+/2.22/gtk%2B-bundle_2.22.1-20101229_win64.zip' `
        -UseBasicParsing -OutFile $GTKFile

    Microsoft.PowerShell.Archive\Expand-Archive -Path $GTKFile -DestinationPath C:\GTK
}
finally {
    Remove-Item $GTKFile
}

## Download libjpeg-turbo
Write-Information 'Downloading libjpeg-turbo...'
$JPEGFile = "$ENV:TEMP\jpeg-turbo.exe"

try {
    # SourceForge likes to do the redirect thing, so we need to ask it for the URL
    Invoke-WebRequest -Uri 'https://downloads.sourceforge.net/project/libjpeg-turbo/2.0.6/libjpeg-turbo-2.0.6-vc64.exe' `
        -UseBasicParsing -OutFile $JPEGFile
    $url = (Invoke-WebRequest -UseBasicParsing `
        -Uri 'https://sourceforge.net/settings/mirror_choices?projectname=libjpeg-turbo&filename=2.0.6/libjpeg-turbo-2.0.6-vc64.exe' `
    | Select-Object -ExpandProperty Links | Where-Object { $_.outerHTML -like '*direct link*' } | Select-Object -ExpandProperty href)
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $JPEGFile
    & $JPEGFile /D 'C:\libjpeg-turbo64' /S
} finally {
    Remove-Item $JPEGFile
}

## Install additional Visual Studio components.  This depends on it already
# having been updated.
Write-Information 'Installing additional Visual Studio components...'
Wait-Process -Name setup
& 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vs_installer.exe' modify `
    --installPath 'C:\Program Files (x86)\Microsoft Visual Studio\2019\Community' `
    --add Microsoft.VisualStudio.Component.VC.v141.x86.x64 `
    --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
    --passive

## Install Scoop and from there, Git + NVM + Python 2
Write-Information 'Installing Git, NodeJS & Python 2...'

Invoke-WebRequest -UseBasicParsing -Uri get.scoop.sh | Invoke-Expression
scoop install git
scoop bucket add versions
scoop install nvm python27
nvm install latest
nvm use $(nvm list)
Write-Output 'msbuild_path=C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\MSBuild\Current\Bin\MSBuild.exe' `
  | Out-File -Encoding UTF8 -FilePath ~/.npmrc


# Wait for Visual Studio Setup to finish
Wait-Process -Name setup
