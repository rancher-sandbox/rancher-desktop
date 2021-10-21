import { AgentOptions as HttpsAgentOptions } from 'https';
import net from 'net';
import tls from 'tls';
import { URL } from 'url';

import { Agent, ClientRequest, RequestOptions, AgentCallbackReturn } from 'agent-base';
import Electron from 'electron';
import HttpProxyAgent from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

import Logging from '@/utils/logging';

const console = Logging.background;

export default class ElectronProxyAgent extends Agent {
  protected session: Electron.Session;

  constructor(options?: HttpsAgentOptions, session?: Electron.Session) {
    super();
    this.options = options || this.options || {};
    this.session = session || Electron.session.defaultSession;
  }

  async callback(req: ClientRequest, opts: RequestOptions): Promise<AgentCallbackReturn> {
    const port = opts.port || (opts.secureEndpoint ? 443 : 80);
    const requestURL = new URL(`${ req.protocol }//${ req.host }:${ port }/${ req.path }`);
    const mergedOptions = Object.assign({}, this.options, opts);

    // proxies is a string as in a proxy auto-config file
    // https://en.wikipedia.org/wiki/Proxy_auto-config
    const proxies = (await this.session.resolveProxy(requestURL.toString())) || 'DIRECT';

    for (const proxy of proxies.split(';').concat(['DIRECT'])) {
      const [__, mode, host] = /\s*(\S+)\s*((?:\S+?:\d+)?)/.exec(proxy) || [];

      switch (mode) {
      case 'DIRECT':
        if (opts.secureEndpoint) {
          const sslOptions = Object.assign({},
            mergedOptions,
            { servername: req.host.replace(/:\d+$/, '') },
          );

          delete sslOptions.path;

          return tls.connect(sslOptions);
        } else {
          return net.connect(mergedOptions);
        }
      case 'SOCKS': case 'SOCKS4': case 'SOCKS5':
        return new CustomSocksProxyAgent(`socks://${ host }`, this.options);
      case 'PROXY': case 'HTTP': case 'HTTPS': {
        const protocol = mode === 'HTTPS' ? 'https' : 'http';
        const proxyURL = `${ protocol }://${ host }`;

        if (opts.secureEndpoint) {
          return new CustomHttpsProxyAgent(proxyURL, this.options);
        } else {
          return HttpProxyAgent(proxyURL);
        }
      }
      default:
        console.log(`Skipping unknown proxy configuration ${ mode } ${ host }`);
      }
    }

    throw new Error('Went past no proxies');
  }
}

class CustomHttpsProxyAgent extends HttpsProxyAgent {
  constructor(proxyURL: string, opts: HttpsAgentOptions) {
    // Use object destructing here to ensure we only get wanted properties.
    const { hostname, port, protocol } = new URL(proxyURL);
    const mergedOpts = Object.assign({}, opts, {
      hostname, port, protocol
    });

    super(mergedOpts);
    this.options = opts;
  }

  callback(req: ClientRequest, opts: RequestOptions): Promise<net.Socket> {
    const mergedOptions = Object.assign({}, this.options, opts);

    return super.callback(req, mergedOptions);
  }
}

class CustomSocksProxyAgent extends SocksProxyAgent {
  constructor(proxyURL: string, opts: HttpsAgentOptions) {
    // Use object destructing here to ensure we only get wanted properties.
    const { hostname, port, protocol } = new URL(proxyURL);
    const mergedOpts = Object.assign({}, opts, {
      hostname, port, protocol
    });

    super(mergedOpts);
    this.options = opts;
  }

  callback(req: ClientRequest, opts: RequestOptions): Promise<net.Socket> {
    const mergedOptions = Object.assign({}, this.options, opts);

    return super.callback(req, mergedOptions);
  }
}
