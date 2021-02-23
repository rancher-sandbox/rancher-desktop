'use strict';

const childProcess = require('child_process');
const util = require('util');

const resources = require('../resources.js');
const helm = require('./helm.js');
const kubectl = require('./kubectl.js');

/** @typedef {import("./client").KubeClient} KubeClient */

/**
 * The port that we're listening on (on localhost), which is port-forwarded to
 * the rancher pod.
 * @type {number}
 */
let rancherPort = null;
let forwardingChildProcess = null;

/**
 * The valid installation states.
 * @enum {string}
 */
const State = Object.freeze({
  /** Rancher will not be installed. */
  NONE:      'NONE',
  /** Rancher will be installed. */
  RANCHER: 'RANCHER',
});

/**
 * The desired state for Rancher on the cluster; this may not match current
 * state if we have pending operations.
 * @type {State}
 */
let desiredState = State.NONE;

/**
 * Ensure that the rancher chart is installed on the cluster.
 * @param {State} state Whether the rancher chart should be installed.
 * @param {String} ipaddr Used for a rancher hostname
 * @returns {Promise<boolean>} True if no changes were made.
 */
async function ensureHelmChart(state, ipaddr) {
  const namespace = 'cattle-system';
  const releaseName = 'rancher';
  let actualState = State.NONE;

  try {
    const list = await helm.list(namespace);
    const entry = list.find((entry) => {
      return entry?.namespace === namespace && entry?.name === releaseName;
    });

    actualState = (entry?.status === 'deployed') ? State.RANCHER : State.NONE;
  } catch (e) {
    throw new Error(`Unable to connect to cluster: ${ e }`);
  }
  if (actualState === state) {
    return true;
  }

  switch (state) {
  case State.NONE:
    await uninstall(releaseName, namespace);
    break;
  case State.RANCHER:
  default:
    try {
      await install(releaseName, 'rancher-latest/rancher', namespace, true, ipaddr);
    } catch (e) {
      throw new Error(`Unable to install rancher: ${ e }\n ${ e.stack }`);
    }
    break;
  }

  return false;
}

function stopPortForwarding() {
  if (forwardingChildProcess) {
    forwardingChildProcess.kill();
    forwardingChildProcess = null;
  }
}

/**
 * Ensure that port forwarding is set up correctly for the rancher chart.
 * @param {State} state Whether we want port forwarding to be set up.
 * @param {KubeClient} client Connection to Kubernetes for port forwarding.
 */
async function ensurePortForwarding(state, client) {
  const namespace = 'cattle-system';
  const kubectl = resources.executable('/bin/kubectl');

  stopPortForwarding();
  switch (state) {
  case State.NONE:
    await client.cancelForwardPort(namespace, 'rancher', 8443);
    rancherPort = null;
    break;
  case State.RANCHER:
    default:
    rancherPort = 8443;
    forwardingChildProcess = childProcess.spawn(kubectl, ['port-forward', '-n', 'cattle-system', 'service/rancher', `${ rancherPort }:443`]);
    //TODO: Reinstate using the library to do port-forwarding
    // rancherPort = await client.forwardPort(namespace, 'service/rancher', 8443);
    console.log(`Rancher port forward is ready on ${ rancherPort }`);
    break;
  }

  return true;
}

/**
 * Ensure that rancher is installed on the cluster if desired, otherwise it is
 * uninstalled.  Note that the state after returning from this function may be
 * different from the state passed in, if this is being invoked multiple times
 * concurrently.
 * @param {State} state The desired installation state to reach.
 * @param {KubeClient} client Connection to Kubernetes (only for port forwarding).
 * @param {String} ipaddr Used for a rancher hostname
 * @returns {Promise<void>}
 */
async function ensure(state, client, ipaddr) {
  // Set a global variable, so that if we end up invoking this function many
  // times concurrently, we can stabilize quickly.
  desiredState = state;

  let ready = false;

  while (!ready) {
    ready = true;
    if (!await ensureHelmChart(desiredState, ipaddr)) {
      ready = false;
    }
    if (!await ensurePortForwarding(desiredState, client)) {
      ready = false;
    }
  }
}

function getPort() {
  return rancherPort;
}

async function install(releaseName, helmChart, namespace, createNamespace, ipaddr) {
  const k8sNamespaces = (await kubectl.runCommand(['get', 'namespaces', '--output', 'jsonpath={.items[*].metadata.name}'])).split(/\s+/);

  const currentHelmReposEntries = await helm.listRepos() || [];

  const currentHelmRepos = currentHelmReposEntries.map(entry => entry.name);

  if (!k8sNamespaces.includes('cert-manager')) {
    await kubectl.runCommand(['apply', '-f', 'https://raw.githubusercontent.com/jetstack/cert-manager/release-0.9/deploy/manifests/00-crds.yaml']);
    await kubectl.runCommand(['create', 'namespace', 'cert-manager']);
    await kubectl.runCommand(['label', '--overwrite', 'namespace', 'cert-manager', 'certmanager.k8s.io/disable-validation=true']);
  }

  if (!currentHelmRepos.includes('jetstack')) {
    await helm.addRepo('jetstack', 'https://charts.jetstack.io');
  }

  const certManagerDeployments = await kubectl.runCommand(['get', 'deployments', '-n', 'cert-manager', '-o', 'jsonpath={.items[*].metadata.name}']);

  if (!certManagerDeployments.includes('cert-manager')) {
    await helm.install('cert-manager',
      'jetstack/cert-manager',
      'cert-manager',
      false,
      { version: 'v0.9.1' }
    );
    await Promise.all([
      kubectl.runCommand(['rollout', 'status', '-n', 'cert-manager', 'deployment/cert-manager']),
      kubectl.runCommand(['rollout', 'status', '-n', 'cert-manager', 'deployment/cert-manager-webhook']),
    ]);
  }

  if (!currentHelmRepos.includes('rancher-stable')) {
    await helm.addRepo('rancher-stable',
      'https://releases.rancher.com/server-charts/stable');
  }

  await helm.updateRepositories();

  if (!k8sNamespaces.includes('cattle-system')) {
    await kubectl.runCommand(['create', 'namespace', 'cattle-system']);
  }

  // This helm depends on the cert-manager pods all running
  const rancherDeployments = await kubectl.runCommand(['get', 'deployments', '-n', 'cattle-system', '-o', 'jsonpath={.items[*].metadata.name}']);

  if (!rancherDeployments.includes('rancher')) {
    await helm.install('rancher',
      'rancher-stable/rancher',
      'cattle-system',
      false,
      { hostname: `${ ipaddr }.omg.howdoi.website` }
    );
    await kubectl.runCommand(['rollout', 'status', '-n', 'cattle-system', 'deployment/rancher']);
  }
}

async function uninstall(releaseName, namespace) {
  await helm.uninstall('rancher-operator',
    'rancher-operator-system');
  await helm.uninstall('rancher-operator-crd',
    'rancher-operator-system');
  await helm.uninstall('rancher-webhook',
    'cattle-system');
  await helm.uninstall('rancher',
    'cattle-system');
}

module.exports = {
  State, ensure, getPort, stopPortForwarding
};
