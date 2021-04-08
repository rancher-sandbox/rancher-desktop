
## Download GTK
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

## Install missing Visual Studio bits.
& 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vs_installer.exe' modify `
    --installPath 'C:\Program Files (x86)\Microsoft Visual Studio\2019\Community' `
    --add Microsoft.VisualStudio.Component.VC.v141.x86.x64 `
    --add Microsoft.VisualStudio.Component.Git `
    --add Component.CPython2.x64 `
    --passive
# Not sure why Python wasn't added to the $PATH
$path = [System.Environment]::GetEnvironmentVariable('PATH', [System.EnvironmentVariableTarget]::User).Split(';')
if (-not $path -contains "C:\Python27amd64") {
    $path += "C:\Python27amd64"
    [System.Environment]::SetEnvironmentVariable('PATH', [String]::Join(';', $path), [System.EnvironmentVariableTarget]::User)
}

## Install Scoop and from there, NVM

Invoke-WebRequest -UseBasicParsing -Uri get.scoop.sh | Invoke-Expression
scoop install nvm
nvm install latest
nvm use $(nvm list)
