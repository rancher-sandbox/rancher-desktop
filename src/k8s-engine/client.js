'use strict';

// This file contains wrappers to interact with the installed Kubernetes cluster

const events = require('events');
const net = require('net');
const k8s = require('@kubernetes/client-node');

/**
 * ErrorSuppressingStdin wraps a socket such that when the 'data' event handler
 * throws, we can suppress the output so we do not get a dialog box, but rather
 * just break silently.
 */
class ErrorSuppressingStdin extends events.EventEmitter {
    /** @type net.Socket */
    #socket;
    /** @type {Object.<string, (...args: any[]) => void)>} */
    #listeners = {};
    /**
     * @param {net.Socket} socket The underlying socket to forward to.
     */
    constructor(socket) {
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

    listener(eventName, ...args) {
      for (const listener of this.listeners(eventName)) {
        try {
          listener(...args);
        } catch (e) {
          console.error(e?.error ?? e);
        }
      }
    }
}

/**
 * ForwardingMap holds the outstanding listeners used to do port forwarding;
 * this mainly exists for type safety / ensuring we get the keys correct.
 * @extends Map<string, net.Server>
 */
class ForwardingMap extends Map {
  /**
   * Get a forwarding entry.
   * @param {string} namespace The namespace to forward to.
   * @param {string} endpoint The endpoint in the namespace to forward to.
   * @param {number} port The port to forward to on the endpoint.
   */
  get(namespace, endpoint, port) {
    return super.get(`${ namespace }/${ endpoint }:${ port }`);
  }

  /**
   * Set a forwarding entry.
   * @param {string} namespace The namespace to forward to.
   * @param {string} endpoint The endpoint in the namespace to forward to.
   * @param {number} port The port to forward to on the endpoint.
   * @param {net.Server} server The value to set.
   */
  set(namespace, endpoint, port, server) {
    return super.set(`${ namespace }/${ endpoint }:${ port }`, server);
  }

  /**
   * Delete a forwarding entry.
   * @param {string} namespace The namespace to forward to.
   * @param {string} endpoint The endpoint in the namespace to forward to.
   * @param {number} port The port to forward to on the endpoint.
   */
  delete(namespace, endpoint, port) {
    return super.delete(`${ namespace }/${ endpoint }:${ port }`);
  }

  /**
   * Check if a fowarding entry already exists.
   * @param {string} namespace The namespace to forward to.
   * @param {string} endpoint The endpoint in the namespace to forward to.
   * @param {number} port The port to forward to on the endpoint.
   */
  has(namespace, endpoint, port) {
    return super.has(`${ namespace }/${ endpoint }:${ port }`);
  }

  /**
   * Iterate through the entries.
   * @returns {IterableIterator<[string, string, number, net.Server]>}
   */
  *[Symbol.iterator]() {
    const iter = super[Symbol.iterator]();

    for (const [key, server] of iter) {
      const [namespace, endpoint, port] = /^([^/]+)\/([^:]+):(\d+)$/.exec(key);

      yield [namespace, endpoint, parseInt(port), server];
    }
  }
}

/**
 * KubeClient is a Kubernetes client that will _only_ manage the cluster we spin
 * up internally.  The user should call initialize() once the cluster has been
 * created.
 */
class KubeClient {
  #kubeconfig = new k8s.KubeConfig();
  /**
   * @type k8s.PortForward?
   */
  #forwarder = null;

  #shutdown = false;

  /**
   * Active port forwarding servers.  This records the desired state: if an
   * entry exists, then we want to set up port forwarding for it.
   */
  #servers = new ForwardingMap();

  /**
   * initialize the KubeClient so that we are ready to talk to it.
   */
  constructor() {
    this.#kubeconfig.loadFromDefault();
    this.#kubeconfig.currentContext = 'rancher-desktop';
    this.#forwarder = new k8s.PortForward(this.#kubeconfig, true);
    this.#shutdown = false;
  }

  // Notify that the client the underlying Kubernetes cluster is about to go
  // away, and we should remove any pending work.
  destroy() {
    this.#shutdown = true;
    for (const [namespace, endpoint, port, server] of this.#servers) {
      this.#servers.delete(namespace, endpoint, port);
      server?.close();
    }
  }

  /**
   * @type k8s.CoreV1Api
   */
  get #coreV1API() {
    this.#_coreV1API ||= this.#kubeconfig.makeApiClient(k8s.CoreV1Api);

    return this.#_coreV1API;
  }

  #_coreV1API = null;

  /**
   * Return a pod that is part of a given endpoint and ready to receive traffic.
   * @param {string} namespace The namespace in which to look for resources.
   * @param {string} endpointName the name of an endpoint that controls ready pods.
   * @returns {Promise<k8s.V1Pod?>}
   */
  async #getActivePod(namespace, endpointName) {
    console.log(`Attempting to locate ${ endpointName } pod...`);
    // Loop fetching endpoints, until it matches at least one pod.
    /** @type k8s.V1ObjectReference? */
    let target = null;

    // TODO: switch this to using watch.
    while (!this.#shutdown) {
      /** @type k8s.V1EndpointsList */
      const endpoints = await this.#coreV1API.listNamespacedEndpoints(namespace, { headers: { name: endpointName } });

      target = endpoints?.body?.items
        ?.flatMap(item => item.subsets)?.filter(x => x)
        ?.flatMap(subset => subset.addresses)?.filter(x => x)
        ?.flatMap(address => address.targetRef)
        ?.find(ref => ref);
      if (target || this.#shutdown) {
        break;
      }
      console.log(`Could not find ${ endpointName } pod (${ endpoints ? 'did' : 'did not' } get endpoints), retrying...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (this.#shutdown) {
      return null;
    }
    // Fetch the pod
    const { body: pod } = await this.#coreV1API.readNamespacedPod(target.name, target.namespace);

    console.log(`Got ${ endpointName } pod: ${ pod?.metadata?.namespace }:${ pod?.metadata?.name }`);

    return pod;
  }

  /**
   * Create a port forwarding, listening on localhost.  Note that if the
   * endpoint isn't ready yet, the port forwarding might not work correctly
   * until it does.
   * @param {string} namespace The namespace to forward to.
   * @param {string} endpoint The endpoint in the namespace to forward to.
   * @param {number} port The port to forward to on the endpoint.
   * @returns {Promise<void>}
   */
  async #createForwardingServer(namespace, endpoint, port) {
    const targetName = `${ namespace }/${ endpoint }:${ port }`;

    if (this.#servers.get(namespace, endpoint, port)) {
      // We already have a port forwarding server; don't clobber it.
      return;
    }
    console.log(`Setting up new port forwarding to ${ targetName }...`);
    const server = net.createServer(async(socket) => {
      socket.on('error', (error) => {
        // Handle the error, so that we don't get an ugly dialog about it.
        switch (error?.code) {
        case 'ECONNRESET':
        case 'EPIPE':
          break;
        default:
          console.log(`Error creating proxy: ${ error?.error || error }`);
        }
      });
      // Find a working pod
      const pod = await this.#getActivePod(namespace, endpoint);

      if (!this.#servers.has(namespace, endpoint, port)) {
        socket.destroy(new Error(`Port forwarding to ${ targetName } was cancelled`));

        return;
      }
      const { metadata: { namespace: podNamespace, name: podName } } = pod;
      const stdin = new ErrorSuppressingStdin(socket);

      this.#forwarder.portForward(podNamespace, podName, [port], socket, null, stdin)
        .catch((e) => {
          console.log(`Failed to create web socket for fowarding to ${ targetName }: ${ e?.error || e }`);
          socket.destroy(e);
        });
    });

    this.#servers.set(namespace, endpoint, port, server);
    // Start listening, and block until the listener has been established.
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        resolve = reject = () => { };
        server.off('listening', resolveOnce);
        server.off('error', rejectOnce);
      };
      const resolveOnce = () => {
        resolve();
        cleanup();
      };
      const rejectOnce = (error) => {
        reject(error);
        cleanup();
      };

      server.once('close', () => {
        rejectOnce(new Error('Server closed'));
      });
      server.once('listening', resolveOnce);
      server.once('error', rejectOnce);
      server.listen({ port: 0, host: 'localhost' });
    });
    if (this.#servers.get(namespace, endpoint, port) !== server) {
      // The port forwarding has been cancelled, or we've set up a new one.
      server.close();
    }
  }

  /**
   * Create a port forward for an endpoint, listening on localhost.
   * @param {string} namespace The namespace containing the end points to forward to.
   * @param {string} endpoint The endpoint to forward to.
   * @param {number} port The port to forward.
   * @return {Promise<number?>} The port number for the port forward.
   */
  async forwardPort(namespace, endpoint, port) {
    const targetName = `${ namespace }/${ endpoint }:${ port }`;

    await this.#createForwardingServer(namespace, endpoint, port);

    const server = this.#servers.get(namespace, endpoint, port);

    if (!server) {
      // Port forwarding was cancelled while we were waiting.
      return null;
    }
    /** @type net.AddressInfo */
    const address = server.address();

    console.log(`Port forwarding is ready: ${ targetName } -> localhost:${ address.port }.`);

    return address.port;
  }

  /**
   * Ensure that a given port forwarding does not exist; if it did, close it.
   * @param {string} namespace The namespace to forward to.
   * @param {string} endpoint The endpoint in the namespace to forward to.
   * @param {number} port The port to forward to on the endpoint.
   */
  async cancelForwardPort(namespace, endpoint, port) {
    const server = this.#servers.get(namespace, endpoint, port);

    this.#servers.delete(namespace, endpoint, port);
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }

  /**
   * Get the port for a given forwarding.
   * @param {string} namespace The namespace to forward to.
   * @param {string} endpoint The endpoint in the namespace to forward to.
   * @param {number} port The port to forward to on the endpoint.
   * @returns {Promise<number?>} The local forwarded port.
   */
  getForwardedPort(namespace, endpoint, port) {
    return this.#servers.get(namespace, endpoint, port)?.address()?.port;
  }
}

module.exports = { KubeClient };
