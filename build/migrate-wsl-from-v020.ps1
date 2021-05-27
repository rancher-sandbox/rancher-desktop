# PowerShell script to ensure that if there's a 
# This script returns 0 if a successful migration was carried out, 100 if no migration is necessary

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
exit 100

