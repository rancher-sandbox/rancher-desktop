// Maintains configuration for all the processes that go over AF_VSOCK Vtunnel

import fs from 'fs';
import path from 'path';

import yaml from 'yaml';

import BackgroundProcess from '@pkg/utils/backgroundProcess';
import * as childProcess from '@pkg/utils/childProcess';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';

const vtunnelConfig = 'vtunnel-config.yaml';

/**
 * Configuration Object for Vtunnel Proxy.
 */
export interface VtunnelConfig {
  name: string;
  handshakePort: number;
  vsockHostPort: number;
  peerAddress: string;
  peerPort: number;
  upstreamServerAddress: string;
}

let instance: VTunnel | undefined;

/**
 * Vtunnel is a management and integration class for Vtunnel Proxy of Rancher Desktop.
 */
class VTunnel {
  private _vtunnelConfig: VtunnelConfig[] = [];
  private vsockProxy = new BackgroundProcess('Vtunnel Host Process', {
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

  private async generateConfig() {
    const conf = {
      tunnel: this._vtunnelConfig.map(c => ({
        name:                      c.name,
        'handshake-port':          c.handshakePort,
        'vsock-host-port':         c.vsockHostPort,
        'peer-address':            c.peerAddress,
        'peer-port':               c.peerPort,
        'upstream-server-address': c.upstreamServerAddress,
      })),
    };

    const configYaml = yaml.stringify(conf);

    await fs.promises.writeFile(getVtunnelConfigPath(), configYaml, 'utf8');
  }

  /**
   * addTunnel adds a new configuration to an existing list of configs.
   */
  addTunnel(config: VtunnelConfig) {
    this._vtunnelConfig.push(config);
  }

  /**
   * start generates the final configuration yaml file and starts the
   * Vtunnel Host process.
   */
  async start() {
    try {
      await this.generateConfig();
    } catch (error) {
      console.error(`Failed to generate vtunnel configuration: ${ error }`);

      return;
    }
    this.vsockProxy.start();
  }

  /**
  * stops the vtunnel host process.
  */
  async stop() {
    await this.vsockProxy.stop();
  }
}

/**
 *
 * @returns an instance of Vtunnel singleton class
 */
export function getVtunnelInstance(): VTunnel {
  instance ??= new VTunnel();

  return instance;
}

/**
 *
 * @returns a path to vtunnel configuration
 */
export function getVtunnelConfigPath(): string {
  return path.join(paths.config, vtunnelConfig);
}
