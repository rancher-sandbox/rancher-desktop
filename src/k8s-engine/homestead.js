'use strict';

const https = require('https');
const util = require('util');
const resources = require('../resources');
const Helm = require('./helm.js');
const kubectl = require('./kubectl.js');

/** @typedef {import("./client").KubeClient} KubeClient */

/**
 * The port that we're listening on (on localhost), which is port-forwarded to
 * the homestead pod.
 * @type {number}
 */
let homesteadPort = null;

/**
 * The valid installation states.
 * @enum {string}
 */
const State = Object.freeze({
  /** Homestead will not be installed. */
  NONE:      'NONE',
  /** Homestead will be installed. */
  HOMESTEAD: 'HOMESTEAD',
  // TODO: add state for full Rancher
});

/**
 * Check if homestead is installed or not.
 * @param {string} namespace: generally "cattle-system"
 * @param {string} releaseName: "homestead" or "rancher".
 * @param {KubeClient} client Connection to Kubernetes.
 * @returns {State} state: the current state of the installation
 */
async function getCurrentDeployedState(namespace, releaseName, client) {
  const pod = await client.listPods(namespace, releaseName);

  if (pod && pod.status === 'RUNNING') {
    return State.HOMESTEAD;
  }

  const list = await Helm.list(namespace);
  const entry = list.find((entry) => {
    return entry?.namespace === namespace && entry?.name === releaseName;
  });

  return (entry?.status === 'deployed') ? State.HOMESTEAD : State.NONE;
}

/**
 * The desired state for Rancher on the cluster; this may not match current
 * state if we have pending operations.
 * @type {State}
 */
let desiredState = State.NONE;

/**
 * Ensure that the homestead chart is installed on the cluster.
 * @param {State} desiredState Whether the homestead chart should be installed.
 * @param {KubeClient} client Connection to Kubernetes.
 * @returns {Promise<boolean>} True if no changes were made.
 */
async function ensureHelmChart(desiredState, client) {
  const namespace = 'cattle-system';
  const releaseName = 'homestead';
  let actualState = State.NONE;

  try {
    actualState = await getCurrentDeployedState(namespace, releaseName, client);
  } catch (e) {
    console.log(`Unable to connect to cluster: ${ e }`);
    throw new Error(`Unable to connect to cluster: ${ e }`);
  }

  if (actualState === desiredState) {
    return true;
  }

  switch (desiredState) {
  case State.NONE:
    await Helm.uninstall(releaseName, namespace);
    break;
  case State.HOMESTEAD:
    try {
      await Helm.install(releaseName, resources.get('homestead-0.0.1.tgz'), namespace, true);
      await kubectl.waitForDeployment(namespace, releaseName, 15 * 1000);
    } catch (e) {
      throw new Error(`Unable to install homestead: ${ e }`);
    }
    break;
  default:
    throw new Error(`Unexpected deployment state of ${ desiredState }, should be ${ State.NONE } or ${ State.HOMESTEAD }`);
  }

  return false;
}

/**
 * Ensure that we can actually make a connection; sometimes the first few get
 * lost, possibly because the underlying server is not ready yet.
 * @param {string} namespace The namespace to forward to.
 * @param {string} endpoint The endpoint in the namespace to forward to.
 * @param {number} port The port to forward to on the endpoint.
 * @param {KubeClient} client
 */
async function waitForConnection(namespace, endpoint, port, client) {
  const targetName = `${ namespace }/${ endpoint }:${ port }`;
  const sleep = util.promisify(setTimeout);

  for (; ;) {
    const listeningPort = await client.getForwardedPort(namespace, endpoint, port);

    if (!listeningPort) {
      await sleep(1000);
      continue;
    }
    try {
      await new Promise((resolve, reject) => {
        console.log(`Attempting to make probe request for ${ targetName }...`);
        const req = https.get({ port: listeningPort, rejectUnauthorized: false }, (response) => {
          response.destroy();
          if (response.statusCode >= 200 && response.statusCode < 400) {
            return resolve();
          }
          reject(`Got unexpected response ${ response?.statusCode }`);
        });

        req.on('close', reject);
        req.on('error', reject);
        // Manually reject on a time out
        sleep(5000, new Error('Timed out making probe connection')).then(reject);
      });
    } catch (e) {
      console.log(`Error making probe connection to ${ targetName }: ${ e }`);
      // Wait a bit to ensure we don't just chew up CPU for no reason.
      await sleep(1000);
      continue;
    }

    return;
  }
}

/**
 * Ensure that port forwarding is set up correctly for the homestead chart.
 * @param {State} state Whether we want port forwarding to be set up.
 * @param {KubeClient} client Connection to Kubernetes for port forwarding.
 */
async function ensurePortForwarding(state, client) {
  const namespace = 'cattle-system';
  const endpoint = 'homestead';
  const port = 8443;

  switch (state) {
  case State.NONE:
    await client.cancelForwardPort(namespace, endpoint, port);
    homesteadPort = null;
    break;
  case State.HOMESTEAD: {
    const newPort = await client.forwardPort(namespace, endpoint, port);

    await waitForConnection(namespace, endpoint, port, client);
    homesteadPort = newPort;
    console.log(`Homestead port forward is ready on ${ homesteadPort }`);
    break;
  }
  default:
    throw new Error(`Unexpected desired state of #{state}`);
  }

  return true;
}

/**
 * Ensure that homestead is installed on the cluster if desired, otherwise it is
 * uninstalled.  Note that the state after returning from this function may be
 * different from the state passed in, if this is being invoked multiple times
 * concurrently.
 * @param {State} state The desired installation state to reach.
 * @param {KubeClient} client Connection to Kubernetes (only for port forwarding).
 * @returns {Promise<void>}
 */
async function ensure(state, client) {
  // Set a global variable, so that if we end up invoking this function many
  // times concurrently, we can stablize quickly.
  desiredState = state;

  let ready = false;

  while (!ready) {
    ready = true;
    if (!await ensureHelmChart(desiredState, client)) {
      ready = false;
    }
    if (!await ensurePortForwarding(desiredState, client)) {
      ready = false;
    }
  }
}

function getPort() {
  return homesteadPort;
}

module.exports = {
  State, ensure, getPort
};
