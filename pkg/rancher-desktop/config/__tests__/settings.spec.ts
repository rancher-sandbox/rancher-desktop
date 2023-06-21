/* eslint object-curly-newline: ["error", {"consistent": true}] */

import fs from 'fs';
import path from 'path';

import _ from 'lodash';
import plist from 'plist';

import * as settings from '../settings';

import { readDeploymentProfiles } from '@pkg/main/deploymentProfiles';
import paths from '@pkg/utils/paths';

class FakeFSError extends Error {
  public message = '';
  public code = '';
  constructor(message: string, code: string) {
    super(message);
    this.message = message;
    this.code = code;
  }
}

enum ProfileTypes {
  None = 'none',
  Unlocked = 'unlocked',
  Locked = 'locked'
}

describe('settings', () => {
  describe('merge', () => {
    test('merges plain objects', () => {
      const input = {
        a: 1,
        b: {
          c: 2, d: 3, e: { f: 4 },
        },
      };
      const changes = { a: 10, b: { c: 20, e: { } } };
      const result = settings.merge(input, changes);

      expect(result).toEqual({
        a: 10,
        b: {
          c: 20, d: 3, e: { f: 4 },
        },
      },
      );
    });
    test('replaces arrays of primitives', () => {
      const input = {
        a: [1, 2, 3, 4, 5], b: 3, c: 5,
      };
      const changes = { a: [1, 3, 5, 7], b: 4 };
      const result = settings.merge(input, changes);

      expect(result).toEqual({
        a: [1, 3, 5, 7], b: 4, c: 5,
      });
    });
    test('removes values set to undefined', () => {
      const input = { a: 1, b: { c: 3, d: 4 } };
      const changes = { b: { c: undefined } };
      const result = settings.merge(input, changes);

      expect(result).toEqual({ a: 1, b: { d: 4 } });
    });
    test('returns merged settings', () => {
      const input = { a: 1 };
      const changes = { a: 2 };
      const result = settings.merge(input, changes);

      expect(result).toBe(input);
      expect(input).toEqual({ a: 2 });
    });
  });

  const fullDefaults = {
    debug:       true,
    application: {
      adminAccess:            false,
      pathManagementStrategy: 'rcfiles',
      window:                 { quitOnClose: true },
      extensions:             {
        installed: {
          bellingham: 'A',
          seattle:    'B',
          olympia:    'C',
          winthrop:   'D',
        },
      },
    },
    containerEngine: {
      allowedImages: {
        enabled:  true,
        patterns: [],
      },
      name: 'moby',
    },
    kubernetes: {
      version: '1.23.15',
      enabled: true,
    },
    WSL: {
      integrations: {
        kingston: false,
        napanee:  false,
        yarker:   true,
        weed:     true,
      },
    },
    portForwarding: { includeKubernetesServices: false },
    diagnostics:    {
      showMuted:   false,
      locked:      true,
      mutedChecks: {
        montreal:          true,
        'riviere du loup': false,
        magog:             false,
      },
    },
    ignorableTestSettings: {
      testTitle:  'test-title',
      testStruct: {
        title:     'tests-struct',
        subStruct: {
          title:  'sub-title',
          locked: true,
          subvar: 'sub-var',
        },
      },
    },
  };

  const jsonProfile = JSON.stringify(fullDefaults);
  const plistProfile = plist.build(fullDefaults);
  const unlockedProfile = {
    ignoreThis:      { soups: ['beautiful', 'vichyssoise'] },
    containerEngine: { name: 'moby' },
    kubernetes:      { version: '1.25.9' },
  };
  const lockedProfile = {
    ignoreThis:      { soups: ['beautiful', 'vichyssoise'] },
    containerEngine: {
      allowedImages: {
        enabled:  true,
        patterns: ['nginx', 'alpine'],
      },
    },
    kubernetes: { version: '1.25.9' },
  };
  const unlockedJSONProfile = JSON.stringify(unlockedProfile);
  const lockedJSONProfile = JSON.stringify(lockedProfile);
  const unlockedPlistProfile = plist.build(unlockedProfile);
  const lockedPlistProfile = plist.build(lockedProfile);

  // Check structural breakage in this file.
  const brokenJSONProfile = jsonProfile.slice(0, jsonProfile.length / 2);
  const brokenPlistProfile = plistProfile.slice(0, plistProfile.length / 2);

  // TODO: Figure out how to implement this on Windows as well
  const describeNotWindows = process.platform === 'win32' ? describe.skip : describe;

  describeNotWindows('profiles', () => {
    const lockedAccessors = ['containerEngine.allowedImages.enabled', 'containerEngine.allowedImages.patterns'];
    let mock: jest.SpiedFunction<typeof fs['readFileSync']>;
    const actualSyncReader = fs.readFileSync;

    beforeEach(() => {
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => { });
      settings.clearSettings();
    });
    afterEach(() => {
      mock.mockRestore();
    });

    /**
     * This mocker is used to intercept a call to `fs.readFileSync` and return a specified profile text,
     * depending on how the mocker is configured.
     *
     * The mocker can do four different things when it's triggered via a call to `fs.readFileSync`:
     *
     * 1. Return the actual text of the requested file
     * 2. Throw an ENOENT exception
     * 3. Return a pre-determined default profile
     * 4. Return a pre-determined locked-field profile
     *
     * The mocker always does option 1 for any file it doesn't care about
     * The mocker always does option 2 for settings.json to trigger use of any default profile
     * For requests for profile files, the mocker looks at its main arguments
     * `useSystemProfile`, and `usePersonalProfile` to determine whether it should return some
     * predetermined text or throw an ENOENT exception. For example, if `useSystemProfile` is `ProfileTypes.None`,
     * then any requests for a system profile file should trigger an ENOENT exception.
     *
     * This is why `createMocker(ProfileTypes.None, ProfileTypes.None) will throw an exception when asked for
     * the text of any profile.
     *
     * And if we want to verify that the system handles invalid files correctly, the `typeToCorrupt` field
     * is used to indicate whether to corrupt a defaults or locked-fields profile. Corrupting involves returning
     * the first half of the predefined text, which causes both json and plist parsers to throw an exception.
     *
     * On Linux, system files are (currently) `/etc/rancher-desktop/{defaults,locked}.json`,
     * while the user files are  `~/.config/rancher-desktop.defaults,locked}.json`
     *
     * macOS plist files:
     * User: `~/Library/Preferences/io.rancherdesktop.profile.{defaults,locked}.plist`
     * System: `/Library/Preferences/io.rancherdesktop.profile.{defaults,locked}.plist`
     *
     * @param useSystemProfile: what to do when a system profile is requested
     * @param usePersonalProfile:  what to do when a user profile is requested
     * @param typeToCorrupt: if 'defaults', when a defaults profile is requested, just return the first half of the text.
     *                       ... similar if it's 'locked'
     */
    function createMocker(useSystemProfile: ProfileTypes, usePersonalProfile: ProfileTypes, typeToCorrupt?: 'defaults'|'locked'): (inputPath: any, unused: any) => any {
      return (inputPath: any, unused: any): any => {
        if (!inputPath.startsWith(paths.deploymentProfileUser) && !inputPath.startsWith(paths.deploymentProfileSystem)) {
          return actualSyncReader(inputPath, unused);
        }
        const action = inputPath.startsWith(paths.deploymentProfileSystem) ? useSystemProfile : usePersonalProfile;

        if (action === ProfileTypes.None || inputPath === path.join(paths.config, 'settings.json')) {
          throw new FakeFSError(`File ${ inputPath } not found`, 'ENOENT');
        }
        const pathInfo = path.parse(inputPath);

        if (!['.json', '.plist'].includes(pathInfo.ext)) {
          return actualSyncReader(inputPath, unused);
        }

        if (pathInfo.base.endsWith('defaults.json')) {
          return typeToCorrupt === 'defaults' ? brokenJSONProfile : jsonProfile;
        }
        if (pathInfo.base.endsWith('defaults.plist')) {
          return typeToCorrupt === 'defaults' ? brokenPlistProfile : plistProfile;
        }
        switch (action) {
        case ProfileTypes.Unlocked:
          // These are effectively empty profiles because the validator removes all the fields.
          // No need to sometimes emulate corruption and return only the first half of the data;
          // this is done when requesting locked fields below.
          if (pathInfo.base.endsWith('locked.json')) {
            return unlockedJSONProfile;
          } else if (pathInfo.base.endsWith('locked.plist')) {
            return unlockedPlistProfile;
          }
          break;
        case ProfileTypes.Locked:
          if (pathInfo.base.endsWith('locked.json')) {
            return typeToCorrupt === 'locked' ? brokenJSONProfile : lockedJSONProfile;
          } else if (pathInfo.base.endsWith('locked.plist')) {
            return typeToCorrupt === 'locked' ? brokenPlistProfile : lockedPlistProfile;
          }
        }
        throw new Error("Shouldn't get here.");
      };
    }

    describe('validation', () => {
      function invalidProfileMessage(basename: string) {
        if (process.platform === 'darwin') {
          return new RegExp(`Error loading plist file .*/io.rancherdesktop.profile.${ basename }.plist`);
        }

        return new RegExp(`Error parsing deployment profile from .*/\\.config/rancher-desktop.${ basename }.json: SyntaxError: Unexpected end of JSON input`);
      }
      test('complains about invalid default values', async() => {
        mock = jest.spyOn(fs, 'readFileSync')
          .mockImplementation(createMocker(ProfileTypes.None, ProfileTypes.Unlocked, 'defaults'));
        await expect(readDeploymentProfiles()).rejects.toThrow(invalidProfileMessage('defaults'));
      });
      test('complains about invalid locked values', async() => {
        mock = jest.spyOn(fs, 'readFileSync')
          .mockImplementation(createMocker(ProfileTypes.None, ProfileTypes.Locked, 'locked'));
        await expect(readDeploymentProfiles()).rejects.toThrow(invalidProfileMessage('locked'));
      });
    });

    describe('locked fields', () => {
      function verifyAllFieldsAreLocked(lockedFields: settings.LockedSettingsType) {
        for (const acc of lockedAccessors) {
          expect(_.get(lockedFields, acc)).toBeTruthy();
        }
      }

      function verifyAllFieldsAreUnlocked(lockedFields: settings.LockedSettingsType) {
        for (const acc of lockedAccessors) {
          expect(_.get(lockedFields, acc)).toBeFalsy();
        }
      }

      describe('when there is no profile', () => {
        beforeEach(() => {
          mock = jest.spyOn(fs, 'readFileSync')
            .mockImplementation(createMocker(ProfileTypes.None, ProfileTypes.None));
        });
        test('all fields are unlocked', async() => {
          const profiles = await readDeploymentProfiles();

          settings.createSettings(profiles);
          settings.updateLockedFields(profiles.locked);
          verifyAllFieldsAreUnlocked(settings.getLockedSettings());
        });
      });
      describe('when there is a profile', () => {
        describe('all possible situations of (system,user) x (locked,unlocked)', () => {
          const testCases: {system: ProfileTypes, user: ProfileTypes, shouldLock: boolean, msg: string}[] = [];

          for (const system of Object.values(ProfileTypes)) {
            for (const user of Object.values(ProfileTypes)) {
              let shouldLock = system === ProfileTypes.Locked;

              if (system === ProfileTypes.None) {
                shouldLock = user === ProfileTypes.Locked;
              }

              const msg = shouldLock ? 'should lock' : 'should not lock';

              testCases.push({
                system, user, shouldLock, msg,
              });
            }
          }
          test.each(testCases)('system profile $system user profile $user $msg',
            async({ system, user, shouldLock }) => {
              mock = jest.spyOn(fs, 'readFileSync')
                .mockImplementation(createMocker(system, user));
              const profiles = await readDeploymentProfiles();

              settings.createSettings(profiles);
              settings.updateLockedFields(profiles.locked);
              if (shouldLock) {
                verifyAllFieldsAreLocked(settings.getLockedSettings());
              } else {
                verifyAllFieldsAreUnlocked(settings.getLockedSettings());
              }
            });
        });
        describe('check profile reading', () => {
          it('preserves hash-like settings', async() => {
            mock = jest.spyOn(fs, 'readFileSync')
              .mockImplementation(createMocker(ProfileTypes.None, ProfileTypes.Unlocked));
            const profiles = await readDeploymentProfiles();
            const expectedDefaults = _.omit(fullDefaults, ['debug', 'ignorableTestSettings', 'diagnostics.locked']);
            const expected = {
              containerEngine: {
                name: 'moby',
              },
              kubernetes: {
                version: '1.25.9',
              },
            };

            expect(profiles.locked).toEqual(expected);
            expect(profiles.defaults).toEqual(expectedDefaults);
          });
        });
      });
    });
  });

  describe('lockableFields', () => {
    test('flattens an object with only allowed-image settings', () => {
      const lockedSettings = {
        containerEngine: {
          allowedImages: {
            enabled:  true,
            patterns: ["Shouldn't see this"],
          },
        },
      };
      const expectedLockedFields = {
        containerEngine: {
          allowedImages: {
            enabled:  true,
            patterns: true,
          },
        },
      };
      const calculatedLockedFields = settings.determineLockedFields(lockedSettings);

      expect(calculatedLockedFields).toEqual(expectedLockedFields);
    });
    test('flattens a complex object', () => {
      const lockedSettings = {
        virtualMachine: {
          memoryInGB: 2,
          numberCPUs: 2,
        },
        containerEngine: {
          allowedImages: {
            enabled:  true,
            patterns: ["Shouldn't see this"],
          },
        },
        kubernetes: { version: '1.2.3' },
      };
      const expectedLockedFields = {
        virtualMachine: {
          memoryInGB: true,
          numberCPUs: true,
        },
        containerEngine: {
          allowedImages: {
            enabled:  true,
            patterns: true,
          },
        },
        kubernetes: { version: true },
      };
      const calculatedLockedFields = settings.determineLockedFields(lockedSettings);

      expect(calculatedLockedFields).toEqual(expectedLockedFields);
    });
    test('flattens an empty object', () => {
      const lockedSettings = { };
      const expectedLockedFields = { };
      const calculatedLockedFields = settings.determineLockedFields(lockedSettings);

      expect(calculatedLockedFields).toEqual(expectedLockedFields);
    });
  });
});
