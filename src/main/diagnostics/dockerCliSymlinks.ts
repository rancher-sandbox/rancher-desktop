import fs from 'fs';
import os from 'os';
import path from 'path';

import paths from '@/utils/paths';

import type { DiagnosticsCategory, DiagnosticsChecker } from './diagnostics';

const CheckDockerCLISymlinks: DiagnosticsChecker = {
  id:         'RD_BIN_SYMLINKS',
  category:   'Utilities' as DiagnosticsCategory,
  applicable: ['darwin', 'linux'].includes(os.platform()),
  async check() {
    const allNames = await fs.promises.readdir(paths.integration, 'utf-8');
    const names = allNames.filter(name => name.startsWith('docker-') && !name.startsWith('docker-credential-'));
    const dockerCliPluginDir = path.join(os.homedir(), '.docker', 'cli-plugins');
    const isInvalid = await Promise.all(names.map(async(name) => {
      try {
        const link = await fs.promises.readlink(path.join(dockerCliPluginDir, name));

        return link !== path.join(paths.integration, name);
      } catch (ex) {
        // Is not a symlink, etc.
        return true;
      }
    }));
    const results = names.filter((_, i) => isInvalid[i]);
    const passed = results.length === 0;
    let description = 'All files under ~/.docker/cli-plugins are symlinks to files in ~/.rd/bin.';

    if (!passed) {
      description = `The following files in ~/.docker/cli-plugins are not symlinks to files in ~/.rd/bin: ${
        results.sort().join(', ') }`;
    }

    return {
      documentation: 'path#rd_bin_symlinks',
      description,
      passed,
      fixes:         [],
    };
  },
};

export default CheckDockerCLISymlinks;
