import os from 'os';

import { Architecture, VMBackend } from './backend';
import LimaBackend from './lima';
import MockBackend from './mock';
import WSLBackend from './wsl';

import DockerDirManager from '@/utils/dockerDirManager';

export default function factory(arch: Architecture, dockerDirManager: DockerDirManager): VMBackend {
  const platform = os.platform();

  if (process.env.RD_MOCK_BACKEND === '1') {
    return new MockBackend();
  }

  switch (platform) {
  case 'linux':
    return new LimaBackend(arch, dockerDirManager);
  case 'darwin':
    return new LimaBackend(arch, dockerDirManager);
  case 'win32':
    return new WSLBackend();
  default:
    throw new Error(`OS "${ platform }" is not supported.`);
  }
}
