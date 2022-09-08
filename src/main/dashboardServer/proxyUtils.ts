import { Options } from 'http-proxy-middleware';

export const proxyOpts = (target: string): Options => {
  return {
    target,
    followRedirects: true,
    secure:          false,
    logLevel:        'debug',
    onProxyReq,
    onProxyReqWs,
    onError,
  };
};

export const proxyWsOpts = (target: string): Options => {
  return {
    ...proxyOpts(target),
    ws:           true,
    changeOrigin: true,
  };
};

export const proxyMetaOpts = (target: string): Options => {
  return {
    target,
    followRedirects: true,
    secure:          false,
    logLevel:        'debug',
    onProxyReq,
    onProxyReqWs,
    onError,
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
    console.error('Proxy WS Error:', err); // eslint-disable-line no-console
  });
};

const onError = (err: any, req: any, res: any) => {
  res.statusCode = 598;
  console.error('Proxy Error:', err); // eslint-disable-line no-console
  res.write(JSON.stringify(err));
};
