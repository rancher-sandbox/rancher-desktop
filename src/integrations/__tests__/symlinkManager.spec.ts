import fs from 'fs';
import os from 'os';
import path from 'path';
import IntegrationManager from '@/integrations/symlinkManager';

const resourcesDir = path.join('resources', os.platform(), 'bin');
let testDir: string;
let integrationDir: string;
let dockerCliPluginDir: string;

beforeEach(async() => {
  testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rdtest-'));
  integrationDir = path.join(testDir, 'integrationDir');
  dockerCliPluginDir = path.join(testDir, 'dockerCliPluginDir');
});

afterEach(async() => {
  // It is best to be careful around rm's; we don't want to remove important things.
  if (testDir) {
    await fs.promises.rm(testDir, { recursive: true, force: true });
  }
});

test('Ensure symlinks and dirs are created properly', async() => {
  const integrationManager = new IntegrationManager(resourcesDir, integrationDir, dockerCliPluginDir);
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
  const integrationManager = new IntegrationManager(resourcesDir, integrationDir, dockerCliPluginDir);
  await integrationManager.enforce();

  await integrationManager.remove();
  expect(fs.promises.readdir(integrationDir)).rejects.toThrow();
  expect(fs.promises.readdir(dockerCliPluginDir)).resolves.toEqual([]);
});
