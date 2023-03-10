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
  const jsonProfile = JSON.stringify({
    ignoreThis:      { soups: ['gazpacho', 'turtle'] },
    containerEngine: {
      allowedImages: {
        enabled:  true,
        patterns: ["Shouldn't see this"],
      },
    },
    kubernetes: { version: "Shouldn't see this" },
  });
  const plistProfile = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
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
        <key>containerEngine</key>
        <string>moby</string>
      </dict>
    </dict>
    <key>kubernetes</key>
    <dict>
      <key>version</key>
      <string>1.23.15</string>
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
    <key>kubernetes</key>
    <dict>
      <key>version</key>
      <string>Should be ignored</string>
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
        test('all fields are unlocked', () => {
          const deploymentProfile = readDeploymentProfiles();

          settings.load(deploymentProfile);
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
            ({ system, user, shouldLock }) => {
              mock = jest.spyOn(fs, 'readFileSync')
                .mockImplementation(createMocker(system, user));
              const deploymentProfile = readDeploymentProfiles();

              settings.load(deploymentProfile);
              if (shouldLock) {
                verifyAllFieldsAreLocked(settings.getLockedSettings());
              } else {
                verifyAllFieldsAreUnlocked(settings.getLockedSettings());
              }
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
