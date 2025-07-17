/** @jest-environment node */
/* eslint object-curly-newline: ["error", {"consistent": true}] */

import fs from 'fs';
import path from 'path';

import _ from 'lodash';
import plist from 'plist';
import { jest } from '@jest/globals';

import * as settings from '../settings';
import * as settingsImpl from '../settingsImpl';

import { PathManagementStrategy } from '@pkg/integrations/pathManager';
import paths from '@pkg/utils/paths';
import { RecursivePartial } from '@pkg/utils/typeUtils';
import mockModules from '@pkg/utils/testUtils/mockModules';

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

const actualSyncReader = fs.readFileSync;
const modules = mockModules({
  fs: {
    ...fs,
    readFileSync: jest.spyOn(fs, 'readFileSync'),
  }
});

const { readDeploymentProfiles } = await import('@pkg/main/deploymentProfiles');

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
      const result = settingsImpl.merge(input, changes);

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
      const result = settingsImpl.merge(input, changes);

      expect(result).toEqual({
        a: [1, 3, 5, 7], b: 4, c: 5,
      });
    });
    test('removes values set to undefined', () => {
      const input = { a: 1, b: { c: 3, d: 4 } };
      const changes = { b: { c: undefined } };
      const result = settingsImpl.merge(input, changes);

      expect(result).toEqual({ a: 1, b: { d: 4 } });
    });
    test('returns merged settings', () => {
      const input = { a: 1 };
      const changes = { a: 2 };
      const result = settingsImpl.merge(input, changes);

      expect(result).toBe(input);
      expect(input).toEqual({ a: 2 });
    });
  });

  const fullDefaults = {
    version:     settings.CURRENT_SETTINGS_VERSION,
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
      version: '1.29.15',
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
    version:         11,
    ignoreThis:      { soups: ['beautiful', 'vichyssoise'] },
    containerEngine: { name: 'moby' },
    kubernetes:      { version: '1.25.9' },
  };
  const lockedProfile = {
    version:         11,
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

    beforeEach(() => {
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => { });
      settingsImpl.clearSettings();
    });
    afterEach(() => {
      modules.fs.readFileSync.mockRestore();
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
     * while the user files are  `~/.config/rancher-desktop.{defaults,locked}.json`
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

        return new RegExp(`Error parsing deployment profile from .*/\\.config/rancher-desktop.${ basename }.json: SyntaxError: Unterminated string in JSON at position`);
      }
      test('complains about invalid default values', async() => {
        modules.fs.readFileSync
          .mockImplementation(createMocker(ProfileTypes.None, ProfileTypes.Unlocked, 'defaults'));
        await expect(readDeploymentProfiles()).rejects.toThrow(invalidProfileMessage('defaults'));
      });
      test('complains about invalid locked values', async() => {
        modules.fs.readFileSync
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
          modules.fs.readFileSync
            .mockImplementation(createMocker(ProfileTypes.None, ProfileTypes.None));
        });
        test('all fields are unlocked', async() => {
          const profiles = await readDeploymentProfiles();

          settingsImpl.createSettings(profiles);
          settingsImpl.updateLockedFields(profiles.locked);
          verifyAllFieldsAreUnlocked(settingsImpl.getLockedSettings());
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
              modules.fs.readFileSync
                .mockImplementation(createMocker(system, user));
              const profiles = await readDeploymentProfiles();

              settingsImpl.createSettings(profiles);
              settingsImpl.updateLockedFields(profiles.locked);
              if (shouldLock) {
                verifyAllFieldsAreLocked(settingsImpl.getLockedSettings());
              } else {
                verifyAllFieldsAreUnlocked(settingsImpl.getLockedSettings());
              }
            });
        });
        describe('check profile reading', () => {
          it('preserves hash-like settings', async() => {
            modules.fs.readFileSync
              .mockImplementation(createMocker(ProfileTypes.None, ProfileTypes.Unlocked));
            const profiles = await readDeploymentProfiles();
            const expectedDefaults = _.omit(fullDefaults, ['debug', 'ignorableTestSettings', 'diagnostics.locked']);
            const expected: RecursivePartial<settings.Settings> = {
              version:         settings.CURRENT_SETTINGS_VERSION,
              containerEngine: {
                name: settings.ContainerEngine.MOBY,
              },
              experimental: {
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
      const calculatedLockedFields = settingsImpl.determineLockedFields(lockedSettings);

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
      const calculatedLockedFields = settingsImpl.determineLockedFields(lockedSettings);

      expect(calculatedLockedFields).toEqual(expectedLockedFields);
    });
    test('flattens an empty object', () => {
      const lockedSettings = { };
      const expectedLockedFields = { };
      const calculatedLockedFields = settingsImpl.determineLockedFields(lockedSettings);

      expect(calculatedLockedFields).toEqual(expectedLockedFields);
    });
  });

  describe('migrations', () => {
    it("complains about empty settings because there's no version field", () => {
      const s: RecursivePartial<settings.Settings> = {};

      expect(() => {
        settingsImpl.migrateSpecifiedSettingsToCurrentVersion(s, false);
      }).toThrow('updating settings requires specifying an API version, but no version was specified');
    });

    it('complains about a non-numeric version field', () => {
      const s: RecursivePartial<settings.Settings> = { version: 'no way' as unknown as typeof settings.CURRENT_SETTINGS_VERSION };

      expect(() => {
        settingsImpl.migrateSpecifiedSettingsToCurrentVersion(s, false);
      }).toThrow('updating settings requires specifying an API version, but "no way" is not a proper config version');
    });

    it('complains about a negative version field', () => {
      const s: RecursivePartial<settings.Settings> = { version: -7 as unknown as typeof settings.CURRENT_SETTINGS_VERSION };

      expect(() => {
        settingsImpl.migrateSpecifiedSettingsToCurrentVersion(s, false);
      }).toThrow('updating settings requires specifying an API version, but "-7" is not a positive number');
    });

    it('correctly migrates version-9 no-proxy settings', () => {
      const s: RecursivePartial<settings.Settings> = {
        version:      9 as typeof settings.CURRENT_SETTINGS_VERSION,
        experimental: {
          virtualMachine: {
            proxy: {
              noproxy: [' ', '  1.2.3.4   ', '   ', '11.12.13.14  ', '    21.22.23.24'],
            },
          },
        },
      };
      const expected: RecursivePartial<settings.Settings> = {
        version:      settings.CURRENT_SETTINGS_VERSION,
        experimental: {
          virtualMachine: {
            proxy: {
              noproxy: ['1.2.3.4', '11.12.13.14', '21.22.23.24'],
            },
          },
        },
      };

      expect(settingsImpl.migrateSpecifiedSettingsToCurrentVersion(s, false)).toEqual(expected);
    });

    it('correctly migrates earlier no-proxy settings', () => {
      /**
       * This test verifies that we're no longer running into problems when
       * the migrator tries to access the value of a nonexistent property.
       *
       * The bug, issue 5618, was that the migrator erroneously assumed
       * that when users were migrating to version N, they were submitting a settings file
       * that was based on the default settings of version N - 1.
       */
      const s: RecursivePartial<settings.Settings> = {
        version:      1 as typeof settings.CURRENT_SETTINGS_VERSION,
        experimental: {
          virtualMachine: {
            proxy: {
              noproxy: [' ', '  1.2.3.4   ', '   ', '11.12.13.14  ', '    21.22.23.24'],
            },
          },
        },
      };
      const expected: RecursivePartial<settings.Settings> = {
        version:      settings.CURRENT_SETTINGS_VERSION,
        experimental: {
          virtualMachine: {
            proxy: {
              noproxy: ['1.2.3.4', '11.12.13.14', '21.22.23.24'],
            },
          },
        },
      };

      expect(settingsImpl.migrateSpecifiedSettingsToCurrentVersion(s, false)).toEqual(expected);
    });

    it('leaves unrecognized settings unchanged', () => {
      const s: Record<string, any> = {
        version:        1 as typeof settings.CURRENT_SETTINGS_VERSION,
        registeredCows: '2021-05-17T08:57:17 +07:00',
        fluentLatitude: -55.753309,
        grouchyTags:    [
          'moll',
          'in',
          'excitation',
        ],
        funnyFriends: [
          {
            id:   0,
            name: 'Terry Serrano',
          },
          {
            id:   1,
            name: 'Reynolds Rogers',
          },
        ],
        niceGreeting:  'Hello, Bates Middleton! You have 10 unread messages.',
        favoriteFruit: 'banana',
      };
      const expected = _.merge({}, s, { version: settings.CURRENT_SETTINGS_VERSION });

      expect(settingsImpl.migrateSpecifiedSettingsToCurrentVersion(s, false)).toMatchObject(expected);
    });

    it('updates all old settings going back to version 1', () => {
      const s: Record<string, any> = {
        version:    1 as typeof settings.CURRENT_SETTINGS_VERSION,
        kubernetes: {
          rancherMode:     true,
          suppressSudo:    true,
          containerEngine: 'moby',
          hostResolver:    true,
          memoryInGB:      30,
          numberCPUs:      200,
          WSLIntegrations: {
            Ubuntu:   true,
            Debian:   false,
            openSUSE: true,
          },
          experimental: {
            socketVMNet: true,
          },
        },
        debug:                  true,
        pathManagementStrategy: PathManagementStrategy.Manual,
        telemetry:              false,
        updater:                true,
      };
      const expected: RecursivePartial<settings.Settings> = {
        version:     settings.CURRENT_SETTINGS_VERSION,
        application: {
          adminAccess:            false,
          debug:                  true,
          pathManagementStrategy: PathManagementStrategy.Manual,
          telemetry:              {
            enabled: false,
          },
          updater: {
            enabled: true,
          },
        },
        containerEngine: {
          name: settings.ContainerEngine.MOBY,
        },
        experimental: {
        },
        kubernetes:     {},
        virtualMachine: {
          memoryInGB: 30,
          numberCPUs: 200,
        },
        WSL: {
          integrations: {
            Ubuntu:   true,
            Debian:   false,
            openSUSE: true,
          },
        },
      };

      expect(settingsImpl.migrateSpecifiedSettingsToCurrentVersion(s, false)).toEqual(expected);
    });

    describe('migrates from step to step', () => {
      const expectedMigrations: Record<number, [any, any]> = {
        1: [
          {
            kubernetes: {
              rancherMode: 'cattle',
            },
          },
          {
            kubernetes: {},
          },
        ],
        2: [{ cows: 4 }, { cows: 4 }],
        3: [{ fish: 5 }, { fish: 5 }],
        4: [
          {
            kubernetes: {
              suppressSudo: true,
              memoryInGB:   300,
              numberCPUs:   45,
              experimental: {
                socketVMNet: true,
              },
              WSLIntegrations: {
                ubuntu: true,
                debian: false,
              },
              containerEngine: settings.ContainerEngine.MOBY,
            },
            debug:                  true,
            pathManagementStrategy: 'manual',
            telemetry:              true,
            updater:                true,
          },
          {
            kubernetes:  {},
            application: {
              adminAccess:            false,
              debug:                  true,
              pathManagementStrategy: PathManagementStrategy.Manual,
              telemetry:              { enabled: true },
              updater:                { enabled: true },
            },
            virtualMachine: {
              memoryInGB: 300,
              numberCPUs: 45,
            },
            experimental: {
              virtualMachine: {
                socketVMNet: true,
              },
            },
            WSL: {
              integrations: {
                ubuntu: true,
                debian: false,
              },
            },
            containerEngine: {
              name: settings.ContainerEngine.MOBY,
            },
          },
        ],
        5: [
          {
            containerEngine: {
              imageAllowList: {
                enabled:  true,
                patterns: ['wolves', 'lower'],
              },
            },
            virtualMachine: {
              experimental: {
                socketVMNet: true,
              },
            },
            autoStart:            true,
            hideNotificationIcon: true,
            window:               false,
          },
          {
            containerEngine: {
              allowedImages: {
                enabled:  true,
                patterns: ['wolves', 'lower'],
              },
            },
            experimental: {
              virtualMachine: { socketVMNet: true },
            },
            application: {
              autoStart:            true,
              hideNotificationIcon: true,
              window:               false,
            },
            virtualMachine: {},
          },
        ],
        6: [
          {
            extensions: {
              'mice:oldest':   true,
              'cats:youngest': false,
            },
          },
          {
            extensions: {
              mice: 'oldest',
            },
          },
        ],
        7: [
          { application: { pathManagementStrategy: 'notset' } },
          {
            application: {
              pathManagementStrategy: process.platform === 'win32' ? PathManagementStrategy.Manual : PathManagementStrategy.RcFiles,
            },
          },
        ],
        8: [
          {
            extensions: { mice: 'oldest' },
          },
          {
            application: {
              extensions: {
                installed: { mice: 'oldest' },
              },
            },
          },
        ],
        9: [
          {
            experimental: {
              virtualMachine: {
                proxy: {
                  noproxy: ['    ', '   mangoes', 'yucca   ', '   ', ' guava '],
                },
              },
            },
          },
          {
            experimental: {
              virtualMachine: {
                proxy: {
                  noproxy: ['mangoes', 'yucca', 'guava'],
                },
              },
            },
          },
        ],
        11: [
          {
            experimental: {
              virtualMachine: {
                socketVMNet: true,
              },
            },
          },
          {
            experimental: {},
          },
        ],
      };

      it.each(Object.entries(expectedMigrations))('migrate from %i', (version, beforeAndAfter) => {
        const [fromSettings, toSettings] = beforeAndAfter;
        const existingVersion = parseInt(version, 10);
        const targetVersion = existingVersion + 1;

        fromSettings.version = existingVersion;
        toSettings.version = targetVersion;
        expect(settingsImpl.migrateSpecifiedSettingsToCurrentVersion(fromSettings, false, targetVersion)).toEqual(toSettings);
      });
    });
  });
});
