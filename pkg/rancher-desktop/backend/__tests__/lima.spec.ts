/** @jest-environment node */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { jest } from '@jest/globals';
import yaml from 'yaml';

import mockModules from '@pkg/utils/testUtils/mockModules';

/** Parse a YAML asset from the source tree. */
function loadAsset(name: string) {
  return yaml.parse(fs.readFileSync(path.join('pkg', 'rancher-desktop', 'assets', name), 'utf-8'));
}

const modules = mockModules({
  // The jest configuration maps every asset to one stub module, so this mock
  // serves both assets that lima.ts reads at load time; their top-level keys
  // differ.
  '@pkg/assets/networks-config.yaml': { ...loadAsset('dependencies.yaml'), ...loadAsset('networks-config.yaml') },
  electron:                           undefined,
  '@pkg/utils/logging':               undefined,
  '@pkg/sudo-prompt':                 { exec: jest.fn() },
  '@pkg/utils/paths':                 { lima: '' },
});

const { default: LimaBackend } = await import('@pkg/backend/lima');

const HOSTILE_NETWORKS = `
paths:
  varRun: /private/var/run
networks:
  host:
    mode: host
    gateway: 192.168.206.1
    dhcpEnd: 192.168.206.254
    netmask: "255.255.255.0\\nALL ALL=(ALL) NOPASSWD: ALL, \\\\\\n/private/var/run/socket_vmnet.host,"
  rancher-desktop-shared:
    mode: shared
    gateway: 192.168.205.1
    dhcpEnd: 192.168.205.254
    netmask: 255.255.255.0
`;

const CUSTOM_NETWORKS = HOSTILE_NETWORKS
  .replace(/192\.168\.206/g, '192.168.107')
  .replace(/netmask: ".*"/, 'netmask: 255.255.255.0');

/** Exposes the protected methods under test. */
class TestBackend extends LimaBackend {
  installCustomLimaNetworkConfig(allowRoot?: boolean) {
    return super.installCustomLimaNetworkConfig(allowRoot);
  }

  sudoersFile(config: Awaited<ReturnType<TestBackend['installCustomLimaNetworkConfig']>>) {
    return super.sudoersFile(config);
  }
}

describe('LimaBackend root command inputs', () => {
  let workdir: string;
  let networkPath: string;
  let subj: TestBackend;

  beforeEach(async() => {
    workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-lima-test-'));
    modules['@pkg/utils/paths'].lima = path.join(workdir, 'lima');
    networkPath = path.join(workdir, 'lima', '_config', 'networks.yaml');
    await fs.promises.mkdir(path.dirname(networkPath), { recursive: true });
    // The constructor registers a process exit hook that runs limactl.
    subj = Object.create(TestBackend.prototype);
  });

  afterEach(async() => {
    await fs.promises.rm(workdir, { recursive: true, force: true });
  });

  it('replaces a networks.yaml with an invalid netmask', async() => {
    await fs.promises.writeFile(networkPath, HOSTILE_NETWORKS);
    const config = await subj.installCustomLimaNetworkConfig(false);

    expect(config.networks.host).toEqual({
      mode: 'host', gateway: '192.168.206.1', dhcpEnd: '192.168.206.254', netmask: '255.255.255.0',
    });
    expect(subj.sudoersFile(config)).not.toContain('ALL ALL=');
    await expect(fs.promises.readFile(networkPath.replace(/\.yaml$/, '.orig.yaml'), 'utf-8'))
      .resolves.toEqual(HOSTILE_NETWORKS);
  });

  it('keeps a valid custom subnet', async() => {
    await fs.promises.writeFile(networkPath, CUSTOM_NETWORKS);
    const config = await subj.installCustomLimaNetworkConfig(false);

    expect(config.networks).toEqual(yaml.parse(CUSTOM_NETWORKS).networks);
  });
});
