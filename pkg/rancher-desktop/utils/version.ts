import Electron from 'electron';

import { spawnFile } from '@pkg/utils/childProcess';

export function getProductionVersion() {
  try {
    return Electron.app.getVersion();
  } catch (err) {
    console.log(`Can't get app version: ${ err }`);

    return '?';
  }
}

async function getDevVersion() {
  try {
    const { stdout } = await spawnFile('git', ['describe', '--tags'], { stdio: ['ignore', 'pipe', 'inherit'] });

    return stdout.trim();
  } catch (err) {
    console.log(`Can't get app version: ${ err }`);

    return '?';
  }
}

export async function getVersion() {
  if (process.env.RD_MOCK_VERSION) {
    return process.env.RD_MOCK_VERSION;
  }

  if (process.env.NODE_ENV === 'production' || process.env.RD_MOCK_FOR_SCREENSHOTS) {
    return getProductionVersion();
  }

  return await getDevVersion();
}

export function parseDocsVersion(version: string) {
  // Match '1.9.0-tech-preview' (returns '1.9-tech-preview'), but not '1.9.0-123-g1234567' (returns 'next')
  const releasePattern = /^v?(\d+\.\d+)\.\d+(-[a-z].*)?$/;
  const matches = releasePattern.exec(version);

  if (matches) {
    if (matches[2]) {
      return matches[1].concat(matches[2]);
    }

    return matches[1];
  }

  return 'next';
}
