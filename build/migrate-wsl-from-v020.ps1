# PowerShell script to ensure that if there's a wsl distribution
# named 'k3s', it gets renamed to 'rancher-desktop'
# This script returns 0 if a successful migration was carried out
# Otherwise it will return whatever exit status a failing subcommand returns.

$parentKey = "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Lxss"
$guids = Get-ChildItem -Path $parentKey | Select-Object -ExpandProperty Name
foreach ($guid in $guids) {
   $prop = Get-ItemProperty -Path ("Registry::" + $guid)
   if ($prop.DistributionName -eq "k3s") {
     # Need to shut it down. Couldn't get this to work:
     # wsl --list --running | select-string -Pattern k3s
     # So just shut it down. We're installing, we shouldn't be running rancher-desktop anyway.

     wsl --terminate k3s
     
     Set-ItemProperty -Path ("Registry::" + $guid) -Name DistributionName -Value "rancher-desktop"
     echo "renamed distribution 'k3s' to 'rancher-desktop'"
     exit 0
   }
}
echo "Didn't find a wsl distribution named 'k3s'"
exit 0

