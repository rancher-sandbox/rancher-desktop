'use strict';

// This file contains wrappers to interact with the installed Kubernetes cluster

const events = require('events');
const https = require('https');
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
    /**
     * @type net.Server?
     */
    #server = null;
    #shutdown = false;

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
      this.#server?.close();
      this.#server = null;
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
    async getActivePod(namespace, endpointName) {
      console.log(`Attempting to locate ${ endpointName } pod...`);
      // Loop fetching endpoints, until it matches at least one pod.
      /** @type k8s.V1ObjectReference? */
      let target = null;

      // TODO: switch this to using watch.
      while (!this.#shutdown) {
        /** @type k8s.V1EndpointsList */
        const endpoints = await this.#coreV1API.listNamespacedEndpoints(namespace, { headers: { name: endpointName } });

        target = endpoints?.body?.items?.pop()?.subsets?.pop()?.addresses?.pop()?.targetRef;
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
     * Create a port forward for an endpoint, listening on localhost.
     * Note: currently we can only set up one port fowarding.
     * @param {string} namespace The namespace containing the end points to forward to.
     * @param {string} endpoint The endpoint to forward to.
     * @param {number} port The port to forward.
     * @return {Promise<number?>} The port number for the port forward.
     */
    async forwardPort(namespace, endpoint, port) {
      /** @type net.AddressInfo? */
      let address = null;

      if (!this.#server) {
        console.log('Starting new port forwarding server...');
        // Set up the port forwarding server
        const server = net.createServer(async(socket) => {
          socket.on('error', (error) => {
            // Handle the error, so that we don't get an ugly dialog about it.
            switch (error?.code) {
            case 'ECONNRESET':
            case 'EPIPE':
              break;
            default:
              console.log(`Error creating proxy: ${ error?.error }`);
            }
          });
          // Find a working pod
          const pod = await this.getActivePod(namespace, endpoint);

          if (this.#shutdown) {
            socket.destroy(new Error('Shutting down'));

            return;
          }
          const { metadata: { namespace: podNamespace, name: podName } } = pod;
          const stdin = new ErrorSuppressingStdin(socket);

          this.#forwarder.portForward(podNamespace, podName, [port], socket, null, stdin)
            .catch((e) => {
              console.log(`Failed to create web socket for fowarding: ${ e?.error }`);
              socket.destroy(e);
            });
        });

        // Start listening, and block until the listener has been established.
        await new Promise((resolve, reject) => {
          let done = false;

          server.once('listening', () => {
            if (!done) {
              resolve();
            } done = true;
          });
          server.once('error', (error) => {
            if (!done) {
              reject(error);
            } done = true;
          });
          server.listen({ port: 0, host: 'localhost' });
        });
        address = server.address();
        // Ensure we can actually make a connection - sometimes the first one gets lost.
        while (!this.#shutdown) {
          try {
            await new Promise((resolve, reject) => {
              console.log('Attempting to make probe request...');
              const req = https.get({ port: address.port, rejectUnauthorized: false }, (response) => {
                response.destroy();
                if (response.statusCode >= 200 && response.statusCode < 400) {
                  return resolve();
                }
                reject(`Got unexpected response ${ response?.statusCode }`);
              });

              req.on('close', reject);
              req.on('error', reject);
              // Manually reject on a time out
              setTimeout(() => reject(new Error('Timed out making probe connection')), 5000);
            });
          } catch (e) {
            console.log(`Error making probe connection: ${ e }`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          }
          break;
        }
        if (this.#shutdown) {
          return;
        }
        console.log('Port forwarding is ready.');
        this.#server = server;
      }
      if (this.#shutdown) {
        return null;
      }
      address ||= this.#server.address();

      return address.port;
    }

    async cancelForwardPort() {
      const server = this.#server;

      this.#server = null;
      if (server) {
        await new Promise(resolve => server.close(resolve));
      }
    }
}

module.exports = { KubeClient };
