import os from 'os';

export enum networkStatus {
  CHECKING = 'checking...',
  CONNECTED = 'online',
  OFFLINE = 'offline',
}

export function wslHostIPv4Address(): string | undefined {
  const iface = os.networkInterfaces()['vEthernet (WSL)'] ?? [];

  return iface.find(addr => addr.family === 'IPv4')?.address;
}
