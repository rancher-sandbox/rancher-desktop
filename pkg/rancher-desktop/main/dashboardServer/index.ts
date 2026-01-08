import { Server } from 'http';
import net from 'net';
import path from 'path';

import express from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';

import { proxyWsOpts, proxyOpts } from './proxyUtils';

import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';

const ProxyKeys = ['/k8s', '/pp', '/api', '/apis', '/v1', '/v3', '/v3-public', '/api-ui', '/meta', '/v1-*etc'] as const;

type ProxyKeys = typeof ProxyKeys[number];

const console = Logging.dashboardServer;

/**
 * Singleton that manages the lifecycle of the Dashboard server.
 */
export class DashboardServer {
  private static instance: DashboardServer;

  private dashboardServer = express();
  private dashboardApp: Server = new Server();
  private host = '127.0.0.1';
  private port = 6120;
  private api = 'https://127.0.0.1:9443';

  private proxies = (() => {
    const proxy: Record<ProxyKeys, Options> = {
      '/k8s':       proxyWsOpts, // Straight to a remote cluster (/k8s/clusters/<id>/)
      '/pp':        proxyWsOpts, // For (epinio) standalone API
      '/api':       proxyWsOpts, // Management k8s API
      '/apis':      proxyWsOpts, // Management k8s API
      '/v1':        proxyWsOpts, // Management Steve API
      '/v3':        proxyWsOpts, // Rancher API
      '/api-ui':    proxyOpts, // Browser API UI
      '/v3-public': proxyOpts, // Rancher Unauthed API
      '/meta':      proxyOpts, // Browser API UI
      '/v1-*etc':   proxyOpts, // SAML, KDM, etc
    };
    const entries = Object.entries(proxy).map(([key, options]) => {
      return [key, createProxyMiddleware({ ...options, target: this.api + key })] as const;
    });

    return Object.fromEntries(entries);
  })();

  /**
   * Checks for an existing instance of Dashboard server.
   * Instantiate a new one if it does not exist.
   */
  public static getInstance(): DashboardServer {
    DashboardServer.instance ??= new DashboardServer();

    return DashboardServer.instance;
  }

  /**
   * Starts the Dashboard server if one is not already running.
   */
  public init() {
    if (this.dashboardApp.address()) {
      console.log(`Dashboard Server is already listening on ${ this.host }:${ this.port }`);

      return;
    }

    ProxyKeys.forEach((key) => {
      this.dashboardServer.use(key, this.proxies[key]);
    });

    this.dashboardApp = this.dashboardServer
      // handle static assets, e.g. image, icons, fonts, and index.html
      .use(
        express.static(
          path.join(paths.resources, 'rancher-dashboard'),
        ))
      /**
       * Handle all routes that we don't account for, return index.html and let
       * Vue router take over.
       */
      .get(
        '*missing',
        (_req, res) => {
          // Send the dashboard index file relative to the resources path, to
          // avoid Express checking the (not in our case) user-controlled path
          // containing hidden directories.  We do not need a rate limit here
          // because this is all the local user triggering requests.
          res.sendFile('rancher-dashboard/index.html', { root: paths.resources });
        })
      .listen(this.port, this.host)
      .on('upgrade', (req, socket, head) => {
        if (!(socket instanceof net.Socket)) {
          console.log(`Invalid upgrade for ${ req.url }`);

          return;
        }

        if (req.url?.startsWith('/v1')) {
          return this.proxies['/v1'].upgrade(req, socket, head);
        } else if (req.url?.startsWith('/v3')) {
          return this.proxies['/v3'].upgrade(req, socket, head);
        } else if (req.url?.startsWith('/k8s/')) {
          return this.proxies['/k8s'].upgrade(req, socket, head);
        } else if (req.url?.startsWith('/api/')) {
          return this.proxies['/api'].upgrade(req, socket, head);
        } else {
          console.log(`Unknown Web socket upgrade request for ${ req.url }`);
        }
      });
  }

  /**
   * Stop the Dashboard server.
   */
  public stop() {
    if (!this.dashboardApp.address()) {
      return;
    }

    this.dashboardApp.close();
  }
}
