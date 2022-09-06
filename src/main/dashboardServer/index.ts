import path from 'path';

import { app } from 'electron';
import express from 'express';
// import httpProxy from 'http-proxy';
import { createProxyMiddleware } from 'http-proxy-middleware';

const host = '127.0.0.1';
const port = 6120;
// const apiProxy = httpProxy.createProxyServer();

const dashboardServer = express();

dashboardServer
  // .all('/v1/*', (req, res) => {
  //   console.log('redirecting to STEVE');
  //   apiProxy.web(req, res, { target: 'http://127.0.0.1:9080' });
  // })
  // .all('/v3/*', (req, res) => {
  //   console.log('redirecting to STEVE');
  //   apiProxy.web(req, res, { target: 'http://127.0.0.1:9080' });
  // })
  .use(
    '/v1',
    createProxyMiddleware({
      target: 'http://127.0.0.1:9080',
      // changeOrigin: true,
    }))
  .use(
    express.static(
      path.join(app.getAppPath(), 'resources', 'rancher-dashboard'),
    ));

export const init = () => {
  // dashboardServer.listen(port, host, () => {
  //   console.log('Server Running');
  // });
};
