import { EventEmitter } from 'events';

import { jest } from '@jest/globals';

import type { spawn } from '@pkg/utils/childProcess';

const logMock = {
  fdStream: Promise.resolve(2),
  log:      jest.fn(),
  error:    jest.fn(),
  info:     jest.fn(),
  warn:     jest.fn(),
  debug:    jest.fn(),
  debugE:   jest.fn(),
};

const spawnMock = jest.fn<typeof spawn>();
const executableMock = jest.fn(() => 'wsl-helper');

jest.unstable_mockModule('@pkg/utils/childProcess', () => ({
  __esModule: true,
  spawn:      spawnMock,
}));
jest.unstable_mockModule('@pkg/utils/logging', () => ({
  __esModule: true,
  Log:        class {},
  default:    new Proxy({}, { get: () => logMock }),
}));
jest.unstable_mockModule('@pkg/utils/resources', () => ({
  __esModule: true,
  executable: executableMock,
}));
jest.unstable_mockModule('tls', () => ({
  __esModule:       true,
  default:          { rootCertificates: ['node-root-cert'] },
  rootCertificates: ['node-root-cert'],
}));

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
}

test('getWinCertificates waits for close before ending and does not emit an empty tail', async() => {
  const { default: getWinCertificates } = await import('../win-ca');
  const proc = new FakeChildProcess();
  const cert1 = '-----BEGIN CERTIFICATE-----\nfirst\n-----END CERTIFICATE-----\n';
  const cert2 = '-----BEGIN CERTIFICATE-----\nsecond\n-----END CERTIFICATE-----\n';
  const actual: string[] = [];

  spawnMock.mockReturnValue(proc as any);

  const collecting = (async() => {
    for await (const cert of getWinCertificates()) {
      actual.push(cert);
    }
  })();

  // The generator suspends at `await fdStream` before registering its event
  // listeners; one microtask tick lets it resume and attach them.
  await Promise.resolve();

  proc.stdout.emit('data', cert1);
  proc.emit('exit', 0, null);
  proc.stdout.emit('data', cert2);
  proc.emit('close', 0, null);

  await collecting;

  expect(actual).toEqual([cert1, cert2, 'node-root-cert']);
  expect(actual).not.toContain('');
  expect(executableMock).toHaveBeenCalledWith('wsl-helper');
});
