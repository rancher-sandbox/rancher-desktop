import semver from 'semver';

import { BackendSettings } from '@pkg/backend/backend';
import { KubeClient, ServiceEntry } from '@pkg/backend/kube/client';
import LimaKubernetesBackend from '@pkg/backend/kube/lima';
import WSLKubernetesBackend from '@pkg/backend/kube/wsl';

export class LimaKubernetesBackendMock extends LimaKubernetesBackend {
  start(config_: BackendSettings, kubernetesVersion: semver.SemVer): Promise<string> {
    return super.start(config_, kubernetesVersion, () => new KubeClientMock());
  }
}

export class WSLKubernetesBackendMock extends WSLKubernetesBackend {
  start(config_: BackendSettings, kubernetesVersion: semver.SemVer): Promise<string> {
    return super.start(config_, kubernetesVersion, () => new KubeClientMock());
  }
}

class KubeClientMock extends KubeClient {
  listServices(namespace: string | undefined = undefined): ServiceEntry[] {
    return [{
      namespace:  'default',
      name:       'nginx',
      portName:   'http',
      port:       8080,
      listenPort: 30001,
    }, {
      namespace: 'default',
      name:      'wordpress',
      portName:  'http',
      port:      8080,
    }, {
      namespace: 'default',
      name:      'wordpress',
      portName:  'https',
      port:      443,
    }];
  }
}
