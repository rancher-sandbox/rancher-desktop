import WindowsIntegrationManager, { WSLDistro } from '@/integrations/windowsIntegrationManager';

describe('WindowsIntegrationManager', () => {
  let integrationManager: WindowsIntegrationManager;
  let captureCommandMock: jest.SpyInstance<void, any>;
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

  describe('externalDistros', () => {
    it('should parse output of wsl.exe --list --verbose correctly', async() => {
      const distros = await integrationManager['externalDistros'];

      for (const distro of distros) {
        expect(['Ubuntu', 'OtherDistro']).toContain(distro.name);
        if (distro.name === 'Ubuntu') {
          expect(distro.version).toEqual(2);
        } else if (distro.name === 'OtherDistro') {
          expect(distro.version).toEqual(1);
        }
      }
    });

    it('should not output blacklisted distros', async() => {
      const distros = await integrationManager['externalDistros'];

      expect(distros).toHaveLength(2);
      for (const distro of distros) {
        expect(['rancher-desktop-data', 'rancher-desktop']).not.toContain(distro.name);
      }
    });
  });

  describe('validExternalDistros', () => {
    it('should only output v2 distros', async() => {
      const distros = await integrationManager['validExternalDistros'];

      expect(distros).toHaveLength(1);
      for (const distro of distros) {
        expect(distro.version).toEqual(2);
      }
    });
  });

  describe('getStateForIntegration', () => {
    it('should return a string explaining that only v2 distros are supported', async() => {
      const distro = new WSLDistro('Ubuntu', 1);
      const state = await integrationManager['getStateForIntegration'](distro);

      expect(state).toEqual(
        expect.stringMatching(`Rancher Desktop can only integrate with v2 WSL distributions.*`)
      );
    });
  });
});
