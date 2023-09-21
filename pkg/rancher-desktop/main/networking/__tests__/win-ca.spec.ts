import os from 'os';

import { spawnFile } from '@pkg/utils/childProcess';

import getWinCertificates from '../win-ca';

const testWin32 = os.platform() === 'win32' ? test : test.skip;

testWin32('getWinCertificates', async() => {
  const actualSerials = new Set<string>();

  for await (const cert of getWinCertificates({ store: ['CA'] })) {
    actualSerials.add(cert.serial);
  }

  const { stdout } = await spawnFile('powershell.exe',
    [String.raw`Get-ChildItem Cert:\CurrentUser\CA | ForEach-Object SerialNumber`],
    { stdio: ['ignore', 'pipe', 'inherit'] });
  const expectedSerials = new Set<string>(stdout.split(/\s+/).filter(x => x));

  expect(actualSerials).toEqual(expectedSerials);
}, 30_000);
