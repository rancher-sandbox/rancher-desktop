'use strict';

const { spawn } = require('child_process');
const os = require('os');
const process = require('process');
const paths = require('xdg-app-paths')({ name: 'rancher-desktop' });

// The K8s JS library will get the current context but does not have the ability
// to save the context. The current version of the package targets k8s 1.18 and
// there are new config file features (e.g., proxy) that may be lost by outputting
// the config with the library. So, we drop down to kubectl for this.
function setCurrentContext(cxt, exitfunc) {
  const opts = {};

  opts.env = { ...process.env };
  opts.env.MINIKUBE_HOME = paths.data();

  const bat = spawn(`./resources/${ os.platform() }/bin/kubectl`, ['config', 'use-context', cxt], opts);

  // TODO: For data toggle this based on a debug mode
  bat.stdout.on('data', (data) => {
    console.log(data.toString());
  });

  bat.stderr.on('data', (data) => {
    console.error(data.toString());
  });

  bat.on('exit', exitfunc);
}

/**
 * Check if homestead is installed or not.
 * @param {string} namespace: generally "cattle-system"
 * @param {string} releaseName: "homestead" or "rancher".
 * @param {KubeClient} client Connection to Kubernetes.
 * @returns {State} state: the current state of the installation
 */
/**
 * Verify that we have a running deployment <namespace>/<name> within the specified time
 * @param {string} namespace
 * @param {string} name
 * @param {integer} timeLimit in msec, default of 0 means no limit.
 * @returns {Promise<string>} output from the command
 */
async function waitForDeployment(namespace, name, timeLimit = 0) {
  return await new Promise((resolve, reject) => {
    const opts = {};
    let timeElapsedID = 0;
    let stdout = '';
    let stderr = '';

    opts.env = { ...process.env };
    opts.env.MINIKUBE_HOME = paths.data();

    const command = spawn(
      `./resources/${ os.platform() }/bin/kubectl`,
      ['rollout', 'status', '-n', namespace, `deployment/${ name }`, '-w'], opts);

    if (timeLimit > 0) {
      timeElapsedID = setTimeout(() => {
        const msg = `rollout status timed out at ${ timeLimit / 1000.0 } sec`;

        timeElapsedID = 0;
        console.log(msg);
        stderr += msg;
        command.kill();
      }, timeLimit);
    }

    command.stdout.on('data', (data) => {
      console.log(data.toString());
      stdout += data.toString();
    });

    command.stderr.on('data', (data) => {
      console.error(data.toString());
      stderr += data.toString();
    });

    command.on('exit', (code) => {
      if (timeElapsedID) {
        clearTimeout(timeElapsedID);
      }
      if (code !== 0) {
        reject(new Error(stderr));
      } else {
        resolve(stdout);
      }
    });
  });
}

exports.setCurrentContext = setCurrentContext;
exports.waitForDeployment = waitForDeployment;
