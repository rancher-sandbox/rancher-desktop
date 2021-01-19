'use strict';

const resources = require('../resources');

const Helm  = require('./helm.js');

/**
 * The port that we're listening on (on localhost), which is port-forwarded to
 * the homestead pod.
 * @type {number}
 */
let homesteadPort = null;

/**
 * Ensure that homestead is running in a cluster.
 * TODO: Handle upgrading homestead.
 * @param {KubeClient} client Connection to Kubernetes (only for port forwarding).
 */
async function ensure(client) {
  const namespace = "cattle-system";
  const releaseName = "homestead";
  // Check if cluster available
  // Check if homestead is running
  let out;
  try {
    await Helm.list(namespace);
  } catch (e) {
    // Can't connect to the cluster so there is a problem.
    throw new Error(`Unable to connect to cluster ${e}`);
  }

  try {
    out = await Helm.status(releaseName, namespace);
  } catch(e) {
    // Couldn't connect to cluster so throw error
    if (e.includes("Kubernetes cluster unreachable")) {
      throw new Error(`Unable to connect to cluster ${e}`);
    }

    // Homestead isn't installed so install it.
    try {
      out = await Helm.install(releaseName, resources.get('homestead-0.0.1.tgz'), namespace, true);
    } catch (e2) {
      throw new Error(`Unable to install homestead: ${e2}`);
    }
  }

  // Set up port forwarding, without actually using it.
  homesteadPort = await client.forwardPort(namespace, "homestead", 8443);
  console.log(`Homestead port forward is ready on ${homesteadPort}`);
  return out;
}

function getPort() {
  return homesteadPort;
}

module.exports = { ensure, getPort };
