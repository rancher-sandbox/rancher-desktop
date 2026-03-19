import net from 'net';
import os from 'os';

export enum networkStatus {
  CHECKING = 'checking...',
  CONNECTED = 'online',
  OFFLINE = 'offline',
}

/**
 * Ask the OS to assign free ports on localhost. All ports are bound
 * simultaneously before any are released, guaranteeing distinct values.
 * The ports are released before returning, so there is a small TOCTOU
 * race before the caller binds them. In practice the risk is negligible
 * because the caller (Steve) binds within seconds.
 */
export async function getAvailablePorts(count: number): Promise<number[]> {
  const servers: net.Server[] = [];

  try {
    for (let i = 0; i < count; i++) {
      const server = net.createServer();

      servers.push(server);
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
    }

    return servers.map(s => (s.address() as net.AddressInfo).port);
  } finally {
    await Promise.all(servers.map(s =>
      new Promise<void>(resolve => s.close(() => resolve()))));
  }
}

export function wslHostIPv4Address(): string | undefined {
  const interfaces = os.networkInterfaces();
  // The veth interface name changed at some time on Windows 11, so try the new name if the old one doesn't exist
  const iface = interfaces['vEthernet (WSL)'] ?? interfaces['vEthernet (WSL (Hyper-V firewall))'] ?? [];

  return iface.find(addr => addr.family === 'IPv4')?.address;
}
