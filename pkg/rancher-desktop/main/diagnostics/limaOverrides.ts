import fs from 'node:fs';
import path from 'node:path';

import yaml from 'yaml';

import { DiagnosticsCategory, DiagnosticsChecker, DiagnosticsCheckerSingleResult } from './types';

import paths from '@pkg/utils/paths';

/**
 * Check for things in the user's Lima overrides file.  We never create the file
 * ourselves, but the user may manually create it to adjust how Lima runs; it
 * may end up conflicting with what we attempt to do.
 */
const CheckLimaOverrides: DiagnosticsChecker = {
  id:       'LIMA_OVERRIDES',
  category: DiagnosticsCategory.ContainerEngine,
  applicable() {
    return Promise.resolve(process.platform !== 'win32');
  },
  async check() {
    const overridePath = path.join(paths.lima, '_config', 'override.yaml');
    const checkers = {
      /**
       * Check if the user has an override for the lima disk size.  We have built-in
       * support for the feature now, and overrides would cause our settings to be
       * ignored.
       */
      DISK_SIZE: (override) => {
        if ('disk' in override) {
          return {
            description: `Disk overrides are set in Lima override file \`${ overridePath }\``,
            passed:      false,
            fixes:       [{
              description: `Remove Lima override file \`${ overridePath }\``,
            }],
          };
        }
        return {
          description: `Disk size override not specified in Lima override file \`${ overridePath }\``,
          passed:      true,
          fixes:       [],
        };
      },
    } satisfies Record<string, (override: any) => Omit<DiagnosticsCheckerSingleResult, 'id'>>;
    const override = await (async function() {
      try {
        return yaml.parse(await fs.promises.readFile(overridePath, 'utf-8'));
      } catch {
        return undefined;
      }
    })();

    if (!override || typeof override !== 'object') {
      // Override file does not exist, or is not valid YAML
      return Object.keys(checkers).map(id => ({
        id,
        description: `Override file \`${ overridePath }\` not loaded`,
        passed:      true,
        fixes:       [],
      }));
    }

    return Object.entries(checkers).map(([id, checker]) => ({
      id,
      ...checker(override),
    }));
  },
};

export default CheckLimaOverrides;
