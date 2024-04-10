import { Options } from 'http-proxy-middleware';

import Logging from '@pkg/utils/logging';

const console = Logging.dashboardServer;

export const proxyOpts = (): Omit<Options, 'target'> => {
  return {
    followRedirects: true,
    secure:          false,
    logger:          console,
    on:              {
      proxyReq:   onProxyReq,
      proxyReqWs: onProxyReqWs,
      error:      onError,
    },
  };
};

export const proxyWsOpts = (): Omit<Options, 'target'> => {
  return {
    ...proxyOpts(),
    ws:           false,
    changeOrigin: true,
  };
};

const onProxyReq = (proxyReq: any, req: any) => {
  if (!(proxyReq._currentRequest && proxyReq._currentRequest._headerSent)) {
    proxyReq.setHeader('x-api-host', req.headers['host']);
    proxyReq.setHeader('x-forwarded-proto', 'https');
  }
};

const onProxyReqWs = (proxyReq: any, req: any, socket: any, options: any, _head: any) => {
  req.headers.origin = options.target.href;
  proxyReq.setHeader('origin', options.target.href);
  proxyReq.setHeader('x-api-host', req.headers['host']);
  proxyReq.setHeader('x-forwarded-proto', 'https');

  socket.on('error', (err: any) => {
    console.error('Proxy WS Error:', err);
  });
};

const onError = (err: any, req: any, res: any) => {
  res.statusCode = 598;
  console.error('Proxy Error:', err);
  res.write(JSON.stringify(err));
};
