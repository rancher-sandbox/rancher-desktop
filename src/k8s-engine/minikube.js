'use strict';

// This file contains the logic needed to start minikube. Minikube is the
// current engine used to power rd. This will likely change in the future as
// we work out the exact needs of the project and work to setup an underlying
// environment that works for it. For example, on Windows can we use WSL2?

// TODO: Minikube handling should be completely overhaulded which includes a
// package, handling for non-mac, status detection, and more.
// TODO: Set it up so that an exit during startup does not cause issues.
// TODO: Prompt for password for elevated permissions on macos.

const { EventEmitter } = require('events');
const process = require('process');
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const util = require('util');
const paths = require('xdg-app-paths')({ name: 'rancher-desktop' });
const resources = require('../resources');
const Homestead = require('./homestead.js');
const K8s = require('./k8s.js');

/** @typedef { import("../config/settings").Settings } Settings */

class Minikube extends EventEmitter {
  // The state of Kubernetes; a setter is used to ensure we will always emit
  // a "state-changed" event when we set it.
  get #state() {
    return this.#internalState;
  }

  set #state(value) {
    this.#internalState = value;
    this.emit('state-changed', this.#internalState);
    switch (value) {
    case K8s.State.STOPPING:
    case K8s.State.STOPPED:
    case K8s.State.ERROR:
      this.#client?.destroy();
      this.#client = null;
      break;
    }
  }

  /**
   * The backing field for #state
   * @type {K8s.State}
   */
  #internalState = K8s.State.STOPPED;

  /**
   * #client is a Kubernetes client connected to the internal cluster.
   * @type {K8s.Client}
   */
  #client = null;

  /** #current holds the current in process job. */
  #current

  /**
   * #currentType is set if we're in the process of changing states.
   * @type {string}
   */
  #currentType

  constructor(cfg) {
    super();
    this.cfg = cfg;
    this.on('settings-update', this.#onSettingsChanged.bind(this));
  }

  get state() {
    return this.#state;
  }

  /**
   * Start the Kubernetes cluster.
   * @param {boolean} nested Internal use only, do not specify.
   * @returns {Promise<undefined>}
   */
  async start(nested = false) {
    if (!nested) {
      while (this.#currentType !== undefined) {
        await sleep(500);
      }
    }
    this.#currentType = 'start';

    await new Promise((resolve, reject) => {
      if (!nested && this.#state !== K8s.State.STOPPED) {
        reject(new Error(`Attempting to start unstopped Kubernetes cluster: ${ this.#state }`));
      }
      this.#state = K8s.State.STARTING;

      let permsMsg = false;

      // Using a custom path so that the minikube default (if someone has it
      // installed) does not conflict with this app.
      const opts = {};

      opts.env = { ...process.env };
      opts.env.MINIKUBE_HOME = paths.data();
      const resourcePath = resources.get(os.platform());
      const pth = Array.from(opts.env.PATH?.split(path.delimiter) ?? []);

      pth.unshift(resourcePath);
      opts.env.PATH = pth.join(path.delimiter);

      // TODO: Handle platform differences
      const args = ['start', '-b', 'k3s', '-p', 'rancher-desktop', '--driver', 'hyperkit', '--container-runtime', 'containerd', '--interactive=false'];

      // TODO: Handle the difference between changing version where a wipe is needed
      // and upgrading. All if there was a change.
      args.push(`--kubernetes-version=${ this.cfg.version }`);
      const memoryInGB = this.cfg.memoryInGB;

      if (memoryInGB !== 2) {
        args.push(`--memory=${ memoryInGB }g`);
      }

      const numCPUs = this.cfg.numberCPUs;

      if (numCPUs !== 2) {
        args.push(`--cpus=${ numCPUs }`);
      }
      const bat = spawn(resources.executable('minikube'), args, opts);

      this.#current = bat;
      // TODO: For data toggle this based on a debug mode
      bat.stdout.on('data', (data) => {
        const subst = "The 'hyperkit' driver requires elevated permissions.";
        const str = data.toString();

        if (str.includes(subst)) {
          permsMsg = true;
        }

        console.log(data.toString());
      });

      let errorMessage = '';

      bat.stderr.on('data', (data) => {
        console.error(data.toString());
        errorMessage += data;
      });

      bat.on('exit', async(code, sig) => {
        try {
          // When nested we do not want to keep going down the rabbit hole on error
          if (code === 80 && permsMsg && !nested) {
            // TODO: perms modal
            // TODO: Handle non-macos cases. This can be changed when multiple
            // hypervisors are used.
            await startAgain(this).catch(reject);
            resolve();

            return;
          }

          // Run the callback function.
          if (code === 0) {
            this.#state = K8s.State.STARTED;
            if (errorMessage) {
              reject({
                context: 'starting minikube', errorCode: code, message: errorMessage
              });
            } else {
              resolve();
            }
          } else if (sig === 'SIGINT') {
            // If the user manually stops before we finish, we get a SIGNINT.
            this.#state = K8s.State.STOPPED;
            resolve();
          } else {
            this.#state = K8s.State.ERROR;
            const fixedErrorMessage = customizeMinikubeMessage(errorMessage);

            reject({
              context: 'starting minikube', errorCode: code, message: fixedErrorMessage
            });
          }
        } finally {
          this.clear();
        }
      });

      // Minikube puts the minikube information in a hidden directory. Use a
      // symlink on mac to make it visible to users searching their library.
      if (os.platform() === 'darwin') {
        if (!fs.existsSync(`${ paths.data() }/minikube`) && fs.existsSync(`${ paths.data() }/.minikube`)) {
          fs.symlinkSync(`${ paths.data() }/.minikube`, `${ paths.data() }/minikube`);
        }
      }
    });

    // Check to see if the start was aborted.
    if (this.#state === K8s.State.STOPPED) {
      return;
    }

    this.#state = K8s.State.STARTED;
    this.#client = new K8s.Client();
    this.#client.on('service-changed', services => {
      this.emit('service-changed', services);
    });

    await this.#installRancher();
  }

  async stop() {
    if (this.#currentType === 'start') {
      this.#current.kill('SIGINT');
    }

    while (this.#currentType !== undefined) {
      await sleep(500);
    }

    if (this.#state === K8s.State.STOPPED) {
      return;
    }

    this.#currentType = 'stop';
    this.#state = K8s.State.STOPPING;

    return new Promise((resolve, reject) => {
      // Using a custom path so that the minikube default (if someone has it
      // installed) does not conflict with this app.
      const opts = {};

      opts.env = { ...process.env };
      opts.env.MINIKUBE_HOME = paths.data();
      const resourcePath = resources.get(os.platform());
      const pth = Array.from(opts.env.PATH?.split(path.delimiter) ?? []);

      pth.unshift(resourcePath);
      opts.env.PATH = pth.join(path.delimiter);

      // TODO: There MUST be a better way to exit. Do that.
      let errorMessage = '';

      const bat = spawn(resources.executable('minikube'), ['stop', '-p', 'rancher-desktop'], opts);

      this.#current = bat;
      // TODO: For data toggle this based on a debug mode
      bat.stdout.on('data', (data) => {
        console.log(data.toString());
      });

      bat.stderr.on('data', (data) => {
        errorMessage += data;
        console.error(data.toString());
      });

      bat.on('exit', (code) => {
        this.clear();
        if (code === 0 || code === undefined || code === null) {
          this.#state = K8s.State.STOPPED;
          resolve(0);
        } else {
          this.#state = K8s.State.ERROR;
          reject({
            context: 'stopping minikube', errorCode: code, message: errorMessage
          });
        }
      });
    });
  }

  async del() {
    while (this.#currentType !== undefined) {
      await sleep(500);
    }
    this.#currentType = 'del';

    return new Promise((resolve, reject) => {
      // Cannot delete a running instance
      if (this.state !== K8s.State.STOPPED) {
        reject(1);
      }
      const opts = {};

      opts.env = { ...process.env };
      opts.env.MINIKUBE_HOME = paths.data();
      const resourcePath = resources.get(os.platform());
      const pth = Array.from(opts.env.PATH?.split(path.delimiter) ?? []);

      pth.unshift(resourcePath);
      opts.env.PATH = pth.join(path.delimiter);

      // TODO: There MUST be a better way to exit. Do that.
      const bat = spawn(resources.executable('minikube'), ['delete', '-p', 'rancher-desktop'], opts);

      this.#current = bat;
      // TODO: For data toggle this based on a debug mode
      bat.stdout.on('data', (data) => {
        console.log(data.toString());
      });

      let errorMessage = '';

      bat.stderr.on('data', (data) => {
        errorMessage += data;
        console.error(data.toString());
      });

      bat.on('exit', (code) => {
        this.clear();
        if (code === 0) {
          resolve(code);
        } else {
          reject({
            context: 'deleting minikube', errorCode: code, message: errorMessage
          });
        }
      });
    });
  }

  clear() {
    this.#current = undefined;
    this.#currentType = undefined;
  }

  async homesteadPort() {
    for (; ;) {
      const port = Homestead.getPort();

      if (port !== null) {
        return port;
      }
      await sleep(500);
    }
  }

  /**
   * Fetch the list of services currently known to Kubernetes.
   * @param {string?} namespace The namespace containing services; omit this to
   *                            return services across all namespaces.
   */
  listServices(namespace = null) {
    return this.#client?.listServices(namespace) || [];
  }

  /**
   * Forward a single service port, returning the resulting local port number.
   * @param {string} namespace The namespace containing the service to forward.
   * @param {string} service The name of the service to forward.
   * @param {number} port The internal port number of the service to forward.
   * @returns {Promise<number?>} The port listening on localhost that forwards to the service.
   */
  async forwardPort(namespace, service, port) {
    return await this.#client?.forwardPort(namespace, service, port);
  }

  /**
   * Cancel an existing port forwarding.
   * @param {string} namespace The namespace containing the service to forward.
   * @param {string} service The name of the service to forward.
   * @param {number} port The internal port number of the service to forward.
   */
  async cancelForward(namespace, service, port) {
    return await this.#client?.cancelForwardPort(namespace, service, port);
  }

  /**
   * Reset the cluster, completely deleting any user configuration.  This does
   * not automatically restart the cluster.
   */
  async factoryReset() {
    if (this.#state !== K8s.State.STOPPED) {
      await this.stop();
    }
    await this.del();
    // fs.rm does not yet exist in the version of node we pull in from electron
    await util.promisify(fs.rm ?? fs.rmdir)(paths.data(), { recursive: true, force: true });
  }

  /**
   * Install Rancher / homestead.
   */
  async #installRancher() {
    // Ensure homestead is running
    console.log('starting homestead');
    if (this.#state === K8s.State.READY) {
      // Mark this as not quite ready yet.
      this.#state = K8s.State.STARTED;
    }
    const mode = this.cfg?.rancherMode || 'HOMESTEAD';

    try {
      await Homestead.ensure(mode, this.#client);
    } catch (e) {
      console.log(`Error starting homestead: ${ e }`);
      this.#state = K8s.State.ERROR;
      throw {
        context: 'installing homestead', errorCode: 1, message: 'Error starting homestead'
      };
    }

    console.log('Everything is ready.');
    this.#state = K8s.State.READY;
  }

  /**
   * Event listener for when settings change.
   * @param {Settings} settings The new settings.
   */
  #onSettingsChanged(settings) {
    this.cfg = settings.kubernetes;
    // Ensure that the Rancher UI is in the correct state
    if (this.#state === K8s.State.STARTED || this.#state === K8s.State.READY) {
      this.#installRancher().catch((error) => {
        // TODO: handle this correctly
        console.error(error);
      });
    }
  }
}

exports.Minikube = Minikube;

/** This will try to start again, this time after handling permissions
 * @param {Minikube} obj The Minikube instance.
 */
async function startAgain(obj) {
  const sudo = util.promisify(require('sudo-prompt').exec);
  const filePath = path.join(paths.data(), '.minikube', 'bin', 'docker-machine-driver-hyperkit');
  const command = `sh -c 'chown root:wheel "${ filePath }" && chmod u+s "${ filePath }"'`;
  const options = { name: 'Rancher Desktop' };

  await sudo(command, options);

  return await obj.start(true);
}

function sleep(delay) {
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Simple function to wrap paths with spaces with double-quotes. Intended for human consumption.
 * Trying to avoid adding yet another external dependency.
 * @param {string} fullpath
 * @returns {string}
 */
function quoteIfNecessary(s) {
  return /\s/.test(s) ? `"${ s }"` : s;
}

function customizeMinikubeMessage(errorMessage) {
  console.log(errorMessage);
  const p = /X Exiting due to K8S_DOWNGRADE_UNSUPPORTED:\s*(Unable to safely downgrade .*?)\s+\*\s*Suggestion:\s+1\)\s*(Recreate the cluster with.*? by running:)\s+(minikube delete -p rancher-desktop)\s+(minikube start -p rancher-desktop --kubernetes-version=.*?)\n/s;
  const m = p.exec(errorMessage);

  if (m) {
    const fixedMessage = `${ m[1] }

Suggested fix:

${ m[2] }

export MINIKUBE_HOME=${ quoteIfNecessary(paths.data()) }

${ m[3] }

${ m[4] } --driver=hyperkit
`;

    // Keep this variable for future ease of logging
    return fixedMessage;
  }

  return errorMessage;
}
