import os from 'os';
import path from 'path';

import { HttpCommandServer } from '../httpCommandServer';
import { spawnFile } from '@/utils/childProcess';
import resources from '@/utils/resources';

function exeIt(name: string) {
  return os.platform().startsWith('win') ? `${ name }.exe` : name;
}

describe(HttpCommandServer, () => {
  /**
   * This test is designed to handle two cases:
   * 1. VM 0 doesn't exist (so rancher desktop isn't running, or never has).
   * 2. Rancher Desktop isn't running.
   * There are edge cases where this test might fail, such as when Rancher Desktop is starting up
   * so the VM exists but the command server hasn't started yet. For the purposes of running this in CI,
   * or by developers during a typical edit-test-fix cycle, these are edge cases we can ignore for now.
   */
  it("should fail to run rdctl shell when server isn't running", async() => {
    const rdctlPath = path.join('resources', os.platform(), 'bin', exeIt('rdctl'));

    try {
      await spawnFile(rdctlPath, ['list-settings'], { stdio: 'pipe' });
      console.log('Skipping rdctl shell failure test because the rdctl server is running.');
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        console.log("Skipping test: rdctl hasn't been built yet.");

        return;
      }
      const stderr = err.stderr ?? '';

      if (stderr.match(/Error.*\/v\d\/settings.*dial tcp.*connect: connection refused/)) {
        try {
          const { stdout } = await spawnFile(rdctlPath, ['shell', 'echo', 'abc'], { stdio: 'pipe' });

          expect(stdout).toEqual('Running rdctl shell should have failed.');
        } catch (err: any) {
          const stderr = err.stderr ?? '';

          expect(stderr).toContain("Either run 'rdctl start' or start the Rancher Desktop application first");
          expect(stderr).toMatch(/(?:The Rancher Desktop VM needs to be created)|(?:The Rancher Desktop VM needs to be in state \"Running\" in order to execute 'rdctl shell', but it is currently in state)/);
        }
      } else {
        expect(stderr).toMatch(/Error.*\/v\d\/settings.*dial tcp.*connect: connection refused/);
      }
    }
  });
});
