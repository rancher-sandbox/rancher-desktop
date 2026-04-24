import { shell } from 'electron';

import { TransientSettings } from '@pkg/config/transientSettings';

const baseUrl = process.env.RD_DOCS_URL ?? 'https://docs.rancherdesktop.io';

class PreferencesHelp {
  private readonly mapping: Record<string, string> = {
    'Application-behavior':            'ui/preferences/application/behavior',
    'Application-environment':         'ui/preferences/application/environment',
    'Application-general':             'ui/preferences/application/general',
    'Virtual Machine-hardware':        'ui/preferences/virtual-machine/hardware',
    'Virtual Machine-volumes':         'ui/preferences/virtual-machine/volumes',
    'Virtual Machine-network':         'ui/preferences/virtual-machine/network',
    'Virtual Machine-emulation':       'ui/preferences/virtual-machine/emulation',
    'Container Engine-general':        'ui/preferences/container-engine/general',
    'Container Engine-allowed-images': 'ui/preferences/container-engine/allowed-images',
    'WSL-integrations':                'ui/preferences/wsl/integrations',
    'WSL-network':                     'ui/preferences/wsl/network',
    'WSL-proxy':                       'ui/preferences/wsl/proxy',
    Kubernetes:                        'ui/preferences/kubernetes',
  };

  openUrl(): void {
    const { current, currentTabs } = TransientSettings.value.preferences.navItem;
    const tab = currentTabs[current] ? `-${ currentTabs[current] }` : '';
    const key = `${ current }${ tab }`;
    let url = baseUrl;

    if (this.mapping[key]) {
      url += `/${ this.mapping[key] }`;
    }
    shell.openExternal(url);
  }
}

export const Help = {
  preferences: new PreferencesHelp(),
  openUrl() {
    shell.openExternal(baseUrl);
  },
};
