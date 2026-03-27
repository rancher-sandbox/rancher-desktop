import net from 'net';
import os from 'os';

export enum networkStatus {
  CHECKING = 'checking...',
  CONNECTED = 'online',
  OFFLINE = 'offline',
}

/**
 * TupleOf<T, N> is a tuple of N elements of type T.
 */
type TupleOf<T, N extends number, R extends T[] = []> =
  number extends N ? T[] : // If N is not a literal, return a normal array.
    R['length'] extends N ? R : TupleOf<T, N, [...R, T]>;

/**
 * Ask the OS to assign free ports on localhost. All ports are bound
 * simultaneously before any are released, guaranteeing distinct values.
 * The ports are released before returning, so there is a small TOCTOU
 * race before the caller binds them. In practice the risk is negligible
 * because the caller (Steve) binds within seconds.
 */
export async function getAvailablePorts<N extends number>(count: N): Promise<TupleOf<number, N>> {
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

    return servers.map(s => (s.address() as net.AddressInfo).port) as TupleOf<number, N>;
  } finally {
    await Promise.all(servers.map(s =>
      new Promise<void>(resolve => s.close(() => resolve()))));
  }
}

/**
 * Strip the wildcard or leading-dot prefix from a noproxy domain entry.
 * Both "*.example.com" and ".example.com" are common NO_PROXY conventions
 * meaning "match this domain and its subdomains".
 */
export function stripNoproxyPrefix(entry: string): string {
  return entry.startsWith('*.') ? entry.substring(2) : entry.startsWith('.') ? entry.substring(1) : entry;
}

export function wslHostIPv4Address(): string | undefined {
  const interfaces = os.networkInterfaces();
  // The veth interface name changed at some time on Windows 11, so try the new name if the old one doesn't exist
  const iface = interfaces['vEthernet (WSL)'] ?? interfaces['vEthernet (WSL (Hyper-V firewall))'] ?? [];

  return iface.find(addr => addr.family === 'IPv4')?.address;
}
