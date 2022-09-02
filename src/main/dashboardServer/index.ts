import path from 'path';

import { app } from 'electron';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const host = '127.0.0.1';
const port = 6120;

const dashboardServer = express();

dashboardServer
  .use(express.static(path.join(app.getAppPath(), 'resources', 'rancher-dashboard')))
  .use('/v1', createProxyMiddleware({ target: 'http://127.0.0.1:9080', changeOrigin: true }));

export const init = () => {
  dashboardServer.listen(port, host, () => {
    console.log('Server Running');
  });
};
