import fs from 'fs';
import os from 'os';
import path from 'path';
import removeLegacySymlinks from '@/integrations/legacy';

const resourcesDir = path.join('resources', os.platform(), 'bin');
let testDir: string;
let someOtherDir: string;
let legacyIntegrationDir: string;

beforeEach(async() => {
  testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rdtest-'));
  someOtherDir = path.join(testDir, 'someOtherDir');
  await fs.promises.mkdir(someOtherDir);
  legacyIntegrationDir = path.join(testDir, 'legacyIntegrationDir');
  await fs.promises.mkdir(legacyIntegrationDir);
});

afterEach(async() => {
  // It is best to be careful around rm's; we don't want to remove important things.
  if (testDir) {
    await fs.promises.rm(testDir, { recursive: true, force: true });
  }
});

test('Ensure legacy symlinks are removed properly', async() => {
  // make managed symlinks (these should be removed)
  const managedLegacySymlinks = ['docker', 'kubectl'];

  for (const name of managedLegacySymlinks) {
    const resourcesPath = path.join(resourcesDir, name);
    const legacyIntegrationPath = path.join(legacyIntegrationDir, name);

    await fs.promises.symlink(resourcesPath, legacyIntegrationPath);
  }

  // make unmanaged symlinks (these should not be removed)
  const unmanagedLegacySymlinks = ['helm', 'nerdctl'];

  for (const name of unmanagedLegacySymlinks) {
    const resourcesPath = path.join(resourcesDir, name);
    const someOtherPath = path.join(someOtherDir, name);
    const legacyIntegrationPath = path.join(legacyIntegrationDir, name);

    await fs.promises.symlink(resourcesPath, someOtherPath);
    await fs.promises.symlink(someOtherPath, legacyIntegrationPath);
  }

  await removeLegacySymlinks(legacyIntegrationDir);

  const remaining = await fs.promises.readdir(legacyIntegrationDir);

  expect(remaining).toEqual(unmanagedLegacySymlinks);
});
