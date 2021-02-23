'use strict';

const { spawn } = require('child_process');
const process = require('process');
const paths = require('xdg-app-paths')({ name: 'rancher-desktop' });
const resources = require('../resources');

/**
 *
 * @param {Array[string]} args
 * @param exitfunc
 */
function runCommand(args) {
  return new Promise((resolve, reject) => {
    const opts = {};
    let output = '';
    let errorMessage = '';

    opts.env = { ...process.env };
    opts.env.MINIKUBE_HOME = paths.data();

    const kubectl = resources.executable('/bin/kubectl');

    const command = spawn(kubectl, args, opts);

    // TODO: For data toggle this is based on a debug mode
    command.stdout.on('data', (data) => {
      const buf = data.toString();

      output += buf;
      console.log(buf);
    });

    command.stderr.on('data', (data) => {
      const buf = data.toString();

      errorMessage += buf;
      console.error(buf);
    });

    command.on('exit', (code, sig) => {
      if (!code) {
        resolve(output);
      } else {
        reject({ errorCode: code, message: errorMessage });
      }
    });
  });
}

// The K8s JS library will get the current context but does not have the ability
// to save the context. The current version of the package targets k8s 1.18 and
// there are new config file features (e.g., proxy) that may be lost by outputting
// the config with the library. So, we drop down to kubectl for this.
function setCurrentContext(cxt, exitFunc) {
  runCommand(['config', 'use-context', cxt], exitFunc)
    .then(exitFunc)
    .catch((e) => {
      console.error(`Error setting context: ${ e }`);
    });
}

async function waitForPods(namespace) {
  let delay = 100;

  while (true) {
    const output = await runCommand(['get', 'pods', '-n', namespace]);
    const lines = output.split(/[\r\n]+/)
      .filter(s => s.startsWith('cert-manager'));

    if (lines.length === 0) {
      throw new Error('unexpected: no pods in namespace cert-manager');
    }
    const nonRunningLines = lines.filter((line) => {
      const fields = line.split(/\s+/);

      return fields[2] !== 'Running';
    });

    if (nonRunningLines.length === 0) {
      return true;
    }
    delay += 100;
    if (delay >= 2100) {
      throw new Error('cert-manager pods aren\'t starting up after 20 seconds');
    }
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}
exports.runCommand = runCommand;
exports.setCurrentContext = setCurrentContext;
exports.waitForPods = waitForPods;
