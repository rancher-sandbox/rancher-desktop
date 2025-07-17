// This file contains wrappers to interact with the installed Kubernetes cluster

import events from 'events';
import net from 'net';
import stream from 'stream';
import util from 'util';

import * as k8s from '@kubernetes/client-node';

import Logging from '@pkg/utils/logging';
import { defined } from '@pkg/utils/typeUtils';

const console = Logging.k8s;

interface clientError {
  error: string;
}

function isClientError(val: any): val is clientError {
  return 'error' in val;
}

/**
 * ErrorSuppressingStdin wraps a socket such that when the 'data' event handler
 * throws, we can suppress the output so we do not get a dialog box, but rather
 * just break silently.
 */
class ErrorSuppressingStdin extends stream.Readable {
  #socket: net.Socket;
  #listeners: { [s: string]: (...args: any[]) => void; } = {};
  /**
   * @param socket The underlying socket to forward to.
   */
  constructor(socket: net.Socket) {
    super();
    this.#socket = socket;
    this.on('newListener', (eventName) => {
      if (!(eventName in this.#listeners)) {
        this.#listeners[eventName] = this.listener.bind(this, eventName);
        this.#socket.on(eventName, this.#listeners[eventName]);
      }
    });
    this.on('removeListener', (eventName) => {
      if (this.listenerCount(eventName) < 1) {
        this.#socket.removeListener(eventName, this.#listeners[eventName]);
        delete this.#listeners[eventName];
      }
    });
  }

  listener(eventName: string, ...args: any[]) {
    for (const listener of this.listeners(eventName)) {
      try {
        listener(...args);
      } catch (e) {
        console.error(isClientError(e) ? e.error : e);
      }
    }
  }

  _read(size: number): void {
    this.#socket.read(size);
  }

  read(size?: number): any {
    return this.#socket.read(size);
  }
}

/**
 * ForwardingMap holds the outstanding listeners used to do port forwarding;
 * this mainly exists for type safety / ensuring we get the keys correct.
 */
class ForwardingMap {
  protected map = new Map<string, net.Server>();
  /**
   * Get a forwarding entry.
   * @param namespace The namespace to forward to.
   * @param endpoint The endpoint in the namespace to forward to.
   * @param port The port to forward to on the endpoint.
   */
  get(namespace: string | undefined, endpoint: string, port: number | string) {
    return this.map.get(`${ namespace || 'default' }/${ endpoint }:${ port }`);
  }

  /**
   * Set a forwarding entry.
   * @param namespace The namespace to forward to.
   * @param endpoint The endpoint in the namespace to forward to.
   * @param port The port to forward to on the endpoint.
   * @param server The value to set.
   */
  set(namespace: string | undefined, endpoint: string, port: number | string, server: net.Server) {
    return this.map.set(`${ namespace || 'default' }/${ endpoint }:${ port }`, server);
  }

  /**
   * Delete a forwarding entry.
   * @param namespace The namespace to forward to.
   * @param endpoint The endpoint in the namespace to forward to.
   * @param port The port to forward to on the endpoint.
   */
  delete(namespace: string | undefined, endpoint: string, port: number | string) {
    return this.map.delete(`${ namespace || 'default' }/${ endpoint }:${ port }`);
  }

  /**
   * Check if a forwarding entry already exists.
   * @param namespace The namespace to forward to.
   * @param endpoint The endpoint in the namespace to forward to.
   * @param port The port to forward to on the endpoint.
   */
  has(namespace: string | undefined, endpoint: string, port: number | string) {
    return this.map.has(`${ namespace || 'default' }/${ endpoint }:${ port }`);
  }

  /**
   * Iterate through the entries.
   */
  *[Symbol.iterator](): IterableIterator<[string, string, number | string, net.Server]> {
    const iter = this.map[Symbol.iterator]();

    for (const [key, server] of iter) {
      const match = /^([^/]*)\/([^:]+):(.+?)$/.exec(key);

      if (match) {
        const [namespace, endpoint, portString] = match;
        const port = /^\d+$/.test(portString) ? parseInt(portString) : portString;

        yield [namespace, endpoint, port, server];
      }
    }
  }
}

// Set up a watch for services
// Since the watch API we have _doesn't_ notify us when things have
// changed, we'll need to do some trickery and wrap the underlying watcher
// with our own code.
class WrappedWatch extends k8s.Watch {
  callback: () => void;

  constructor(kubeconfig: k8s.KubeConfig, callback: () => void) {
    super(kubeconfig);
    this.callback = callback;
  }

  watch(
    path: string,
    queryParams: any,
    callback: (phase: string, apiObj: any, watchObj?: any) => void,
    done: (err: any) => void,
  ): Promise<any> {
    const wrappedCallback = (phase: string, apiObj: any, watchObj?: any) => {
      callback(phase, apiObj, watchObj);
      this.callback();
    };

    return super.watch(path, queryParams, wrappedCallback, done);
  }
}

/** A single port in a service returned by KubeClient.listServices() */
export type ServiceEntry = {
  /** The namespace the service is within. */
  namespace?: string;
  /** The name of the service. */
  name: string;
  /** The name of the port within the service. */
  portName?: string;
  /** The internal port number (or name) of the service. */
  port: number | string;
  /** The forwarded port on localhost (on the host), if any. */
  listenPort?: number;
};

/**
 * KubeClient is a Kubernetes client that will _only_ manage the cluster we spin
 * up internally.  The user should call initialize() once the cluster has been
 * created.
 */
export class KubeClient extends events.EventEmitter {
  protected kubeconfig = new k8s.KubeConfig();
  protected forwarder: k8s.PortForward;

  protected shutdown = false;

  /**
   * Kubernetes services across all namespaces.
   */
  protected services: k8s.ListWatch<k8s.V1Service> | null;

  /**
   * Active port forwarding servers.  This records the desired state: if an
   * entry exists, then we want to set up port forwarding for it.
   */
  protected servers = new ForwardingMap();

  /**
   * Collection of active sockets. Used to clean up connections when attempting
   * to close a server. Keys can be any string, but are formatted as
   * namespace/endpoint:port to help match sockets to the corresponding server.
   */
  protected sockets = new Map<string, net.Socket[]>();

  protected coreV1API: k8s.CoreV1Api;

  /**
   * initialize the KubeClient so that we are ready to talk to it.
   */
  constructor() {
    super();
    this.kubeconfig.loadFromDefault();
    this.kubeconfig.currentContext = 'rancher-desktop';
    this.forwarder = new k8s.PortForward(this.kubeconfig, true);
    this.shutdown = false;
    this.coreV1API = this.kubeconfig.makeApiClient(k8s.CoreV1Api);
    this.services = null;
  }

  get k8sClient() {
    return this.kubeconfig;
  }

  // This functionality was originally in the constructor, but in order to
  // avoid the complexity of async constructors, extract it out into an
  // async method.
  async waitForServiceWatcher() {
    const startTime = Date.now();
    const maxWaitTime = 300_000;
    const waitTime = 3_000;

    while (true) {
      const currentTime = Date.now();

      if ((currentTime - startTime) > maxWaitTime) {
        console.log(`Waited more than ${ maxWaitTime / 1000 } secs for kubernetes to fully start up. Giving up.`);
        break;
      }
      if (await this.getServiceListWatch()) {
        break;
      }
      await util.promisify(setTimeout)(waitTime);
    }
  }

  /**
   * Get the service watcher, ensuring that it's actually ready to react to
   * changes in the services.
   */
  async getServiceListWatch() {
    if (this.services) {
      return this.services;
    }
    // If this API call reports that there are zero services currently running,
    // return null (and it's up to the caller to retry later).
    // This doesn't make complete sense, because if we've reached this point,
    // the k3s server must be running. But with wsl we've observed that the service
    // watcher needs more time to start up. When this call returns at least one
    // service, it's ready.
    try {
      const { items } = await this.coreV1API.listServiceForAllNamespaces();

      if (!(items.length > 0)) {
        return null;
      }
    } catch (ex) {
      console.debug(`Error fetching services: ${ ex }`);

      return null;
    }
    this.services = new k8s.ListWatch(
      '/api/v1/services',
      new WrappedWatch(this.kubeconfig, () => {
        this.emit('service-changed', this.listServices());
      }),
      () => this.coreV1API.listServiceForAllNamespaces());

    return this.services;
  }

  /**
   * Wait for at least one node in the cluster to become ready.  This is taken
   * as an indication that the cluster is ready to be used.
   */
  async waitForReadyNodes(): Promise<void> {
    while (true) {
      const { items } = await this.coreV1API.listNode();
      const conditions = items.flatMap(node => node.status?.conditions ?? []);
      const ready = conditions.some(condition => condition.type === 'Ready' && condition.status === 'True');

      if (ready) {
        return;
      }
      await util.promisify(setTimeout)(1_000);
    }
  }

  // Notify that the client the underlying Kubernetes cluster is about to go
  // away, and we should remove any pending work.
  destroy() {
    this.shutdown = true;
    for (const [namespace, endpoint, port, server] of this.servers) {
      this.servers.delete(namespace, endpoint, port);
      server?.close();
    }
    this.removeAllListeners('service-changed');
  }

  protected async getEndpointSubsets(namespace: string, endpointName: string): Promise<k8s.V1EndpointSubset[] | null> {
    console.log(`Attempting to locate endpoint subsets ${ endpointName }...`);
    // Loop fetching endpoints, until it matches at least one subset.
    let target: k8s.V1EndpointSubset[] | undefined;

    // TODO: switch this to using watch.
    while (!this.shutdown) {
      const endpoints = await this.coreV1API.listNamespacedEndpoints({
        namespace,
        fieldSelector: `metadata.name == ${ endpointName }`,
      });
      const items = endpoints.items.filter(item => item.metadata?.name === endpointName);

      target = items.flatMap(item => item.subsets).filter(defined);
      if (target.length > 0 || this.shutdown) {
        break;
      }
      console.log(`Could not find ${ endpointName } endpoint (${ endpoints ? 'did' : 'did not' } get endpoints), retrying...`);
      await util.promisify(setTimeout)(1000);
    }

    return target ?? null;
  }

  protected async getActivePodFromEndpointSubsets(subsets: k8s.V1EndpointSubset[]) {
    const addresses = subsets.flatMap(subset => subset.addresses).filter(defined);
    const address = addresses.find(address => address.targetRef?.kind === 'Pod');
    const target = address?.targetRef;

    if (!target || !target.name || !target.namespace) {
      return null;
    }

    // Fetch the pod
    try {
      return await this.coreV1API.readNamespacedPod({
        name:      target.name,
        namespace: target.namespace,
      });
    } catch (ex) {
      if (ex instanceof k8s.ApiException && ex.code === 404) {
        return null;
      }
      throw ex;
    }
  }

  /**
   * Return a pod that is part of a given endpoint and ready to receive traffic.
   * @param namespace The namespace in which to look for resources.
   * @param endpointName the name of an endpoint that controls ready pods.
   */
  async getActivePod(namespace: string, endpointName: string): Promise<k8s.V1Pod | null> {
    console.log(`Attempting to locate ${ endpointName } pod...`);
    while (!this.shutdown) {
      const subsets = await this.getEndpointSubsets(namespace, endpointName);

      if (!subsets) {
        await util.promisify(setTimeout)(1000);
        continue;
      }
      const pod = await this.getActivePodFromEndpointSubsets(subsets);

      if (!pod) {
        await util.promisify(setTimeout)(1000);
        continue;
      }
      console.log(`Got ${ endpointName } pod: ${ pod.metadata?.namespace }:${ pod.metadata?.name }`);

      return pod;
    }

    return null;
  }

  /**
   * Formats the namespace, endpoint, and port as namespace/endpoint:port
   * @param namespace The namespace to forward to.
   * @param endpoint The endpoint in the namespace to forward to.
   * @param port The port to forward to on the endpoint.
   * @returns A formatted string consisting of the namespace/endpoint:port
   */
  private targetName =
    (namespace: string, endpoint: string, port: number | string) => `${ namespace }/${ endpoint }:${ port }`;

  /**
   * Given a Pod object, returns its namespace, its name and the port number matching
   * the passed port name/number.
   * @param pod The pod to extract the info from.
   * @param k8sPort The port name or number to get the port number from.
   * @returns An array containing the pod namespace, the pod name and the port number.
   */
  protected getPodDetails(pod: k8s.V1Pod, k8sPort: number | string): [string, string, number] {
    if (!pod.metadata) {
      throw new Error('Pod has no metadata');
    }
    if (!pod.metadata.name) {
      throw new Error('Pod has no name');
    }
    const podNamespace = pod.metadata.namespace ?? 'default';
    const podName = pod.metadata.name;

    let portNumber: number;

    if (typeof k8sPort === 'number') {
      portNumber = k8sPort;
    } else {
      if (!pod.spec) {
        throw new Error(`Pod "${ podName } does not have a spec property`);
      }
      const podPorts = pod.spec.containers.flatMap(container => container.ports);
      const podPort = podPorts.find(port => port?.name === k8sPort);

      if (!podPort) {
        throw new Error(`Could not find port number for pod "${ podName }`);
      }
      portNumber = podPort.containerPort;
    }

    return [podNamespace, podName, portNumber];
  }

  /**
   * Forward a port to a kubernetes service. The port forwarding will not work
   * until the endpoint is ready.
   * @param namespace The namespace to forward to.
   * @param endpoint The endpoint in the namespace to forward to.
   * @param k8sPort The port to forward to on the endpoint.
   * @param hostPort The host port to listen on for the forwarded port. Pass 0 for a random port.
   */
  protected async createForwardingServer(namespace: string, endpoint: string, k8sPort: number | string, hostPort: number): Promise<net.Server> {
    const targetName = this.targetName(namespace, endpoint, k8sPort);
    const server = net.createServer(async(socket) => {
      // We need some helpers to convince TypeScript that our errors have
      // `code: string` and `error: Error` properties.
      interface ErrorWithStringCode extends Error { code: string }
      interface ErrorWithNestedError extends Error { error: Error }
      const isError = <T extends Error>(error: Error, prop: string): error is T => {
        return prop in error;
      };

      socket.on('error', (error) => {
        // Handle the error, so that we don't get an ugly dialog about it.
        const code = isError<ErrorWithStringCode>(error, 'code') ? error.code : 'MISSING';
        const innerError = isError<ErrorWithNestedError>(error, 'error') ? error.error : error;

        console.error(`Error creating proxy for ${ targetName }: code "${ code }" error "${ innerError }"`);
      });

      // add socket to this.sockets so it can be cleaned up
      this.sockets.set(targetName, [...this.sockets.get(targetName) || [], socket]);

      // get the details of the pod we are forwarding to
      const endpoints = await this.getEndpointSubsets(namespace, endpoint) ?? [];

      console.debug(`Got endpoints subsets: ${ JSON.stringify(endpoints) }`);
      const pod = await this.getActivePodFromEndpointSubsets(endpoints);

      console.debug(`Got active pod: ${ JSON.stringify(pod) }`);

      if (!pod) {
        throw new Error(`No active pod found`);
      }

      const [podNamespace, podName, portNumber] = this.getPodDetails(pod, k8sPort);

      console.debug(`Got podNamespace = "${ podNamespace }"`);
      console.debug(`Got podName = "${ podName }"`);
      console.debug(`Got portNumber = "${ portNumber }"`);

      // check if server is still valid
      if (!this.servers.has(namespace, endpoint, k8sPort)) {
        throw new Error('Server is no longer valid');
      }

      // forward the port
      const stdin = new ErrorSuppressingStdin(socket);

      this.forwarder.portForward(podNamespace, podName, [portNumber], socket, null, stdin)
        .catch((e) => {
          console.log(`Failed to create web socket for forwarding to ${ targetName }: ${ e?.error || e }`);
          socket.destroy(e);
        });
    });

    // Start listening, and block until the listener has been established.
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        resolve = reject = () => { };
        server.off('listening', resolveOnce);
        server.off('error', rejectOnce);
      };
      const resolveOnce = () => {
        resolve(undefined);
        cleanup();
      };
      const rejectOnce = (error?: any) => {
        reject(error);
        cleanup();
      };

      server.once('close', () => {
        rejectOnce(new Error('Server closed'));
      });
      server.once('listening', resolveOnce);
      server.once('error', rejectOnce);
      server.listen({ port: hostPort, host: '127.0.0.1' });
    });

    return server;
  }

  /**
   * Create a port forward for an endpoint, listening on localhost.
   * @param namespace The namespace containing the end points to forward to.
   * @param endpoint The endpoint to forward to.
   * @param k8sPort The port to forward to on the endpoint.
   * @param hostPort The host port to listen on for the forwarded port. Pass 0 for a random port.
   * @return The port number for the port forward.
   */
  async forwardPort(namespace: string, endpoint: string, k8sPort: number | string, hostPort: number): Promise<number | undefined> {
    const targetName = this.targetName(namespace, endpoint, k8sPort);
    let server = this.servers.get(namespace, endpoint, k8sPort);

    if (server) {
      console.log(`Found existing server for ${ targetName }.`);
      const currentHostPort = (server.address() as net.AddressInfo).port;

      if (currentHostPort === hostPort) {
        console.log(`Server listening on ${ hostPort }, which is what we want.`);

        return hostPort;
      } else {
        console.log(`Server listening on ${ currentHostPort }, but we want ${ hostPort }. Closing it.`);
        await this.closeServerAndConns(namespace, endpoint, k8sPort);
      }
    }

    // create server
    console.log(`Setting up new port forwarding to ${ targetName }...`);
    try {
      server = await this.createForwardingServer(namespace, endpoint, k8sPort, hostPort);
    } catch (error: any) {
      console.error(error);
      let errorMessage = '';

      if (error.code === 'ERR_SOCKET_BAD_PORT') {
        errorMessage = `"${ hostPort }" is not a valid port.`;
      } else if (error.code === 'EADDRINUSE') {
        errorMessage = `Port ${ hostPort } is already in use.`;
      } else if (error.code === 'EACCES') {
        errorMessage = `You do not have permission to use port ${ hostPort }.`;
      }

      if (errorMessage) {
        const serviceEntry: ServiceEntry = {
          namespace,
          name:       endpoint,
          port:       k8sPort,
          listenPort: hostPort,
        };

        this.emit('service-error', serviceEntry, errorMessage);

        return;
      }

      throw error;
    }
    console.log(`Forwarding server for ${ targetName } created.`);

    // add it to this.servers if value for targetName hasn't been filled in meantime
    if (!this.servers.get(namespace, endpoint, k8sPort)) {
      this.servers.set(namespace, endpoint, k8sPort, server);
      console.log(`Forwarding server for ${ targetName } added to server list.`);
    } else {
      console.warn(`Another forwarding server for ${ targetName } was found; closing this one.`);
      server.close();
    }

    // Trigger a UI refresh
    this.emit('service-changed', this.listServices());

    const address = server.address() as net.AddressInfo;

    return address.port;
  }

  /**
   * Ensure that the forwarding server for a given combination of arguments is closed,
   * and that all connections related to it are destroyed.
   * @param namespace The namespace to forward to.
   * @param endpoint The endpoint in the namespace to forward to.
   * @param k8sPort The port to forward to on the endpoint.
   */
  protected async closeServerAndConns(namespace: string, endpoint: string, k8sPort: number | string): Promise<void> {
    const targetName = this.targetName(namespace, endpoint, k8sPort);
    const server = this.servers.get(namespace, endpoint, k8sPort);

    // close and remove sockets for this server
    this.sockets.get(targetName)?.forEach(socket => socket.destroy());
    this.sockets.delete(targetName);

    // close server
    this.servers.delete(namespace, endpoint, k8sPort);
    if (server) {
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }
  }

  /**
   * Ensure that a given port forwarding does not exist; if it does, close it.
   * @param namespace The namespace to forward to.
   * @param endpoint The endpoint in the namespace to forward to.
   * @param k8sPort The port to forward to on the endpoint.
   */
  async cancelForwardPort(namespace: string, endpoint: string, k8sPort: number | string): Promise<void> {
    await this.closeServerAndConns(namespace, endpoint, k8sPort);
    this.emit('service-changed', this.listServices());
  }

  /**
   * Get the cached list of services.
   * @param namespace The namespace to limit fetches to.
   * @returns The services currently in the system.
   */
  listServices(namespace: string | undefined = undefined): ServiceEntry[] {
    if (!this.services) {
      return [];
    }

    return this.services.list(namespace)?.flatMap((service) => {
      return (service.spec?.ports || []).map((port) => {
        const namespace = service.metadata?.namespace;
        const name = service.metadata?.name || '';
        const portNumber = port.targetPort as unknown as number;
        const server = this.servers.get(namespace, name, portNumber);
        const address = server?.address();
        const listenPort = address !== undefined ? (address as net.AddressInfo).port : undefined;

        return {
          namespace,
          name,
          portName: port.name,
          port:     portNumber,
          listenPort,
        };
      });
    });
  }
}
