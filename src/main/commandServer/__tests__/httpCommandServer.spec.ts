import os from 'os';
import path from 'path';

import { HttpCommandServer } from '../httpCommandServer';
import { spawnFile } from '@/utils/childProcess';
import resources from '@/utils/resources';

function exeIt(name: string) {
  return os.platform() === 'win32' ? `${ name }.exe` : name;
}

describe(HttpCommandServer, () => {
  it("should fail to run rdctl shell when server isn't running", async() => {
    const rdctlPath = path.join('resources', os.platform(), 'bin', exeIt('rdctl'));

    try {
      await spawnFile(rdctlPath, ['list-settings'], { stdio: 'pipe' });
      console.log('Skipping rdctl shell failure test because the rdctl server is running.');
    } catch (err: any) {
      if (err.stderr.match(/Error.*\/v\d\/settings.*dial tcp.*connect: connection refused/)) {
        try {
          const { stdout, stderr } = await spawnFile(rdctlPath, ['shell', 'echo', 'abc'], { stdio: 'pipe' });

          expect(stdout).toEqual('Running rdctl shell should have failed.');
        } catch (err: any) {
          expect(err.stderr).toMatch(/instance \\"0\\" is stopped, run `limactl start 0` to start the instance/);
        }
      } else {
        expect(err.stderr).toMatch(/Error.*\/v\d\/settings.*dial tcp.*connect: connection refused/);
      }
    }
  });
});
