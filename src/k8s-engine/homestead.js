'use strict';

const Helm  = require('./helm.js');

// This function ensures that homestead is running in a cluster
// TODO: Handle upgrading homestead
async function ensure() {
  // Check if cluster available
  // Check if homestead is running
  let out;
  try {
    await Helm.list('cattle-system');
  } catch (e) {
    // Can't connect to the cluster so there is a problem.
    throw new Error(`Unable to connect to cluster ${e}`);
  }

  try {
    out = await Helm.status('homestead', 'cattle-system');
  } catch(e) {
    // Couldn't connect to cluster so throw error
    if (e.includes("Kubernetes cluster unreachable")) {
      throw new Error(`Unable to connect to cluster ${e}`);
    }

    // Homestead isn't installed so install it.
    try {
      out = await Helm.install('homestead', './resources/homestead-0.0.1.tgz', 'cattle-system', true);
    } catch (e2) {
      throw new Error(`Unable to install homestead: ${e2}`);
    }
  }

  return out;
}

exports.ensure = ensure;
