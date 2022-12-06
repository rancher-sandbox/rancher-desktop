import { app } from 'electron';

import { spawnFile } from '@pkg/utils/childProcess';

function getProductionVersion() {
  try {
    return app.getVersion();
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
  if (process.env.NODE_ENV === 'production' || process.env.MOCK_FOR_SCREENSHOTS) {
    return getProductionVersion();
  }

  return await getDevVersion();
}

export function parseDocsVersion(version: string) {
  const releasePattern = /^v?(\d+\.\d+)\.\d+$/;

  return releasePattern.exec(version)?.[1] ?? 'next';
}
