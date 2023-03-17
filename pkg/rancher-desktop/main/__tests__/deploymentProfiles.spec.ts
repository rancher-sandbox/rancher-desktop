/* eslint object-curly-newline: ["error", {"consistent": true}] */

import fs from 'fs';
import os from 'os';
import path from 'path';

import * as settings from '@pkg/config/settings';
import { readDeploymentProfiles } from '@pkg/main/deploymentProfiles';
import { spawnFile } from '@pkg/utils/childProcess';
import Logging from '@pkg/utils/logging';
import { RecursivePartial } from '@pkg/utils/typeUtils';

// for some reason `import nativeReg...` => undefined when run in jest on Windows
// import nativeReg from 'native-reg';
const nativeReg = require('native-reg');

const console = Logging.deploymentProfile;

// Note that we can't modify the HKLM hive without admin privileges,
// so this whole test will just work with the user's HKCU hive.
const REG_PATH_START = ['SOFTWARE', 'Rancher Desktop'];
const FULL_REG_PATH_START = ['HKEY_CURRENT_USER'].concat(REG_PATH_START);
const REGISTRY_PATH_PROFILE = REG_PATH_START.concat('TestProfile');

const NON_PROFILE_PATH = FULL_REG_PATH_START.join('\\');
const FULL_PROFILE_PATH = FULL_REG_PATH_START.concat('TestProfile').join('\\');

const describeWindows = process.platform === 'win32' ? describe : describe.skip;

let testDir = '';
let regFilePath = '';

async function clearRegistry() {
  try {
    await spawnFile('reg', ['DELETE', `HKCU\\${ REGISTRY_PATH_PROFILE.join('\\') }`, '/f']);
  } catch {
    // Ignore any errors
  }
}

async function installInRegistry(regFileContents: string) {
  const BOM = ''; // \uFEFF';

  await fs.promises.writeFile(regFilePath, BOM + regFileContents, { encoding: 'latin1' });
  try {
    await spawnFile('reg', ['IMPORT', regFilePath]);
  } catch (ex: any) {
    expect(ex).toMatchObject({});
    throw ex;
  }
}

// Registry multi-stringSZ settings in a reg file are hard to read, so expand them here.
// e.g.=> ["abc", "def"] would be ucs-2-encoded as '61,00,62,00,63,00,00,00,64,00,65,00,66,00,00,00,00,00'
// where null dwords (so two 00 bytes) separate each pair of words and
// two null dwords ("00 00 00 00") indicate the end of the list
function stringToMultiStringHexBytes(s: string[]): string {
  const hexBytes = Buffer.from(s.join('\x00'), 'ucs2')
    .toString('hex')
    .split(/(..)/)
    .filter(x => x)
    .join(',');

  return `${ hexBytes },00,00,00,00`;
}

// We *could* write a routine that converts json to reg files, but that's not the point of this test.
// Better to just hard-wire a few regfiles here.

const defaultsUserRegFile = `Windows Registry Editor Version 5.00

[${ NON_PROFILE_PATH }]

[${ FULL_PROFILE_PATH }]

[${ FULL_PROFILE_PATH }\\Defaults]

[${ FULL_PROFILE_PATH }\\Defaults\\application]

[${ FULL_PROFILE_PATH }\\Defaults\\application]
"Debug"=dword:1
"adminAccess"=dword:0

[${ FULL_PROFILE_PATH }\\Defaults\\application\\Telemetry]
"ENABLED"=dword:1

[${ FULL_PROFILE_PATH }\\Defaults\\CONTAINERENGINE]
"name"="moby"

[${ FULL_PROFILE_PATH }\\Defaults\\containerEngine\\allowedImages]
"patterns"=hex(7):${ stringToMultiStringHexBytes(['edmonton', 'calgary', 'red deer', 'bassano']) }
"enabled"=dword:00000000

[${ FULL_PROFILE_PATH }\\Defaults\\wsl]

[${ FULL_PROFILE_PATH }\\Defaults\\wsl\\integrations]
"kingston"=dword:0
"napanee"=dword:0
"yarker"=dword:1
"weed"=dword:1

[${ FULL_PROFILE_PATH }\\Defaults\\kubernetes]
"version"="867-5309"

[${ FULL_PROFILE_PATH }\\Defaults\\diagnostics]
"showmuted"=dword:1

[${ FULL_PROFILE_PATH }\\Defaults\\diagnostics\\mutedChecks]
"montreal"=dword:1
"riviere du loup"=dword:0
"magog"=dword:0

[${ FULL_PROFILE_PATH }\\Defaults\\extensions]
"bellingham"="WA"
"portland"="OR"
"shasta"="CA"
"elko"="NV"
`;

const lockedUserRegFile = `Windows Registry Editor Version 5.00

[${ NON_PROFILE_PATH }]

[${ FULL_PROFILE_PATH }]

[${ FULL_PROFILE_PATH }\\Locked]

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

[${ FULL_PROFILE_PATH }\\Defaults]

[${ FULL_PROFILE_PATH }\\Defaults\\application]

[${ FULL_PROFILE_PATH }\\Defaults\\application]
"Debug"="should be a number"
"Updater"=dword:0

[${ FULL_PROFILE_PATH }\\Defaults\\application\\adminAccess]
"sudo"=dword:1

[${ FULL_PROFILE_PATH }\\Defaults\\application\\Telemetry]
"ENABLED"=dword:1

[${ FULL_PROFILE_PATH }\\Defaults\\CONTAINERENGINE]
"name"=dword:5

[${ FULL_PROFILE_PATH }\\Defaults\\containerEngine\\allowedImages]
"patterns"=DWORD:19
"enabled"="should be a boolean"

[${ FULL_PROFILE_PATH }\\Defaults\\images]
"namespace"=hex(7):${ stringToMultiStringHexBytes(['busybox', 'nginx']) }

[${ FULL_PROFILE_PATH }\\Defaults\\wsl]
"integrations"="should be a sub-object"

[${ FULL_PROFILE_PATH }\\Defaults\\kubernetes]

[${ FULL_PROFILE_PATH }\\Defaults\\kubernetes\\version]

[${ FULL_PROFILE_PATH }\\Defaults\\diagnostics]
"showmuted"=dword:1
"mutedChecks"=dword:42
`;

const arrayFromSingleStringDefaultsUserRegFile = `Windows Registry Editor Version 5.00

[${ NON_PROFILE_PATH }]

[${ FULL_PROFILE_PATH }]

[${ FULL_PROFILE_PATH }\\Defaults]

[${ FULL_PROFILE_PATH }\\Defaults\\CONTAINERENGINE]
"name"="moby"

[${ FULL_PROFILE_PATH }\\Defaults\\containerEngine\\allowedImages]
"patterns"="hokey smoke!"
`;

describeWindows('windows deployment profiles', () => {
  /* Mock console.error() to capture error messages. */
  let consoleMock: jest.SpyInstance<void, [message?: any, ...optionalArgs: any[]]>;

  beforeEach(async() => {
    nativeReg.deleteTree(nativeReg.HKCU, path.join(...(REGISTRY_PATH_PROFILE)));
    testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'regtest-'));
    regFilePath = path.join(testDir, 'import.reg');
    consoleMock = jest.spyOn(console, 'error');
  });
  afterEach(async() => {
    await fs.promises.rm(testDir, { force: true, recursive: true });
    consoleMock.mockReset();
  });
  // TODO:  Add an `afterAll(clearRegistry)` when we're finished developing.

  describe('profile', () => {
    describe('defaults', () => {
      describe('happy paths', () => {
        const defaultUserProfile: RecursivePartial<settings.Settings> = {
          application: {
            debug:       true,
            adminAccess: false,
            telemetry:   { enabled: true },
          },
          containerEngine: {
            allowedImages: {
              enabled:  false,
              patterns: ['edmonton', 'calgary', 'red deer', 'bassano'],
            },
            name: settings.ContainerEngine.MOBY,
          },
          WSL:        { integrations: { kingston: false, napanee: false, yarker: true, weed: true } },
          kubernetes: {
            version: '867-5309',
          },
          diagnostics: {
            showMuted:   true,
            mutedChecks: { montreal: true, 'riviere du loup': false, magog: false },
          },
          extensions: { bellingham: 'WA', portland: 'OR', shasta: 'CA', elko: 'NV' },
        };
        const lockedUserProfile = {
          containerEngine: {
            allowedImages: {
              enabled:  false,
              patterns: ['busybox', 'nginx'],
            },
          },
        };

        describe('no system profiles, no user profiles', () => {
          it('loads nothing', async() => {
            const profile = await readDeploymentProfiles(REGISTRY_PATH_PROFILE);

            expect(profile.defaults).toMatchObject({});
            expect(profile.locked).toMatchObject({});
          });
        });

        describe('no system profiles, both user profiles', () => {
          it('loads both profiles', async() => {
            await clearRegistry();
            await installInRegistry(defaultsUserRegFile);
            await installInRegistry(lockedUserRegFile);
            const profile = await readDeploymentProfiles(REGISTRY_PATH_PROFILE);

            expect(profile.defaults).toMatchObject(defaultUserProfile);
            expect(profile.locked).toMatchObject(lockedUserProfile);
          });
        });

        it('converts a single string into an array', async() => {
          await clearRegistry();
          await installInRegistry(arrayFromSingleStringDefaultsUserRegFile);
          const profile = await readDeploymentProfiles(REGISTRY_PATH_PROFILE);

          expect(profile.defaults).toMatchObject({
            containerEngine: { allowedImages: { patterns: ['hokey smoke!'] } },
          });
        });
      });
      describe('error paths', () => {
        const limitedUserProfile = {
          application: {
            telemetry: { enabled: true },
          },
          diagnostics: {
            showMuted: true,
          },
        };

        it('loads a bad profile, complains about all the errors, and keeps only valid entries', async() => {
          await clearRegistry();
          await installInRegistry(incorrectDefaultsUserRegFile);
          const profile = await readDeploymentProfiles(REGISTRY_PATH_PROFILE);

          expect(profile.defaults).toMatchObject(limitedUserProfile);
          // Remember that sub-objects are processed before values
          expect(consoleMock).toHaveBeenNthCalledWith(1,
            expect.stringMatching(/Expecting registry entry .*?application.adminAccess to be a boolean, but it's a registry object/),
          );
          expect(consoleMock).toHaveBeenNthCalledWith(2,
            expect.stringMatching(/Expecting registry entry .*?application.Debug to be a boolean, but it's a SZ/));
          expect(consoleMock).toHaveBeenNthCalledWith(3,
            expect.stringMatching(/Expecting registry entry .*?application.Updater to be a registry object, but it's a DWORD, value: 0/));
          expect(consoleMock).toHaveBeenNthCalledWith(4,
            expect.stringMatching(/Expecting registry entry .*?containerEngine.allowedImages.enabled to be a boolean, but it's a SZ, value: should be a boolean/));
          expect(consoleMock).toHaveBeenNthCalledWith(5,
            expect.stringMatching(/Expecting registry entry .*?containerEngine.name to be a string, but it's a DWORD, value: 5/));
          expect(consoleMock).toHaveBeenNthCalledWith(6,
            expect.stringMatching(/Expecting registry entry .*?diagnostics.mutedChecks to be a registry object, but it's a DWORD, value: 66/));
          expect(consoleMock).toHaveBeenNthCalledWith(7,
            expect.stringMatching(/Expecting registry entry .*?images.namespace to be a single string, but it's an array of strings, value: busybox,nginx/));
          expect(consoleMock).toHaveBeenNthCalledWith(8,
            expect.stringMatching(/Expecting registry entry .*?kubernetes.version to be a string, but it's a registry object/));
          expect(consoleMock).toHaveBeenNthCalledWith(9,
            expect.stringMatching(/Expecting registry entry .*?WSL.integrations to be a registry object, but it's a SZ, value: should be a sub-object/));
        });
      });
    });
  });
});
