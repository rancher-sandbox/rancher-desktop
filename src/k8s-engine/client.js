'use strict';

// This file contains wrappers to interact with the installed Kubernetes cluster

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
     * The port that homestead is forwarded on.  If unavailable, then a new port
     * forward will automatically be created, listening on localhost.
     */
    async homesteadPort() {
        if (!this.#server) {
            const namespace = "cattle-system";
            // Find a pod for homestead
            let { body } = await this.#coreV1API.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, "app=homestead", 1);
            let podName = body.items[0].metadata.name;
            // Set up the port forwarding server
            let server = net.createServer((socket) => {
                this.#forwarder.portForward(namespace, podName, [8443], socket, null, socket);
            });
            // Start listening, and block until the listener has been established.
            await new Promise((resolve, reject) => {
                let done = false;
                server.once('listening', () => { if (!done) resolve(); done = true; });
                server.once('error', (error) => { if (!done) reject(error); done = true; });
                server.listen({ port: 0, host: "localhost" });
            });
            this.#server = server;
        }
        /** @type net.AddressInfo */
        let address = this.#server.address();
        return address.port;
    }
}

module.exports = { KubeClient };
