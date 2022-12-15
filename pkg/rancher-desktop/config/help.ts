import { ipcRenderer } from '@pkg/utils/ipcRenderer';
import { parseDocsVersion } from '@pkg/utils/version';

const baseUrl = 'https://docs.rancherdesktop.io';

const paths: Record<string, string> = {
  Application:                       'ui/preferences/application',
  'Application-behavior':            'ui/preferences/application#behavior',
  'Application-environment':         'ui/preferences/application#environment',
  'Virtual Machine':                 'ui/preferences/virtual-machine',
  'Container Engine-general':        'ui/preferences/container-engine#general',
  'Container Engine-allowed-images': 'ui/preferences/container-engine#allowed-images',
  WSL:                               'ui/preferences/wsl',
  Kubernetes:                        'ui/preferences/kubernetes',
};

class HelpImpl {
  private version = 'next';

  constructor() {
    ipcRenderer.on('get-app-version', (_event, version) => {
      this.version = parseDocsVersion(version);
    });

    ipcRenderer.send('get-app-version');
  }

  url(key: string | undefined): string {
    if (key) {
      return `${ baseUrl }/${ this.version }/${ paths[key] }`;
    }

    return '';
  }
}

export const Help = new HelpImpl();
