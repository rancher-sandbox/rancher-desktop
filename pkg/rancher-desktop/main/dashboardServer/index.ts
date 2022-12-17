import { Server } from 'http';
import net from 'net';
import path from 'path';

import express from 'express';
import { createProxyMiddleware, Options, RequestHandler } from 'http-proxy-middleware';

import { proxyWsOpts, proxyOpts, proxyMetaOpts } from './proxyUtils';

import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';

const ProxyKeys = ['/k8s', '/pp', '/api', '/apis', '/v1', '/v3', '/v3-public', '/api-ui', '/meta', '/v1-*'] as const;

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
      '/k8s':       proxyWsOpts(this.api), // Straight to a remote cluster (/k8s/clusters/<id>/)
      '/pp':        proxyWsOpts(this.api), // For (epinio) standalone API
      '/api':       proxyWsOpts(this.api), // Management k8s API
      '/apis':      proxyWsOpts(this.api), // Management k8s API
      '/v1':        proxyWsOpts(this.api), // Management Steve API
      '/v3':        proxyWsOpts(this.api), // Rancher API
      '/v3-public': proxyOpts(this.api), // Rancher Unauthed API
      '/api-ui':    proxyOpts(this.api), // Browser API UI
      '/meta':      proxyMetaOpts(this.api), // Browser API UI
      '/v1-*':      proxyOpts(this.api), // SAML, KDM, etc
    };

    return Object.fromEntries(Object.entries(proxy)
      .map(([key, options]) => [key, createProxyMiddleware(options)])) as unknown as Record<ProxyKeys, RequestHandler>;
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
        '*',
        (_req, res) => {
          res.sendFile(
            path.resolve(paths.resources, 'rancher-dashboard', 'index.html'),
          );
        })
      .listen(this.port, this.host)
      .on('upgrade', (incomingMessage, duplex, head) => {
        const req = incomingMessage as express.Request;
        const socket = duplex as net.Socket;

        if (req?.url?.startsWith('/v1')) {
          return this.proxies['/v1'].upgrade?.(req, socket, head);
        } else if (req?.url?.startsWith('/v3')) {
          return this.proxies['/v3'].upgrade?.(req, socket, head);
        } else if (req?.url?.startsWith('/k8s/')) {
          return this.proxies['/k8s'].upgrade?.(req, socket, head);
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
