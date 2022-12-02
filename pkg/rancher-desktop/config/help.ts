import { shell } from 'electron';

import { TransientSettings } from '@pkg/config/transientSettings';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';
import { parseDocsVersion } from '@pkg/utils/version';

type Paths = Record<string, string>;

class Url {
  private readonly baseUrl = 'https://docs.rancherdesktop.io';
  private paths: Paths = {};
  private version = 'next';

  constructor(paths: Paths) {
    this.paths = paths;

    ipcRenderer.on('get-app-version', (_event, version) => {
      this.version = parseDocsVersion(version);
    });

    ipcRenderer.send('get-app-version');
  }

  buildUrl(key: string | undefined): string {
    if (key) {
      return `${ this.baseUrl }/${ this.version }/${ this.paths[key] }`;
    }

    return '';
  }
}

class PreferencesHelp {
  private readonly url = new Url({
    Application:                       'ui/preferences/application',
    'Application-behavior':            'ui/preferences/application#behavior',
    'Application-environment':         'ui/preferences/application#environment',
    'Virtual Machine':                 'ui/preferences/virtual-machine',
    'Container Engine-general':        'ui/preferences/container-engine#general',
    'Container Engine-allowed-images': 'ui/preferences/container-engine#allowed-images',
    WSL:                               'ui/preferences/wsl',
    Kubernetes:                        'ui/preferences/kubernetes',
  });

  openUrl(): void {
    const { current, currentTabs } = TransientSettings.value.preferences.navItem;
    const tab = currentTabs[current] ? `-${ currentTabs[current] }` : '';

    const url = this.url.buildUrl(`${ current }${ tab }`);

    shell.openExternal(url);
  }
}

class HelpImpl {
  readonly preferences = new PreferencesHelp();
}

export const Help = new HelpImpl();
