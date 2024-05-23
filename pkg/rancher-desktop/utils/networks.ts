import os from 'os';

export enum networkStatus {
  CHECKING = 'checking...',
  CONNECTED = 'online',
  OFFLINE = 'offline',
}

export function wslHostIPv4Address(): string | undefined {
  const interfaces = os.networkInterfaces();
  // The veth interface name changed at some time on Windows 11, so try the new name if the old one doesn't exist
  const iface = interfaces['vEthernet (WSL)'] ?? interfaces['vEthernet (WSL (Hyper-V firewall))'] ?? [];

  return iface.find(addr => addr.family === 'IPv4')?.address;
}
