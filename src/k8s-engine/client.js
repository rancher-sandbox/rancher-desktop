'use strict';

// This file contains wrappers to interact with the installed Kubernetes cluster

const https = require("https");
const net = require("net");
const k8s = require("@kubernetes/client-node");

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

    /**
     * initialize the KubeClient so that we are ready to talk to it.
     */
    initialize() {
        this.#server?.close();
        this.#server = null;
        this.#kubeconfig.loadFromDefault();
        this.#kubeconfig.currentContext = 'rancher-desktop';
        this.#forwarder = new k8s.PortForward(this.#kubeconfig, true);
    }

    /**
     * @type k8s.CoreV1Api
     */
    get #coreV1API() {
        return this.#_coreV1API ||= this.#kubeconfig.makeApiClient(k8s.CoreV1Api);
    }
    #_coreV1API = null;

    /**
     * Return a pod that is part of a given endpoint and ready to receive traffic.
     * @param {string} namespace The namespace in which to look for resources.
     * @param {string} endpointName the name of an endpoint that controls ready pods.
     * @returns {Promise<k8s.V1Pod>}
     */
    async getActivePod(namespace, endpointName) {
        console.log(`Attempting to locate ${endpointName} pod...`);
        // Loop fetching endpoints, until it matches at least one pod.
        /** @type k8s.V1ObjectReference? */
        let target = null;
        // TODO: switch this to using watch.
        for (; ;) {
            /** @type k8s.V1EndpointsList */
            let endpoints;
            ({ body: endpoints } = await this.#coreV1API.listNamespacedEndpoints(namespace, { headers: { name: endpointName } }));
            target = endpoints?.items?.pop()?.subsets?.pop()?.addresses?.pop()?.targetRef;
            if (target) {
                break;
            }
            console.log(`Could not find ${endpointName} pod (${endpoints ? "did" : "did not"} get endpoints), retrying...`);
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        // Fetch the pod
        let { body: pod } = await this.#coreV1API.readNamespacedPod(target.name, target.namespace);
        console.log(`Got ${endpointName} pod: ${pod?.metadata?.namespace}:${pod?.metadata?.name}`);
        return pod;
    }

    /**
     * Create a port forward for an endpoint, listening on localhost.
     * Note: currently we can only set up one port fowarding.
     * @param {string} namespace The namespace containing the end points to forward to.
     * @param {string} endpoint The endpoint to forward to.
     * @param {number} port The port to forward.
     * @return {Promise<number>} The port number for the port forward.
     */
    async forwardPort(namespace, endpoint, port) {
        /** @type net.AddressInfo? */
        let address = null;
        if (!this.#server) {
            console.log("Starting new port forwarding server...");
            // Set up the port forwarding server
            let server = net.createServer(async (socket) => {
                socket.on("error", (error) => {
                    // Handle the error, so that we don't get an ugly dialog about it.
                    switch (error?.code) {
                        case "ECONNRESET":
                        case "EPIPE":
                            break;
                        default:
                            console.log(`Error creating proxy: ${error?.error}`);
                    }
                });
                // Find a working pod
                let pod = await this.getActivePod(namespace, endpoint);
                let { metadata: { namespace: podNamespace, name: podName } } = pod;
                this.#forwarder.portForward(podNamespace, podName, [port], socket, null, socket)
                    .catch((e) => {
                        console.log(`Failed to create web socket for fowarding: ${e?.error}`);
                        socket.destroy(e);
                    });
            });
            // Start listening, and block until the listener has been established.
            await new Promise((resolve, reject) => {
                let done = false;
                server.once('listening', () => { if (!done) resolve(); done = true; });
                server.once('error', (error) => { if (!done) reject(error); done = true; });
                server.listen({ port: 0, host: "localhost" });
            });
            address = server.address();
            // Ensure we can actually make a connection - sometimes the first one gets lost.
            for (; ;) {
                try {
                    await new Promise((resolve, reject) => {
                        console.log(`Attempting to make probe request...`);
                        let req = https.get({ port: address.port, rejectUnauthorized: false }, (response) => {
                            response.destroy();
                            if (response.statusCode >= 200 && response.statusCode < 400) {
                                return resolve();
                            }
                            reject(`Got unexpected response ${response?.statusCode}`);
                        });
                        req.on('close', reject);
                        req.on('error', reject);
                        // Manually reject on a time out
                        setTimeout(() => reject(new Error("Timed out making probe connection")), 5000);
                    });
                } catch (e) {
                    console.log(`Error making probe connection: ${e}`);
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    continue;
                }
                break;
            }
            console.log("Port forwarding is ready.");
            this.#server = server;
        }
        address ||= this.#server.address();
        return address.port;
    }
}

module.exports = { KubeClient };
