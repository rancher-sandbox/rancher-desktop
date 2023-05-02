import fs from 'fs';

import _ from 'lodash';

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
    extensions: {
      bellingham: true,
      seattle:    true,
      olympia:    false,
      winthrop:   true,
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
  const plistProfile = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>application</key>
    <dict>
        <key>adminAccess</key>
        <false/>
        <key>pathManagementStrategy</key>
        <string>rcfiles</string>
        <key>window</key>
        <dict>
            <key>quitOnClose</key>
            <true/>
        </dict>
    </dict>
    <key>containerEngine</key>
    <dict>
      <key>allowedImages</key>
      <dict>
        <key>enabled</key>
        <true/>
        <key>not_schema</key>
        <true/>
        <key>patterns</key>
        <array/>
      </dict>
      <key>name</key>
      <string>moby</string>
    </dict>
    <key>debug</key>
    <true/>
    <key>kubernetes</key>
    <dict>
      <key>version</key>
      <string>1.23.15</string>
      <key>enabled</key>
      <true/>
    </dict>
    <key>portForwarding</key>
    <dict>
        <key>includeKubernetesServices</key>
        <false/>
    </dict>
    <key>ignorableTestSettings</key>
    <dict>
      <key>testTitle</key>
      <string>test-title</string>
      <key>testStruct</key>
      <dict>
        <key>title</key>
        <string>test-struct</string>
        <key>subStruct</key>
        <dict>
          <key>title</key>
          <string>sub-title</string>
          <key>locked</key>
          <true/>
          <key>subvar</key>
          <string>sub-var</string>
        </dict>
      </dict>
    </dict>
    <key>debug</key>
    <true/>
    <key>diagnostics</key>
    <dict>
        <key>locked</key>
        <true/>
        <key>mutedChecks</key>
        <dict>
            <key>magog</key>
            <false/>
            <key>montreal</key>
            <true/>
            <key>riviere du loup</key>
            <false/>
        </dict>
        <key>showMuted</key>
        <false/>
    </dict>
    <key>extensions</key>
    <dict>
        <key>bellingham</key>
        <true/>
        <key>olympia</key>
        <false/>
        <key>seattle</key>
        <true/>
        <key>winthrop</key>
        <true/>
    </dict>
    <key>WSL</key>
    <dict>
        <key>integrations</key>
        <dict>
            <key>kingston</key>
            <false/>
            <key>napanee</key>
            <false/>
            <key>weed</key>
            <true/>
            <key>yarker</key>
            <true/>
        </dict>
    </dict>
  </dict>
</plist>`;
  const unlockedJSONProfile = JSON.stringify({
    ignoreThis:      { soups: ['beautiful', 'vichyssoise'] },
    containerEngine: { name: 'should be ignored' },
    kubernetes:      { version: "Shouldn't see this" },
  });
  const lockedJSONProfile = JSON.stringify({
    ignoreThis:      { soups: ['beautiful', 'vichyssoise'] },
    containerEngine: {
      allowedImages: {
        enabled:  true,
        patterns: ['nginx', 'alpine'],
      },
    },
    kubernetes: { version: "Shouldn't see this" },
  });
  const unlockedPlistProfile = `
  <?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>containerEngine</key>
    <dict>
      <key>name</key>
      <string>should be ignored</string>
    </dict>
    <key>kubernetes</key>
    <dict>
      <key>version</key>
      <string>Shouldn't see this</string>
    </dict>
  </dict>
</plist>
`;
  const lockedPlistProfile = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>version</key>
    <integer>4</integer>
    <key>containerEngine</key>
    <dict>
      <key>allowedImages</key>
      <dict>
        <key>enabled</key>
        <true/>
        <key>not_schema</key>
        <true/>
        <key>patterns</key>
        <array>
        <string>nginx</string>
        <string>alpine</string>
        </array>
      </dict>
    </dict>
    <key>kubernetes</key>
    <dict>
      <key>version</key>
      <string>1.23.15</string>
      <key>containerEngine</key>
      <string>moby</string>
      <key>enabled</key>
      <true/>
    </dict>
    <key>testSettings</key>
    <dict>
      <key>testTitle</key>
      <string>test-title</string>
      <key>testStruct</key>
      <dict>
        <key>title</key>
        <string>test-struct</string>
        <key>subStruct</key>
        <dict>
          <key>title</key>
          <string>sub-title</string>
          <key>locked</key>
          <true/>
          <key>subvar</key>
          <string>sub-var</string>
        </dict>
      </dict>
    </dict>
    <key>debug</key>
    <true/>
    <key>diagnostics</key>
    <dict>
      <key>showMuted</key>
      <false/>
      <key>locked</key>
      <true/>
      <key>mutedChecks</key>
      <dict/>
    </dict>
  </dict>
</plist>
  `;
  // TODO: Stop doing this once profiles are implemented on windows
  const describeNotWindows = process.platform === 'win32' ? describe.skip : describe;

  describe('profiles', () => {
    describeNotWindows('locked fields', () => {
      const lockedAccessors = ['containerEngine.allowedImages.enabled', 'containerEngine.allowedImages.patterns'];
      let mock: jest.SpiedFunction<typeof fs['readFileSync']>;
      const actualSyncReader = fs.readFileSync;

      beforeEach(() => {
        jest.spyOn(fs, 'writeFileSync').mockImplementation(() => { });
      });
      afterEach(() => {
        mock.mockRestore();
      });

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

      function createMocker(useSystemProfile: ProfileTypes, usePersonalProfile: ProfileTypes): (inputPath: any, unused: any) => any {
        return (inputPath: any, unused: any): any => {
          if (!inputPath.startsWith(paths.deploymentProfileUser) && !inputPath.startsWith(paths.deploymentProfileSystem)) {
            return actualSyncReader(inputPath, unused);
          }
          const action = inputPath.startsWith(paths.deploymentProfileSystem) ? useSystemProfile : usePersonalProfile;

          if (action === ProfileTypes.None) {
            throw new FakeFSError(`File ${ inputPath } not found`, 'ENOENT');
          }
          if (inputPath.endsWith('defaults.json')) {
            return jsonProfile;
          }
          if (inputPath.endsWith('defaults.plist')) {
            return plistProfile;
          }
          switch (action) {
          case ProfileTypes.Unlocked:
            if (inputPath.endsWith('locked.json')) {
              return unlockedJSONProfile;
            } else if (inputPath.endsWith('locked.plist')) {
              return unlockedPlistProfile;
            }
            break;
          case ProfileTypes.Locked:
            if (inputPath.endsWith('locked.json')) {
              return lockedJSONProfile;
            } else if (inputPath.endsWith('locked.plist')) {
              return lockedPlistProfile;
            }
          }
          throw new Error("Shouldn't get here.");
        };
      }

      describe('when there is no profile', () => {
        beforeEach(() => {
          mock = jest.spyOn(fs, 'readFileSync')
            .mockImplementation(createMocker(ProfileTypes.None, ProfileTypes.None));
        });
        test('all fields are unlocked', async() => {
          const profiles = await readDeploymentProfiles();

          settings.load(profiles);
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

              settings.load(profiles);
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

            expect(profiles.locked).toEqual({ containerEngine: {} });
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
