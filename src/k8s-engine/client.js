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
     * Return a pod for homestead that is ready to receive connections.
     */
    async #homesteadPod() {
        console.log("Attempting to locate homestead pod...");
        const namespace = "cattle-system";
        const endpointName = "homestead";
        // Loop fetching endpoints, until it matches at least one pod.
        /** @type k8s.V1ObjectReference? */
        let target = null;
        for (; ;) {
            /** @type k8s.V1EndpointsList */
            let endpoints;
            ({ body: endpoints } = await this.#coreV1API.listNamespacedEndpoints(namespace, { headers: { name: endpointName } }));
            console.log("Got homestead endpoints", endpoints);
            target = endpoints?.items?.pop()?.subsets?.pop()?.addresses?.pop()?.targetRef;
            console.log("Got homestead target", target);
            if (target) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        // Fetch the pod
        let { body: pod } = await this.#coreV1API.readNamespacedPod(target.name, target.namespace);
        console.log("Got homestead pod", pod);
        return pod;
    }

    /**
     * The port that homestead is forwarded on.  If unavailable, then a new port
     * forward will automatically be created, listening on localhost.
     */
    async homesteadPort() {
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
                            console.log(`Error proxying to homestead:`, error);
                    }
                });
                // Find a working homestead pod
                let { metadata: { namespace, name: podName } } = await this.#homesteadPod();
                this.#forwarder.portForward(namespace, podName, [8443], socket, null, socket)
                    .catch((e) => {
                        console.log("Failed to create web socket for fowarding:", e.toString());
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
                    });
                } catch (e) {
                    console.log("Error making probe connection", e);
                    continue;
                }
                break;
            }
            console.log("homestead port forwarding is ready");
            this.#server = server;
        }
        address ||= this.#server.address();
        return address.port;
    }
}

module.exports = { KubeClient };
