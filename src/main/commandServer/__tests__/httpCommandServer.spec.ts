import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

import { HttpCommandServer } from '../httpCommandServer';
import { spawnFile } from '@/utils/childProcess';

describe(HttpCommandServer, () => {
  let itWindows = it;
  let itNonWindows = it;
  let rdctlPath = path.join('resources', os.platform(), 'bin', 'rdctl');

  if (os.platform().startsWith('win')) {
    rdctlPath += '.exe';
    itNonWindows = it.skip;
    // Don't run the error-message test if the rancher-desktop WSL is running
    if (execFileSync('wsl', ['--list', '--quiet'], { stdio: 'pipe', encoding: 'utf16le' }).match(/^rancher-desktop$/m) &&
      execFileSync('wsl', ['--list', '--verbose'], { stdio: 'pipe', encoding: 'utf16le' }).match(/^\s*rancher-desktop\s+Running/m)) {
      itWindows = it.skip;
    }
  } else {
    itWindows = it.skip;
    try {
      execFileSync(rdctlPath, ['list-settings'], { stdio: 'pipe' });
      itNonWindows = it.skip;
    } catch {
      // Run this again in the test to verify we get the expected error message
    }
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
    const listSettingsRejects = await expect(() => spawnFile(rdctlPath, ['list-settings'], { stdio: 'pipe' })).rejects;

    listSettingsRejects.toHaveProperty('stdout', '');
    listSettingsRejects.toHaveProperty('stderr', expect.stringMatching(/Error.*\/v\d\/settings.*dial tcp.*connect: connection refused/));

    const rejects = await expect(() => spawnFile(rdctlPath, ['shell', 'echo', 'abc'], { stdio: 'pipe' })).rejects;

    rejects.toHaveProperty('stdout', '');
    rejects.toHaveProperty('stderr', expect.stringContaining("Either run 'rdctl start' or start the Rancher Desktop application first"));
    rejects.toHaveProperty('stderr', expect.stringMatching(/(?:The Rancher Desktop VM needs to be created)|(?:The Rancher Desktop VM needs to be in state "Running" in order to execute 'rdctl shell', but it is currently in state)/));
  });

  itWindows("should fail to run on Windows when there's no rancher-desktop WSL", async() => {
    const rejects = await expect(() => spawnFile(rdctlPath, ['shell', 'echo', 'abc'], { stdio: 'pipe' })).rejects;

    rejects.toHaveProperty('stdout', '');
    rejects.toHaveProperty('stderr', expect.stringContaining("Either run 'rdctl start' or start the Rancher Desktop application first"));
    rejects.toHaveProperty('stderr', expect.stringMatching(/(?:The Rancher Desktop WSL needs to be running in order to execute 'rdctl shell', but it currently is not.)|(?:The Rancher Desktop WSL needs to be in state "Running" in order to execute 'rdctl shell', but it is currently in state)/));
  });
});
