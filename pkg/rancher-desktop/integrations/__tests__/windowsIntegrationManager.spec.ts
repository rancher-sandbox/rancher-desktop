/** @jest-environment node */

import { jest } from '@jest/globals';
import WindowsIntegrationManager, { WSLDistro } from '@pkg/integrations/windowsIntegrationManager';

describe('WindowsIntegrationManager', () => {
  let integrationManager: WindowsIntegrationManager;
  let captureCommandMock: jest.Spied<WindowsIntegrationManager['captureCommand']>;
  const wslOutput = `  NAME                    STATE           VERSION
* Ubuntu                  Stopped         2
  OtherDistro             Running         1
  rancher-desktop-data    Stopped         2
  rancher-desktop         Stopped         2`;

  beforeEach(() => {
    integrationManager = new WindowsIntegrationManager();
    captureCommandMock = jest.spyOn(integrationManager as any, 'captureCommand')
      .mockResolvedValue(wslOutput);
  });

  afterEach(() => {
    captureCommandMock.mockReset();
  });

  describe('nonBlacklistedDistros', () => {
    it('should parse output of wsl.exe --list --verbose correctly', async() => {
      const distros = await integrationManager['nonBlacklistedDistros'];

      distros.sort((a, b) => a.name.localeCompare(b.name, 'en'));
      expect(distros).toMatchObject([
        { name: 'OtherDistro', version: 1 },
        { name: 'Ubuntu', version: 2 },
      ]);
    });

    it('should not output blacklisted distros', async() => {
      const distros = await integrationManager['nonBlacklistedDistros'];

      expect(distros).toHaveLength(2);
      for (const distro of distros) {
        expect(['rancher-desktop-data', 'rancher-desktop']).not.toContain(distro.name);
      }
    });
  });

  describe('supportedDistros', () => {
    it('should only output v2 distros', async() => {
      const distros = await integrationManager['supportedDistros'];

      expect(distros).toHaveLength(1);
      expect(distros).not.toEqual(expect.arrayContaining([expect.objectContaining({ version: 1 })]));
    });
  });

  describe('getStateForIntegration', () => {
    it('should return a string explaining that only v2 distros are supported', async() => {
      const distro = new WSLDistro('Ubuntu', 1);
      const state = await integrationManager['getStateForIntegration'](distro);

      expect(state).toEqual(
        expect.stringMatching(`Rancher Desktop can only integrate with v2 WSL distributions.*`),
      );
    });
  });
});
