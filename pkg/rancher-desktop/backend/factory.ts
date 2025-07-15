import os from 'os';

import { Architecture, VMBackend } from './backend';
import LimaKubernetesBackend from './kube/lima';
import WSLKubernetesBackend from './kube/wsl';
import LimaBackend from './lima';
import MockBackend from './mock';
import WSLBackend from './wsl';

import { LimaKubernetesBackendMock, WSLKubernetesBackendMock } from '@pkg/backend/mock_screenshots';

export default function factory(arch: Architecture): VMBackend {
  const platform = os.platform();

  if (process.env.RD_MOCK_BACKEND === '1') {
    return new MockBackend();
  }

  switch (platform) {
  case 'linux':
  case 'darwin':
    return new LimaBackend(arch, (backend: LimaBackend) => {
      if (process.env.RD_MOCK_FOR_SCREENSHOTS) {
        return new LimaKubernetesBackendMock(arch, backend);
      } else {
        return new LimaKubernetesBackend(arch, backend);
      }
    });
  case 'win32':
    return new WSLBackend((backend: WSLBackend) => {
      if (process.env.RD_MOCK_FOR_SCREENSHOTS) {
        return new WSLKubernetesBackendMock(backend);
      } else {
        return new WSLKubernetesBackend(backend);
      }
    });
  default:
    throw new Error(`OS "${ platform }" is not supported.`);
  }
}
