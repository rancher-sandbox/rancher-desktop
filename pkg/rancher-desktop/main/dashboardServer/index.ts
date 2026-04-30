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
  private stevePort = 0;
  private proxies:      Record<ProxyKeys, ReturnType<typeof createProxyMiddleware>> = Object.create(null);

  /**
   * Checks for an existing instance of Dashboard server.
   * Instantiate a new one if it does not exist.
   */
  public static getInstance(): DashboardServer {
    DashboardServer.instance ??= new DashboardServer();

    return DashboardServer.instance;
  }

  /**
   * Recreate proxy middleware instances with the current Steve URL as
   * the target.  Each proxy must be created with a static `target` (not
   * a dynamic `router`) because the onProxyReqWs callback in proxyUtils
   * reads options.target to correct websocket paths — without a valid
   * target URL, it destroys every websocket connection.
   */
  private createProxies() {
    const api = `https://127.0.0.1:${ this.stevePort }`;
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
      return [key, createProxyMiddleware({ ...options, target: api + key })] as const;
    });

    this.proxies = Object.fromEntries(entries) as typeof this.proxies;
  }

  /**
   * Update the Steve HTTPS port and recreate proxies with the new
   * target.  Call this before each Steve start.
   */
  public setStevePort(stevePort: number) {
    this.stevePort = stevePort;
    this.createProxies();
  }

  /**
   * Starts the Dashboard server if one is not already running.
   */
  public init() {
    if (this.dashboardApp.address()) {
      console.log(`Dashboard Server is already listening on ${ this.host }:${ this.port }`);

      return;
    }

    // Consumed by Rancher Dashboard to discover Steve's dynamic HTTPS
    // port.  Registered before the proxy routes so it is not captured
    // by the /api proxy to Steve.
    this.dashboardServer.get('/api/steve-port', (_req, res) => {
      res.json({ port: this.stevePort });
    });

    // Register wrapper functions so that when createProxies() replaces
    // this.proxies (on each Steve restart), express and the upgrade
    // handler automatically use the new instances.  The call is safe: proxies
    // are always created before the UI is notified that Kubernetes is ready,
    // and the dashboard button is disabled until then.
    ProxyKeys.forEach((key) => {
      this.dashboardServer.use(key, (req, res, next) => {
        return this.proxies[key] ? this.proxies[key](req, res, next) : next();
      });
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

        const upgradeKeys = new Set<ProxyKeys>(['/v1', '/v3', '/k8s', '/api']);
        const key = Array.from(upgradeKeys).find((key) => {
          return req.url === key || req.url?.startsWith(key + '/');
        });

        if (key && this.proxies[key]) {
          return this.proxies[key].upgrade(req, socket, head);
        }

        console.log(`Unknown WebSocket upgrade request for ${ req.url }`);
        socket.destroy();
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
