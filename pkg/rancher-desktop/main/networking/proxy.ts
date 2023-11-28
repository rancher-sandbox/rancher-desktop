import Electron from 'electron';
import { ProxyAgent, ProxyAgentOptions } from 'proxy-agent';

import Logging from '@pkg/utils/logging';

const console = Logging.networking;

export default class ElectronProxyAgent extends ProxyAgent {
  constructor(options?: ProxyAgentOptions) {
    super(options);
    this.session = Electron.session.defaultSession;
    this.getProxyForUrl = this.getProxyForUrlElectron.bind(this);
  }

  /**
   * The Electron session to use.
   */
  session: Electron.Session;

  async getProxyForUrlElectron(url: string): Promise<string> {
    const result = await this.session.resolveProxy(url);

    for (const line of result.split(';')) {
      const [, type, proxy] = /^\s*(\S+)\s+(.*?)\s*$/.exec(line) ?? [];

      switch (type) {
      case undefined:
        // Invalid line; skip.
        continue;
      case 'DIRECT':
        // No proxy; return an empty string to mean no proxy.
        return '';
      case 'SOCKS':
      case 'SOCKS5':
        return `socks://${ proxy }`;
      case 'SOCKS4':
        return `socks4a://${ proxy }`;
      case 'PROXY':
      case 'HTTP':
        return `http://${ proxy }`;
      case 'HTTPS':
        return `https://${ proxy }`;
      default:
        console.debug(`Unknown proxy specification ${ line.trim() } skipped.`);
      }
    }

    // If we got no valid lines, just use a direct connection.  This is the case
    // if no proxies are set at all.
    return '';
  }
}
