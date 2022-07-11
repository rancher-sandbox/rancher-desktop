// Maintains configuration for all the processes that go over AF_VSOCK Vtunnel

import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

import Logging from '@/utils/logging';
import paths from '@/utils/paths';
import * as childProcess from '@/utils/childProcess';
import BackgroundProcess from '@/utils/backgroundProcess';

const vtunnelConfig = 'vtunnel-config.yaml';
const localHost = '127.0.0.1';
const credServerVsockPort = 17361;
const credServerHandshakePort = 17362;
const credServerPeerPort = 3030;
const credServerPort = '6109';

export class vtunnel {
  vsockProxy = new BackgroundProcess('Credentials Helper Host Proxy', {
    spawn: async() => {
      const executable = path.join(paths.resources, 'win32', 'internal', 'vtunnel.exe');
      const stream = await Logging['vtunnel-host'].fdStream;

      return childProcess.spawn(executable,
        ['host',
          '--config-path', getVtunnelConfigPath()], {
          stdio:       ['ignore', stream, stream],
          windowsHide: true,
        });
    },
  });

  async generateVtunnelConfig() {
    const conf = {
      tunnel: [
        {
          'handshake-port':          credServerHandshakePort,
          'vsock-host-port':         credServerVsockPort,
          'peer-address':            localHost,
          'peer-port':               credServerPeerPort,
          'upstream-server-address': `${ localHost }:${ credServerPort }`,
        }
      ]
    };
    const configYaml = yaml.stringify(conf);

    await fs.promises.writeFile(getVtunnelConfigPath(), configYaml, 'utf8');
  }
}

export function getVtunnelConfigPath(): string {
  return path.join(paths.config, vtunnelConfig);
}
