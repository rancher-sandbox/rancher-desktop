import os from 'os';

export function wslHostIPv4Address(): string | undefined {
  const iface = os.networkInterfaces()['vEthernet (WSL)'] ?? [];

  return iface.find(addr => addr.family === 'IPv4')?.address;
}
