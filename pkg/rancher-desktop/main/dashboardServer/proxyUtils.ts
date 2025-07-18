import { ClientRequest } from 'http';
import { Socket } from 'net';

import { Options } from 'http-proxy-middleware';

import Logging from '@pkg/utils/logging';

import type { ErrorCallback, ProxyReqCallback, ProxyReqWsCallback } from 'http-proxy';

const console = Logging.dashboardServer;

const onProxyReq: ProxyReqCallback = (clientReq, req) => {
  const actualClientReq: ClientRequest | undefined = (clientReq as any)._currentRequest;

  if (!actualClientReq?.headersSent) {
    if (req.headers.host) {
      clientReq.setHeader('x-api-host', req.headers.host);
    }
    clientReq.setHeader('x-forwarded-proto', 'https');
  }
};

const onProxyReqWs: ProxyReqWsCallback = (clientReq, req, socket, options) => {
  const target = options?.target as Partial<URL> | undefined;

  if (!target?.href) {
    console.error(`onProxyReqWs: No target href, aborting`);
    req.destroy(new Error(`onProxyReqWs: no target href`));

    return;
  }
  if (target.pathname && clientReq.path.startsWith(target.pathname)) {
    // `options.prependPath` is required for non-websocket requests to be routed
    // correctly; this means that we end up with the prepended path here, but
    // that does not work in this case.  Therefore we need to manually strip off
    // the prepended path here before passing it to the backend.
    clientReq.path = clientReq.path.substring(target.pathname.length);
  }
  req.headers.origin = target.href;
  clientReq.setHeader('origin', target.href);
  if (req.headers.host) {
    clientReq.setHeader('x-api-host', req.headers.host);
  }
  clientReq.setHeader('x-forwarded-proto', 'https');

  socket.on('error', err => console.error('Proxy WS Error:', err));
};

const onError: ErrorCallback = (err, req, res) => {
  console.error('Proxy Error:', err);
  if (res instanceof Socket) {
    res.destroy(err);
  } else {
    res.statusCode = 598; // (Informal) Network read timeout error
    res.write(JSON.stringify(err));
  }
};

export const proxyOpts: Omit<Options, 'target'> = {
  followRedirects: true,
  secure:          false,
  logger:          console,
  on:              {
    proxyReq:   onProxyReq,
    proxyReqWs: onProxyReqWs,
    error:      onError,
  },
};

export const proxyWsOpts: Omit<Options, 'target'> = {
  ...proxyOpts,
  ws:           false,
  changeOrigin: true,
};
