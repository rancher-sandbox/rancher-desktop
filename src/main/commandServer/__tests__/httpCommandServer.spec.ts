import fs from 'fs';
import os from 'os';
import path from 'path';

import { HttpCommandServer } from '../httpCommandServer';
import { spawnFile } from '@/utils/childProcess';
import resources from '@/utils/resources';

describe(HttpCommandServer, () => {
  let itWindows = it;
  let itNonWindows = it;
  let rdctlPath = path.join('resources', os.platform(), 'bin', 'rdctl');

  if (os.platform().startsWith('win')) {
    rdctlPath += '.exe';
    itNonWindows = it.skip;
  } else {
    itWindows = it.skip;
  }
  try {
    fs.accessSync(rdctlPath, fs.constants.X_OK);
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      itWindows = itNonWindows = it.skip;
    } else {
      throw e;
    }
  }
  /**
   * This test is designed to handle two cases:
   * 1. VM 0 doesn't exist (so rancher desktop isn't running, or never has).
   * 2. Rancher Desktop isn't running.
   * There are edge cases where this test might fail, such as when Rancher Desktop is starting up
   * so the VM exists but the command server hasn't started yet. For the purposes of running this in CI,
   * or by developers during a typical edit-test-fix cycle, these are edge cases we can ignore for now.
   */
  itNonWindows("should fail to run rdctl shell when server isn't running", async() => {
    try {
      await spawnFile(rdctlPath, ['list-settings'], { stdio: 'pipe' });
      console.log('Skipping rdctl shell failure test because the rdctl server is running.');
    } catch (err: any) {
      const stderr = err.stderr ?? '';

      if (stderr.match(/Error.*\/v\d\/settings.*dial tcp.*connect: connection refused/)) {
        try {
          const { stdout } = await spawnFile(rdctlPath, ['shell', 'echo', 'abc'], { stdio: 'pipe' });

          expect(stdout).toEqual('Running rdctl shell should have failed.');
        } catch (err: any) {
          const stderr = err.stderr ?? '';

          expect(stderr).toContain("Either run 'rdctl start' or start the Rancher Desktop application first");
          expect(stderr).toMatch(/(?:The Rancher Desktop VM needs to be created)|(?:The Rancher Desktop VM needs to be in state "Running" in order to execute 'rdctl shell', but it is currently in state)/);
        }
      } else {
        expect(stderr).toMatch(/Error.*\/v\d\/settings.*dial tcp.*connect: connection refused/);
      }
    }
  });

  itWindows("should fail to run on Windows when there's no rancher-desktop WSL", async() => {
    try {
      const { stdout, stderr } = await spawnFile('wsl', ['--list', '-v'], { stdio: 'pipe', encoding: 'utf16le' });
      const splitLines = stdout.split(/\r?\n/);
      const lines = splitLines.filter(line => (line ?? '').match(/rancher-desktop\s/));

      expect(stderr).toEqual('');
      if (lines[0]?.match(/Running/)) {
        console.log(`Skipping test because there is a running WSL called "rancher-desktop". This test isn't expected to be run every time.`);

        return;
      }
      try {
        await spawnFile(rdctlPath, ['shell', 'echo', 'abc'], { stdio: 'pipe' });
        fail("Running rdctl shell should have failed because there's no running rancher-desktop WSL.");
      } catch (err: any) {
        const stdout = err.stdout ?? '';
        const stderr = err.stderr ?? '';

        expect(stdout).toBe('');
        expect(stderr).toMatch(/(?:The Rancher Desktop WSL needs to be running in order to execute 'rdctl shell', but it currently is not.)|(?:The Rancher Desktop WSL needs to be in state "Running" in order to execute 'rdctl shell', but it is currently in state)/);
        expect(stderr).toContain("Either run 'rdctl start' or start the Rancher Desktop application first");
      }
    } catch (err: any) {
      fail(`Running wsl -lv failed with error ${ err }`);
    }
  });
});
