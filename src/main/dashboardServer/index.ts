import { Server } from 'http';
import path from 'path';

import { app } from 'electron';
import express from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';

import { proxyWsOpts, proxyOpts, proxyMetaOpts } from './proxyUtils';

import Logging from '@/utils/logging';

type ProxyKeys = '/k8s' | '/pp' | '/api' | '/apis' | '/v1' | '/v3' | '/v3-public' | '/api-ui' | '/meta' | '/v1-*';

type ProxyMap = Record<ProxyKeys, Options>;

const console = Logging.dashboardServer;

export class DashboardServer {
  private static instance: DashboardServer;

  private dashboardServer = express();
  private dashboardApp: Server = new Server();
  private host = '127.0.0.1';
  private port = 6120;
  private api = 'https://127.0.0.1:9443';
  private proxy: ProxyMap = {
    '/k8s':          proxyWsOpts(this.api), // Straight to a remote cluster (/k8s/clusters/<id>/)
    '/pp':           proxyWsOpts(this.api), // For (epinio) standalone API
    '/api':          proxyWsOpts(this.api), // Management k8s API
    '/apis':         proxyWsOpts(this.api), // Management k8s API
    '/v1':           proxyWsOpts(this.api), // Management Steve API
    '/v3':           proxyWsOpts(this.api), // Rancher API
    '/v3-public':    proxyOpts(this.api), // Rancher Unauthed API
    '/api-ui':       proxyOpts(this.api), // Browser API UI
    '/meta':         proxyMetaOpts(this.api), // Browser API UI
    '/v1-*':         proxyOpts(this.api), // SAML, KDM, etc
  };

  private proxies: any = {};

  public static getInstance(): DashboardServer {
    if (!DashboardServer.instance) {
      DashboardServer.instance = new DashboardServer();
    }

    return DashboardServer.instance;
  }

  public init() {
    if (this.dashboardApp.address()) {
      console.log(`Dashboard Server is already listening on ${ this.host }:${ this.port }`);

      return;
    }

    Object.entries(this.proxy).forEach(([key, value]) => {
      const config = createProxyMiddleware(value);

      this.proxies[key] = config;
      this.dashboardServer.use(key, config);
    });

    this.dashboardApp = this.dashboardServer
      .use(
        express.static(
          path.join(app.getAppPath(), 'resources', 'rancher-dashboard'),
        ))
      .get(
        '*',
        (_req, res) => {
          res.sendFile(
            path.resolve(app.getAppPath(), 'resources', 'rancher-dashboard', 'index.html'),
          );
        })
      .listen(this.port, this.host)
      .on('upgrade', (req, socket, head) => {
        if (req?.url?.startsWith('/v1')) {
          return this.proxies['/v1'].upgrade(req, socket, head);
        } else if (req?.url?.startsWith('/v3')) {
          return this.proxies['/v3'].upgrade(req, socket, head);
        } else if (req?.url?.startsWith('/k8s/')) {
          return this.proxies['/k8s'].upgrade(req, socket, head);
        } else {
          console.log(`Unknown Web socket upgrade request for ${ req.url }`); // eslint-disable-line no-console
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
