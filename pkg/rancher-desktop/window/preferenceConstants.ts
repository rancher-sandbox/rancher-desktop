import { NavItemName } from '@pkg/config/transientSettings';

export interface NavItems {
  name:     NavItemName;
  labelKey: string;
  tabs?:    string[];
}
const wslTabs: string[] = ['integrations', 'network', 'proxy'];
const vmLinuxTabs: string[] = ['hardware', 'volumes'];
const vmDarwinTabs: string[] = vmLinuxTabs.concat(['network', 'emulation']);

export const preferencesNavItems: NavItems[] = [
  {
    name:     'Application',
    labelKey: 'preferences.nav.application',
    tabs:     ['general', 'behavior', 'environment'],
  },
  {
    name:     process.platform === 'win32' ? 'WSL' : 'Virtual Machine',
    labelKey: process.platform === 'win32' ? 'preferences.nav.wsl' : 'preferences.nav.virtualMachine',
    tabs:     process.platform === 'win32' ? wslTabs : ( process.platform === 'linux' ? vmLinuxTabs : vmDarwinTabs ),
  },
  {
    name:     'Container Engine',
    labelKey: 'preferences.nav.containerEngine',
    tabs:     ['general', 'allowed-images'],
  },
  { name: 'Kubernetes', labelKey: 'preferences.nav.kubernetes' },
];
