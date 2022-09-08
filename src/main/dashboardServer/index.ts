import path from 'path';

import { app } from 'electron';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

import { proxyWsOpts, proxyOpts, proxyMetaOpts } from './proxyUtils';

const host = '127.0.0.1';
const port = 6120;

const api = 'https://127.0.0.1:9443';

const dashboardServer = express();

dashboardServer
  .use('/k8s', createProxyMiddleware(proxyWsOpts(api)))
  .use('/pp', createProxyMiddleware(proxyWsOpts(api)))
  .use('/api', createProxyMiddleware(proxyWsOpts(api)))
  .use('/apis', createProxyMiddleware(proxyWsOpts(api)))
  .use('/v1', createProxyMiddleware(proxyWsOpts(api)))
  .use('/v3', createProxyMiddleware(proxyWsOpts(api)))
  .use('/v3-public', createProxyMiddleware(proxyOpts(api)))
  .use('/api-ui', createProxyMiddleware(proxyOpts(api)))
  .use('/meta', createProxyMiddleware(proxyMetaOpts(api)))
  .use('/v1-*', createProxyMiddleware(proxyOpts(api)))
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
