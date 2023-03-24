/**
 * This is the preload script that is exposed to extension frontends.
 * It implements the "ddClient" API.
 */

import Electron from 'electron';

import { ipcRenderer } from '@pkg/utils/ipcRenderer';

/* eslint-disable import/namespace -- that rule doesn't work with TypeScript type-only imports. */
import type { v1 } from '@docker/extension-api-client-types';

class Client implements v1.DockerDesktopClient {
  constructor(info: {platform: string, arch: string, hostname: string}) {
    Object.assign(this.host, info);
  }

  extension = {} as v1.Extension;
  desktopUI = {} as v1.DesktopUI;
  host: v1.Host = {
    openExternal: (url: string) => {
      ipcRenderer.send('extensions/open-external', url);
    },
    platform: '<unknown>',
    arch:     '<unknown>',
    hostname: '<unknown>',
  };

  docker = {} as v1.Docker;
}

export default async function initExtensions(): Promise<void> {
  if (document.location.protocol === 'x-rd-extension:') {
    const info = await ipcRenderer.invoke('extension/host-info');
    const ddClient = new Client(info);

    Electron.contextBridge.exposeInMainWorld('ddClient', ddClient);
  } else {
    console.debug(`Not adding extension API to ${ document.location.protocol }`);
  }
}
