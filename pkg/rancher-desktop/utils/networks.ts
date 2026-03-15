import net from 'net';
import os from 'os';

export enum networkStatus {
  CHECKING = 'checking...',
  CONNECTED = 'online',
  OFFLINE = 'offline',
}

/**
 * Try to use preferredPort; if it is already in use, let the OS assign a
 * free port instead.  Returns the port that is available.
 *
 * The port is released before returning, so there is a TOCTOU race before
 * the caller actually binds it.  In practice the risk is low because the
 * default ports (9443/9080) sit outside the OS ephemeral range and are
 * unlikely to be claimed by another process in the interim.
 */
export function findAvailablePort(preferredPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EADDRINUSE') {
        reject(err);

        return;
      }
      // Preferred port is taken — ask the OS for a free one.
      const fallback = net.createServer();

      fallback.once('error', reject);
      fallback.listen(0, '127.0.0.1', () => {
        const addr = fallback.address() as net.AddressInfo;

        fallback.close(() => resolve(addr.port));
      });
    });

    server.listen(preferredPort, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;

      server.close(() => resolve(addr.port));
    });
  });
}

export function wslHostIPv4Address(): string | undefined {
  const interfaces = os.networkInterfaces();
  // The veth interface name changed at some time on Windows 11, so try the new name if the old one doesn't exist
  const iface = interfaces['vEthernet (WSL)'] ?? interfaces['vEthernet (WSL (Hyper-V firewall))'] ?? [];

  return iface.find(addr => addr.family === 'IPv4')?.address;
}
