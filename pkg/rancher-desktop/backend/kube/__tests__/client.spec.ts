/** @jest-environment node */

import fs from 'fs';
import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';
import util from 'util';

import mockModules from '@pkg/utils/testUtils/mockModules';

mockModules({ '@pkg/utils/logging': undefined });

const { KubeClient } = await import('../client');

/**
 * A stand-in for the apiserver, serving what the services ListWatch asks for:
 * the list, and the watch stream that follows it.
 */
class FakeAPIServer {
  /** The services the list endpoint reports. */
  services: any[] = [];

  /**
   * Statuses to answer the next watch requests with, oldest first; requests
   * beyond this list get a 200 and a stream held open.
   */
  watchStatuses: number[] = [];

  protected server = http.createServer(this.handle.bind(this));
  protected openWatches = new Set<http.ServerResponse>();
  /** How many watch requests have arrived; reported when waitForWatch() gives up. */
  protected watchCount = 0;

  async listen(): Promise<string> {
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));

    return `http://127.0.0.1:${ (this.server.address() as net.AddressInfo).port }`;
  }

  async close(): Promise<void> {
    // The watch streams are held open; drop them so the server can close.
    this.server.closeAllConnections();
    await new Promise<void>(resolve => this.server.close(() => resolve()));
  }

  protected handle(request: http.IncomingMessage, response: http.ServerResponse) {
    const url = new URL(request.url ?? '', 'http://127.0.0.1');

    if (url.pathname !== '/api/v1/services') {
      response.writeHead(404).end();

      return;
    }
    if (url.searchParams.get('watch') !== 'true') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        kind:       'ServiceList',
        apiVersion: 'v1',
        metadata:   { resourceVersion: '1' },
        items:      this.services,
      }));

      return;
    }

    this.watchCount++;
    const status = this.watchStatuses.shift() ?? 200;

    if (status !== 200) {
      response.writeHead(status).end();

      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    this.openWatches.add(response);
    response.on('close', () => this.openWatches.delete(response));
  }

  /** Wait until the client holds a watch stream open. */
  async waitForWatch(): Promise<void> {
    const deadline = Date.now() + 10_000;

    while (this.openWatches.size === 0) {
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for the client to open a watch; watch requests received: ${ this.watchCount }.`);
      }
      await util.promisify(setTimeout)(100);
    }
  }

  /** Send one watch event to every open watch stream. */
  sendWatchEvent(type: string, object: any) {
    for (const response of this.openWatches) {
      response.write(`${ JSON.stringify({ type, object }) }\n`);
    }
  }
}

function makeService(name: string, port: number) {
  return {
    metadata: { name, namespace: 'default', resourceVersion: '1' },
    spec:     { ports: [{ name: 'http', port, targetPort: port }] },
  };
}

describe('KubeClient', () => {
  let workdir: string;
  let server: FakeAPIServer;
  let client: InstanceType<typeof KubeClient> | undefined;

  beforeEach(async() => {
    workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-kube-client-'));
    server = new FakeAPIServer();

    const serverUrl = await server.listen();
    const kubeconfig = path.join(workdir, 'kubeconfig');

    await fs.promises.writeFile(kubeconfig, JSON.stringify({
      apiVersion:        'v1',
      kind:              'Config',
      clusters:          [{
        name:    'rancher-desktop',
        // client-node refuses an http:// server without this.
        cluster: { server: serverUrl, 'insecure-skip-tls-verify': true },
      }],
      users:             [{ name: 'rancher-desktop', user: {} }],
      contexts:          [{ name: 'rancher-desktop', context: { cluster: 'rancher-desktop', user: 'rancher-desktop' } }],
      'current-context': 'rancher-desktop',
    }));
    process.env.KUBECONFIG = kubeconfig;
  });

  afterEach(async() => {
    client?.destroy();
    client = undefined;
    await server.close();
    await fs.promises.rm(workdir, { recursive: true, force: true });
  });

  it('keeps restarting the service watch after errors the client library will not retry', async() => {
    server.services.push(makeService('kubernetes', 443));
    // ListWatch abandons the watch for any error but a 410 or a timeout.
    server.watchStatuses.push(503, 503);

    client = new KubeClient();
    await client.waitForServiceWatcher();
    await server.waitForWatch();

    const changed = new Promise<any[]>(resolve => client?.once('service-changed', resolve));
    const traefik = makeService('traefik', 80);

    server.services.push(traefik);
    server.sendWatchEvent('ADDED', traefik);

    await expect(changed).resolves.toContainEqual(expect.objectContaining({ name: 'traefik' }));
  }, 30_000);
});
