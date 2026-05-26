/** @jest-environment node */

import { jest } from '@jest/globals';

import mockModules from '@pkg/utils/testUtils/mockModules';

mockModules({ electron: undefined });

const { default: WindowsIntegrationManager, WSLDistro } = await import('@pkg/integrations/windowsIntegrationManager');

describe('WindowsIntegrationManager', () => {
  let integrationManager: InstanceType<typeof WindowsIntegrationManager>;
  let captureCommandMock: jest.Spied<InstanceType<typeof WindowsIntegrationManager>['captureCommand']>;
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

  describe('runningDistros', () => {
    it('should return a set of running distro names', async() => {
      captureCommandMock.mockImplementation((_opts: any, ...args: string[]) => {
        if (args.includes('--running')) {
          return 'Ubuntu\r\nMyDistro\r\n';
        }

        return wslOutput;
      });

      const running = await integrationManager['runningDistros'];

      expect(running).toEqual(new Set(['Ubuntu', 'MyDistro']));
    });

    it('should return an empty set when no distros are running', async() => {
      captureCommandMock.mockImplementation((_opts: any, ...args: string[]) => {
        if (args.includes('--running')) {
          return '';
        }

        return wslOutput;
      });

      const running = await integrationManager['runningDistros'];

      expect(running).toEqual(new Set());
    });

    it('should return an empty set when the command fails', async() => {
      captureCommandMock.mockImplementation((_opts: any, ...args: string[]) => {
        if (args.includes('--running')) {
          throw new Error('wsl.exe not found');
        }

        return wslOutput;
      });

      const running = await integrationManager['runningDistros'];

      expect(running).toEqual(new Set());
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

    it('should return the settings value for a stopped v2 distro without running wsl --exec', async() => {
      captureCommandMock.mockImplementation((_opts: any, ...args: string[]) => {
        if (args.includes('--running')) {
          return ''; // no distros running
        }

        return wslOutput;
      });

      // Set integration enabled in settings for Ubuntu
      (integrationManager as any).settings = { WSL: { integrations: { Ubuntu: true } } };

      const distro = new WSLDistro('Ubuntu', 2);
      const state = await integrationManager['getStateForIntegration'](distro);

      expect(state).toBe(true);
      // Verify captureCommand was never called with --distribution (i.e., never ran wsl --exec)
      expect(captureCommandMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ distro: 'Ubuntu' }),
        expect.anything(),
      );
    });

    it('should return false for a stopped v2 distro with no settings entry', async() => {
      captureCommandMock.mockImplementation((_opts: any, ...args: string[]) => {
        if (args.includes('--running')) {
          return '';
        }

        return wslOutput;
      });

      const distro = new WSLDistro('Ubuntu', 2);
      const state = await integrationManager['getStateForIntegration'](distro);

      expect(state).toBe(false);
    });
  });
});
