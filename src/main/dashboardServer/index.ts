import path from 'path';

import { app } from 'electron';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const host = '127.0.0.1';
const port = 6120;

const dashboardServer = express();

dashboardServer
  .use(
    '/v1',
    createProxyMiddleware({
      target:       'https://127.0.0.1:9443',
      secure:       false,
      logLevel:     'debug',
      changeOrigin: true,
    }))
  .use(
    '/v3',
    createProxyMiddleware({
      target:       'https://127.0.0.1:9443',
      secure:       false,
      logLevel:     'debug',
      changeOrigin: true,
    }))
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
