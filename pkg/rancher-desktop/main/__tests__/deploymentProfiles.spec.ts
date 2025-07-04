/* eslint object-curly-newline: ["error", {"consistent": true}] */

import fs from 'fs';
import os from 'os';
import path from 'path';

import * as settings from '@pkg/config/settings';
import { readDeploymentProfiles, validateDeploymentProfile } from '@pkg/main/deploymentProfiles';
import { spawnFile } from '@pkg/utils/childProcess';
import { RecursivePartial } from '@pkg/utils/typeUtils';

const [describeWindows, describeNotWindows] = process.platform === 'win32' ? [describe, describe.skip] : [describe.skip, describe];

describe('deployment profiles', () => {
  describeWindows('windows deployment profiles', () => {
    let testDir = '';
    let regFilePath = '';

    // Note that we can't modify the HKLM hive without admin privileges,
    // so this whole test will just work with the user's HKCU hive.
    const REG_PATH_START = ['SOFTWARE', 'Rancher Desktop'];
    const FULL_REG_PATH_START = ['HKEY_CURRENT_USER'].concat(REG_PATH_START);
    const REGISTRY_PROFILE_PATHS = [REG_PATH_START.concat('TestProfile')];

    const NON_PROFILE_PATH = FULL_REG_PATH_START.join('\\');
    const FULL_PROFILE_PATH = FULL_REG_PATH_START.concat('TestProfile').join('\\');
    const FULL_DEFAULTS_PATH = `${ FULL_PROFILE_PATH }\\Defaults`;
    const FULL_DEFAULTS_PATH_IN_MESSAGE = `HKCU\\${ REG_PATH_START.join('\\') }\\TestProfile\\Defaults`;

    // We *could* write a routine that converts json to reg files, but that's not the point of this test.
    // Better to just hard-wire a few regfiles here.

    const versionHex = `00${ settings.CURRENT_SETTINGS_VERSION.toString(16) }`.slice(-2);
    const defaultsUserRegFile = `Windows Registry Editor Version 5.00

[${ NON_PROFILE_PATH }]

[${ FULL_PROFILE_PATH }]

[${ FULL_DEFAULTS_PATH }]
"version"=dword:${ versionHex }

[${ FULL_DEFAULTS_PATH }\\application]

[${ FULL_DEFAULTS_PATH }\\application]
"Debug"=dword:1
"adminAccess"=dword:0

[${ FULL_DEFAULTS_PATH }\\application\\Telemetry]
"ENABLED"=dword:1

[${ FULL_DEFAULTS_PATH }\\application\\extensions\\installed]
"bellingham"="WA"
"portland"="OR"
"shasta"="CA"
"elko"="NV"

[${ FULL_DEFAULTS_PATH }\\CONTAINERENGINE]
"name"="moby"

[${ FULL_DEFAULTS_PATH }\\containerEngine\\allowedImages]
"patterns"=hex(7):${ stringToMultiStringHexBytes(['edmonton', 'calgary', 'red deer', 'bassano']) }
"enabled"=dword:00000000

[${ FULL_DEFAULTS_PATH }\\wsl]

[${ FULL_DEFAULTS_PATH }\\wsl\\integrations]
"kingston"=dword:0
"napanee"=dword:0
"yarker"=dword:1
"weed"=dword:1

[${ FULL_DEFAULTS_PATH }\\kubernetes]
"version"="867-5309"

[${ FULL_DEFAULTS_PATH }\\diagnostics]
"showmuted"=dword:1

[${ FULL_DEFAULTS_PATH }\\diagnostics\\mutedChecks]
"montreal"=dword:1
"riviere du loup"=dword:0
"magog"=dword:0
`;

    const lockedUserRegFile = `Windows Registry Editor Version 5.00

[${ NON_PROFILE_PATH }]

[${ FULL_PROFILE_PATH }]

[${ FULL_PROFILE_PATH }\\Locked]
"version"=dword:${ versionHex }

[${ FULL_PROFILE_PATH }\\Locked\\containerEngine]

[${ FULL_PROFILE_PATH }\\Locked\\containerEngine\\allowedImages]
"enabled"=dword:00000000
"patterns"=hex(7):${ stringToMultiStringHexBytes(['busybox', 'nginx']) }
`;

    // Deliberate errors in defaults:
    // * Specifying application/updater=1 instead of application/updater/enabled=1
    // * Specifying application/adminAccess/debug=string when it should be 0 or 1
    // * application/debug should be a number, not a string
    // * containerEngine/name should be a string, not a number
    // * containerEngine/allowedImages/patterns should be a list of strings, not a number
    // * containerEngine/allowedImages/enabled should be a boolean, not a string
    // * images/namespace should be a single string, not a multi-SZ string value
    // * wsl/integrations should be a special-purpose object
    // * diagnostics/mutedChecks should be a special-purpose object
    // * kubernetes/version should be a string, not an object

    const incorrectDefaultsUserRegFile = `Windows Registry Editor Version 5.00

[${ NON_PROFILE_PATH }]

[${ FULL_PROFILE_PATH }]

[${ FULL_DEFAULTS_PATH }]
"version"=dword:${ versionHex }

[${ FULL_DEFAULTS_PATH }\\application]

[${ FULL_DEFAULTS_PATH }\\application]
"Debug"="should be a number"
"Updater"=dword:0

[${ FULL_DEFAULTS_PATH }\\application\\adminAccess]
"sudo"=dword:1

[${ FULL_DEFAULTS_PATH }\\application\\Telemetry]
"ENABLED"=dword:1

[${ FULL_DEFAULTS_PATH }\\CONTAINERENGINE]
"name"=dword:5

[${ FULL_DEFAULTS_PATH }\\containerEngine\\allowedImages]
"patterns"=dword:19
"enabled"="should be a boolean"

[${ FULL_DEFAULTS_PATH }\\images]
"namespace"=hex(7):${ stringToMultiStringHexBytes(['busybox', 'nginx']) }

[${ FULL_DEFAULTS_PATH }\\wsl]
"integrations"="should be a sub-object"

[${ FULL_DEFAULTS_PATH }\\kubernetes]

[${ FULL_DEFAULTS_PATH }\\kubernetes\\version]

[${ FULL_DEFAULTS_PATH }\\diagnostics]
"showmuted"=dword:1
"mutedChecks"=dword:42
`;

    const arrayFromSingleStringDefaultsUserRegFile = `Windows Registry Editor Version 5.00

[${ NON_PROFILE_PATH }]

[${ FULL_PROFILE_PATH }]

[${ FULL_DEFAULTS_PATH }]
"version"=dword:${ versionHex }

[${ FULL_DEFAULTS_PATH }\\CONTAINERENGINE]
"name"="moby"

[${ FULL_DEFAULTS_PATH }\\containerEngine\\allowedImages]
"patterns"="hokey smoke!"
`;

    async function clearRegistry() {
      try {
        await spawnFile('reg', ['DELETE', `HKCU\\${ REGISTRY_PROFILE_PATHS[0].join('\\') }`, '/f']);
      } catch {
        // Ignore any errors
      }
    }

    async function installInRegistry(regFileContents: string) {
      await fs.promises.writeFile(regFilePath, regFileContents, { encoding: 'ascii' });
      try {
        await spawnFile('reg', ['IMPORT', regFilePath]);
      } catch (ex: any) {
        // Use expect to display the error message
        expect(ex).toBeNull();
      }
    }

    // Registry multi-stringSZ settings in a reg file are hard to read, so expand them here.
    // e.g.=> ["abc", "def"] would be ucs-2-encoded as '61,00,62,00,63,00,00,00,64,00,65,00,66,00,00,00,00,00'
    // where a null 16-bit word (so two 00 bytes) separate each pair of words and
    // two null 16-bit words ("00 00 00 00") indicate the end of the list
    function stringToMultiStringHexBytes(s: string[]): string {
      const hexBytes = Buffer.from(s.join('\x00'), 'ucs2')
        .toString('hex')
        .split(/(..)/)
        .filter(x => x)
        .join(',');

      return `${ hexBytes },00,00,00,00`;
    }

    beforeEach(async() => {
      const nativeReg = await import('native-reg');
      nativeReg.deleteTree(nativeReg.HKCU, path.join(...(REGISTRY_PROFILE_PATHS[0])));
      testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'regtest-'));
      regFilePath = path.join(testDir, 'import.reg');
    });
    afterEach(async() => {
      await fs.promises.rm(testDir, { force: true, recursive: true });
    });
    // TODO:  Add an `afterAll(clearRegistry)` when we're finished developing.

    describe('profile', () => {
      describe('defaults', () => {
        describe('happy paths', () => {
          const defaultUserProfile: RecursivePartial<settings.Settings> = {
            version:     settings.CURRENT_SETTINGS_VERSION,
            application: {
              debug:       true,
              adminAccess: false,
              telemetry:   { enabled: true },
              extensions:  {
                installed: {
                  bellingham: 'WA',
                  portland:   'OR',
                  shasta:     'CA',
                  elko:       'NV',
                },
              },
            },
            containerEngine: {
              allowedImages: {
                enabled:  false,
                patterns: ['edmonton', 'calgary', 'red deer', 'bassano'],
              },
              name: settings.ContainerEngine.MOBY,
            },
            WSL: {
              integrations: {
                kingston: false,
                napanee:  false,
                yarker:   true,
                weed:     true,
              },
            },
            kubernetes: {
              version: '867-5309',
            },
            diagnostics: {
              showMuted:   true,
              mutedChecks: {
                montreal:          true,
                'riviere du loup': false,
                magog:             false,
              },
            },
          };
          const lockedUserProfile: RecursivePartial<settings.Settings> = {
            version:         settings.CURRENT_SETTINGS_VERSION,
            containerEngine: {
              allowedImages: {
                enabled:  false,
                patterns: ['busybox', 'nginx'],
              },
            },
          };

          describe('no system profiles, no user profiles', () => {
            it('loads nothing', async() => {
              const profile = await readDeploymentProfiles(REGISTRY_PROFILE_PATHS);

              expect(profile.defaults).toEqual({});
              expect(profile.locked).toEqual({});
            });
          });

          describe('no system profiles, both user profiles', () => {
            it('loads both profiles', async() => {
              await clearRegistry();
              await installInRegistry(defaultsUserRegFile);
              await installInRegistry(lockedUserRegFile);
              const profile = await readDeploymentProfiles(REGISTRY_PROFILE_PATHS);

              expect(profile.defaults).toEqual(defaultUserProfile);
              expect(profile.locked).toEqual(lockedUserProfile);
            });
          });

          it('converts a single string into an array', async() => {
            await clearRegistry();
            await installInRegistry(arrayFromSingleStringDefaultsUserRegFile);
            const profile = await readDeploymentProfiles(REGISTRY_PROFILE_PATHS);

            expect(profile.defaults).toMatchObject({
              containerEngine: { allowedImages: { patterns: ['hokey smoke!'] }, name: 'moby' },
            });
          });
        });
        describe('error paths', () => {
          it('loads a bad profile, complains about all the errors, and keeps only valid entries', async() => {
            await clearRegistry();
            await installInRegistry(incorrectDefaultsUserRegFile);
            const expectedErrors = [
              `application\\adminAccess': expecting value of type boolean, got a registry object`,
              `application\\Debug': expecting value of type boolean, got '"should be a number"'`,
              `application\\Updater': expecting value of type object, got a DWORD, value: '0'`,
              `containerEngine\\allowedImages\\patterns': expecting value of type array, got '25'`,
              `containerEngine\\allowedImages\\enabled': expecting value of type boolean, got '"should be a boolean"'`,
              `containerEngine\\name': expecting value of type string, got '5'`,
              `diagnostics\\mutedChecks': expecting value of type object, got a DWORD, value: '66'`,
              `images\\namespace': expecting value of type string, got an array '["busybox","nginx"]'`,
              `kubernetes\\version': expecting value of type string, got a registry object`,
              `WSL\\integrations': expecting value of type object, got a SZ, value: '"should be a sub-object"'`,
            ].map(s => `Error for field '${ FULL_DEFAULTS_PATH_IN_MESSAGE }\\${ s }`);
            let error: Error | undefined;

            try {
              await readDeploymentProfiles(REGISTRY_PROFILE_PATHS);
            } catch (ex: any) {
              error = ex;
            }
            expect(error).toBeInstanceOf(Error);
            expectedErrors.unshift('Error in registry settings:');
            expect((error?.message ?? '').split('\n')).toEqual(expect.arrayContaining(expectedErrors));
          });
        });
      });
    });
  });

  describeNotWindows('non-windows deployment profiles', () => {
    const invalidDefaultProfile = {
      application: {
        debug:                  'should be a boolean',
        updater:                0,
        pathManagementStrategy: 'goose',
        adminAccess:            {
          sudo: true,
        },
      },
      containerEngine: {
        name:          5,
        allowedImages: {
          patterns: 19,
          enabled:  'should be a boolean',
        },
      },
      images: {
        namespace: ['busybox', 'nginx'],
      },
      kubernetes: {
        port: {
          zoo: ['possums', 'snakes', 'otters'],
        },
        version: { },
        enabled: -7,
      },
      diagnostics: {
        showMuted:   [true],
        mutedChecks: 'should be an object',
      },
    };

    test('complains about invalid default values', () => {
      const expectedErrors = [
        'Error in deployment file fake default profile:',
        `Error for field 'application.debug': expecting value of type boolean, got '"should be a boolean"'`,
        `Error for field 'application.updater': expecting value of type object, got '0'`,
        `Error for field 'application.adminAccess': expecting value of type boolean, got '{"sudo":true}'`,
        `Error for field 'containerEngine.name': expecting value of type string, got '5'`,
        `Error for field 'containerEngine.allowedImages.patterns': expecting value of type array, got '19'`,
        `Error for field 'containerEngine.allowedImages.enabled': expecting value of type boolean, got '"should be a boolean"'`,
        `Error for field 'images.namespace': expecting value of type string, got an array ["busybox","nginx"]`,
        `Error for field 'kubernetes.port': expecting value of type number, got '{"zoo":["possums","snakes","otters"]}'`,
        `Error for field 'kubernetes.version': expecting value of type string, got '{}'`,
        `Error for field 'kubernetes.enabled': expecting value of type boolean, got '-7'`,
        `Error for field 'diagnostics.showMuted': expecting value of type boolean, got an array [true]`,
        `Error for field 'diagnostics.mutedChecks': expecting value of type object, got '"should be an object"'`,
      ];
      let error: Error | undefined;

      try {
        validateDeploymentProfile('fake default profile', invalidDefaultProfile, settings.defaultSettings, []);
      } catch (ex: any) {
        error = ex;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error?.message ?? '').split('\n')).toEqual(expect.arrayContaining(expectedErrors));
    });
    test('complains about invalid locked settings', () => {
      const expectedErrors = [
        'Error in deployment file fake locked profile:',
        `Error for field 'containerEngine.allowedImages.patterns': expecting value of type array, got '19'`,
        `Error for field 'containerEngine.allowedImages.enabled': expecting value of type boolean, got '"should be a boolean"'`,
      ];
      let error: Error | undefined;

      try {
        validateDeploymentProfile('fake locked profile', invalidDefaultProfile, settings.defaultSettings, []);
      } catch (ex: any) {
        error = ex;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error?.message ?? '').split('\n')).toEqual(expect.arrayContaining(expectedErrors));
    });
  });
});
