import net from 'net';

import { findAvailablePort } from '../networks';

describe('findAvailablePort', () => {
  it('returns the preferred port when it is available', async() => {
    // Use a high ephemeral port unlikely to be in use.
    const port = await findAvailablePort(59123);

    expect(port).toBe(59123);
  });

  it('returns a different port when the preferred port is in use', async() => {
    // Occupy a port so findAvailablePort must fall back.
    const blocker = net.createServer();

    await new Promise<void>((resolve) => {
      blocker.listen(59124, '127.0.0.1', resolve);
    });

    try {
      const port = await findAvailablePort(59124);

      expect(port).not.toBe(59124);
      expect(port).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((resolve) => {
        blocker.close(() => resolve());
      });
    }
  });

  it('returns the actual port when preferred port is 0', async() => {
    const port = await findAvailablePort(0);

    expect(port).toBeGreaterThan(0);
  });

  it('returns a usable port', async() => {
    const port = await findAvailablePort(59125);

    // Verify the returned port can actually be bound.
    const server = net.createServer();

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });
});
