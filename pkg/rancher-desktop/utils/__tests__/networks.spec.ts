import net from 'net';

import { getAvailablePorts, stripNoproxyPrefix } from '../networks';

describe('getAvailablePorts', () => {
  it('returns the requested number of ports', async() => {
    const ports = await getAvailablePorts(3);

    expect(ports).toHaveLength(3);
  });

  it('returns ports greater than zero', async() => {
    const ports = await getAvailablePorts(2);

    for (const port of ports) {
      expect(port).toBeGreaterThan(0);
    }
  });

  it('returns usable ports', async() => {
    const ports = await getAvailablePorts(2);

    // Verify both returned ports can actually be bound.
    for (const port of ports) {
      const server = net.createServer();

      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });

      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  it('returns distinct ports', async() => {
    const ports = await getAvailablePorts(2);

    expect(ports[0]).not.toBe(ports[1]);
  });

  it('can accept dynamic counts', async() => {
    const count = Math.floor(1.0); // Force number type, not a literal.
    const ports = await getAvailablePorts(count);

    expect(ports).toHaveLength(count);
  });
});

describe('stripNoproxyPrefix', () => {
  it('strips wildcard prefix from *.example.com', () => {
    expect(stripNoproxyPrefix('*.example.com')).toBe('example.com');
  });

  it('strips leading-dot prefix from .example.com', () => {
    expect(stripNoproxyPrefix('.example.com')).toBe('example.com');
  });

  it('returns plain domains unchanged', () => {
    expect(stripNoproxyPrefix('example.com')).toBe('example.com');
  });

  it('returns an empty string unchanged', () => {
    expect(stripNoproxyPrefix('')).toBe('');
  });

  it('strips prefix from a bare dot', () => {
    expect(stripNoproxyPrefix('.')).toBe('');
  });

  it('strips prefix from a bare wildcard-dot', () => {
    expect(stripNoproxyPrefix('*.')).toBe('');
  });

  it('returns a bare asterisk unchanged', () => {
    expect(stripNoproxyPrefix('*')).toBe('*');
  });
});
