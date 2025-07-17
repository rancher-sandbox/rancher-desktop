import { NavItemName } from '@pkg/config/transientSettings';

interface NavItems {
  name:  NavItemName;
  tabs?: string[];
}
const wslTabs: string[] = ['integrations', 'network', 'proxy'];
const vmLinuxTabs: string[] = ['hardware', 'volumes'];
const vmDarwinTabs: string[] = vmLinuxTabs.concat(['network', 'emulation']);

export const preferencesNavItems: NavItems[] = [
  {
    name: 'Application',
    tabs: ['general', 'behavior', 'environment'],
  },
  {
    name: process.platform === 'win32' ? 'WSL' : 'Virtual Machine',
    tabs: process.platform === 'win32' ? wslTabs : ( process.platform === 'linux' ? vmLinuxTabs : vmDarwinTabs ),
  },
  {
    name: 'Container Engine',
    tabs: ['general', 'allowed-images'],
  },
  { name: 'Kubernetes' },
];
