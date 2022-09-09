import path from 'path';

import { app } from 'electron';
import express from 'express';
import { createProxyMiddleware, RequestHandler } from 'http-proxy-middleware';

import { proxyWsOpts, proxyOpts, proxyMetaOpts } from './proxyUtils';

const host = '127.0.0.1';
const port = 6120;

const api = 'https://127.0.0.1:9443';

const dashboardServer = express();

const proxy = {
  '/k8s':          proxyWsOpts(api), // Straight to a remote cluster (/k8s/clusters/<id>/)
  '/pp':           proxyWsOpts(api), // For (epinio) standalone API
  '/api':          proxyWsOpts(api), // Management k8s API
  '/apis':         proxyWsOpts(api), // Management k8s API
  '/v1':           proxyWsOpts(api), // Management Steve API
  '/v3':           proxyWsOpts(api), // Rancher API
  '/v3-public':    proxyOpts(api), // Rancher Unauthed API
  '/api-ui':       proxyOpts(api), // Browser API UI
  '/meta':         proxyMetaOpts(api), // Browser API UI
  '/v1-*':         proxyOpts(api), // SAML, KDM, etc
};

const proxies: Record<string, RequestHandler> = {};

Object.entries(proxy).forEach(([key, value]) => {
  const config = createProxyMiddleware(value);

  proxies[key] = config;
  dashboardServer.use(key, config);
});

dashboardServer
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
    });

export const init = () => {
  dashboardServer.listen(port, host, () => {
    console.log('Server Running');
  });
};
