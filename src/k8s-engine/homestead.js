'use strict';

const resources = require('../resources');

const Helm = require('./helm.js');

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
 * The desired state for Rancher on the cluster; this may not match current
 * state if we have pending operations.
 * @type {State}
 */
let desiredState = State.NONE;

/**
 * Ensure that the homestead chart is installed on the cluster.
 * @param {State} state Whether the homestead chart should be installed.
 * @returns {Promise<boolean>} True if no changes were made.
 */
async function ensureHelmChart(state) {
  const namespace = 'cattle-system';
  const releaseName = 'homestead';
  let actualState = State.NONE;
  try {
    const list = await Helm.list(namespace);
    const entry = list.find(entry => {
      return entry?.namespace === namespace && entry?.name === releaseName;
    });
    actualState = (entry?.status === 'deployed') ? State.HOMESTEAD : State.NONE;
  } catch (e) {
    throw new Error(`Unable to connect to cluster: ${e}`);
  }
  if (actualState === state) {
    return true;
  }

  switch (state) {
  case State.NONE:
    await Helm.uninstall(releaseName, namespace);
    break;
  case State.HOMESTEAD:
  default:
    try {
      await Helm.install(releaseName, resources.get('homestead-0.0.1.tgz'), namespace, true);
    } catch (e) {
      throw new Error(`Unable to install homestead: ${e}`);
    }
    break;
  }

  return false;
}

/**
 * Ensure that port forwarding is set up correctly for the homestead chart.
 * @param {State} state Whether we want port forwarding to be set up.
 * @param {KubeClient} client Connection to Kubernetes for port forwarding.
 */
async function ensurePortForwarding(state, client) {
  const namespace = 'cattle-system';
  switch (state) {
  case State.NONE:
    await client.cancelForwardPort(namespace, 'homestead', 8443);
    homesteadPort = null;
    break;
  case State.HOMESTEAD:
  default:
    homesteadPort = await client.forwardPort(namespace, 'homestead', 8443);
    console.log(`Homestead port forward is ready on ${homesteadPort}`);
    break;
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
    if (!await ensureHelmChart(desiredState)) {
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

module.exports = { State, ensure, getPort };
