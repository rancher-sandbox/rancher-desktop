import { ipcRenderer } from 'electron';

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
      const releasePattern = /^(\d+\.\d+)\.\d+$/;

      this.version = releasePattern.exec(version)?.[1] ?? 'next';
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
