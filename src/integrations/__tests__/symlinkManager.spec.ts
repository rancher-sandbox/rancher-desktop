import fs from 'fs';
import os from 'os';
import path from 'path';
import IntegrationManager from '@/integrations/symlinkManager';

const resourcesDir = path.join('resources', os.platform(), 'bin');
let testDir: string;
let integrationDir: string;
let dockerCliPluginDir: string;
let legacyIntegrationDir: string;

beforeEach(async() => {
  testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rdtest-'));
  integrationDir = path.join(testDir, 'integrationDir');
  dockerCliPluginDir = path.join(testDir, 'dockerCliPluginDir');
  legacyIntegrationDir = path.join(testDir, 'legacyIntegrationDir');
});

afterEach(async() => {
  // It is best to be careful around rm's; we don't want to remove important things.
  if (testDir) {
    await fs.promises.rm(testDir, { recursive: true, force: true });
  }
});

test('Ensure symlinks and dirs are created properly', async() => {
  const integrationManager = new IntegrationManager(resourcesDir, integrationDir, dockerCliPluginDir, legacyIntegrationDir);
  await integrationManager.enforce();
  expect(fs.promises.readdir(integrationDir)).resolves.not.toThrow();
  (await integrationManager.getIntegrationNames()).forEach(async(name) => {
    const integrationPath = path.join(integrationDir, name);
    expect(fs.promises.readlink(integrationPath, 'utf8')).resolves.not.toThrow();
  });
  (await integrationManager.getDockerCliPluginNames()).forEach(async(name) => {
    const pluginPath = path.join(dockerCliPluginDir, name);
    expect(fs.promises.readlink(pluginPath, 'utf8')).resolves.not.toThrow();
  })
});

test('Ensure non-legacy symlinks and dirs are removed properly', async() => {
  const integrationManager = new IntegrationManager(resourcesDir, integrationDir, dockerCliPluginDir, legacyIntegrationDir);
  await integrationManager.enforce();

  await integrationManager.remove();
  expect(fs.promises.readdir(integrationDir)).rejects.toThrow();
  expect(fs.promises.readdir(dockerCliPluginDir)).resolves.toEqual([]);
});

test('Ensure legacy symlinks are removed properly', async() => {
  await fs.promises.mkdir(legacyIntegrationDir);
  const managedLegacySymlinks = ['docker', 'kubectl'];
  managedLegacySymlinks.forEach(async(name) => {
    const resourcesPath = path.join(resourcesDir, name);
    const legacyIntegrationPath = path.join(legacyIntegrationDir, name);
    await fs.promises.symlink(resourcesPath, legacyIntegrationPath);
  });
  const someOtherDir = path.join(testDir, 'someOtherPath');
  await fs.promises.mkdir(someOtherDir);
  const unmanagedLegacySymlinks = ['helm', 'nerdctl'];
  unmanagedLegacySymlinks.forEach(async(name) => {
    const resourcesPath = path.join(resourcesDir, name);
    const someOtherPath = path.join(someOtherDir, name);
    const legacyIntegrationPath = path.join(legacyIntegrationDir, name);
    await fs.promises.symlink(resourcesPath, someOtherPath);
    await fs.promises.symlink(someOtherPath, legacyIntegrationPath);
  });

  const integrationManager = new IntegrationManager(resourcesDir, integrationDir, dockerCliPluginDir, legacyIntegrationDir);
  await integrationManager.enforce();

  const remaining = await fs.promises.readdir(legacyIntegrationDir)
  expect(remaining.length).toEqual(unmanagedLegacySymlinks.length);
  remaining.forEach((name) => {
    expect(unmanagedLegacySymlinks).toContain(name)
  });
});
