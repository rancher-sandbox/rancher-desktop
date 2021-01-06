'use strict';

// This file contains the logic needed to start minikube. Minikube is the
// current engine used to power rd. This will likely change in the future as
// we work out the exact needs of the project and work to setup an underlying
// environment that works for it. For example, on Windows can we use WSL2?

// TODO: Minikube handling should be completely overhaulded which includes a
// package, handling for non-mac, status detection, and more.
// TODO: Set it up so that an exit during startup does not cause issues.
// TODO: Prompt for password for elevated permissions on macos.

const paths = require('xdg-app-paths')({name: 'rancher-desktop'});
const { EventEmitter } = require('events');
const process = require('process');
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const K8s = require('./k8s.js');
const Homestead = require('./homestead.js');


class Minikube extends EventEmitter {

  // The state of Kubernetes; a setter is used to ensure we will always emit
  // a "state-changed" event when we set it.
  get #state() {
    return this.#internalState;
  }
  set #state(value) {
    this.#internalState = value;
    this.emit("state-changed", this.#internalState);
  }

  // The backing field for #state
  #internalState = K8s.State.STOPPED;

  // #current holds the current in process job.
  #current
  #currentType
  constructor(cfg) {
    super();
    this.cfg = cfg;
  }

  get state() {
    return this.#state;
  }

  async start(nested) {

    while (this.#currentType != undefined) {
      await sleep(500);
    }
    this.#currentType = 'start';

    let that = this;
    return new Promise((resolve, reject) => {
      if (this.#state != K8s.State.STOPPED) {
          reject(1);
      }
      this.#state = K8s.State.STARTING
      // We want to block being caught in an infinite loop. This is used for
      // that situation.
      if (nested === undefined) {
          nested = false;
      }

      let permsMsg = false;

      // Using a custom path so that the minikube default (if someone has it
      // installed) does not conflict with this app.
      let opts = {};
      opts.env = { ... process.env };
      opts.env['MINIKUBE_HOME'] = paths.data();

      // TODO: Handle platform differences
      let args = ['start', '-p', 'rancher-desktop', '--driver', 'hyperkit', '--container-runtime', 'containerd', '--interactive=false'];
      
      // TODO: Handle the difference between changing version where a wipe is needed
      // and upgrading. All if there was a change.
      args.push("--kubernetes-version=" + this.cfg.version);
      const bat = spawn('./resources/' + os.platform() + '/minikube', args, opts);
      that.#current = bat;
      // TODO: For data toggle this based on a debug mode
      bat.stdout.on('data', (data) => {
        const subst = "The 'hyperkit' driver requires elevated permissions.";
        let str = data.toString();
        if (str.indexOf(subst) > -1) {
          permsMsg = true;
        }

        console.log(data.toString());
      });

      let errorMessage = '';
      bat.stderr.on('data', (data) => {
          console.error(data.toString());
          errorMessage += data;
      });

      bat.on('exit', async function(code, sig) {
        try {
          // When nested we do not want to keep going down the rabbit hole on error
          if (code == 80 && permsMsg && !nested) {
            // TODO: perms modal
            // TODO: Handle non-macos cases. This can be changed when multiple
            // hypervisors are used.
            let resp = await startAgain(this).catch((err) => { reject(err) });
            resolve(resp);
            return;
          }

          // Ensure homestead is running
          console.log("starting homestead");
          try {
            await Homestead.ensure();
          } catch (e) {
            console.log(`Error starting homestead: ${e}`);
            code = 1
          }

          // Run the callback function.
          if (code === 0) {
            that.#state = K8s.State.STARTED;
            resolve(code);
          } else if (sig === 'SIGINT') {
            that.#state = K8s.State.STOPPED;
            resolve(0);
          } else {
            that.#state = K8s.State.ERROR;
            reject({context: "starting minikube", errorCode: code, message: errorMessage});
          }
        } finally {
          that.clear();
        }
      });

      // Minikube puts the minikube information in a hidden directory. Use a
      // symlink on mac to make it visible to users searching their library.
      if (os.platform() == 'darwin') {
        if (!fs.existsSync(paths.data() + '/minikube') && fs.existsSync(paths.data() + '/.minikube')) {
          fs.symlinkSync(paths.data() + '/.minikube', paths.data() + '/minikube');
        }
      }
    })
  }

  async stop() {
    if (this.#currentType === 'start') {
      this.#current.kill('SIGINT');
    }

    while (this.#currentType != undefined) {
      await sleep(500);
    }
    this.#currentType = 'stop';
    this.#state = K8s.State.STOPPING;

    let that = this;
    return new Promise((resolve, reject) => {

      // Using a custom path so that the minikube default (if someone has it
      // installed) does not conflict with this app.
      let opts = {};
      opts.env = { ... process.env };
      opts.env['MINIKUBE_HOME'] = paths.data();

      // TODO: There MUST be a better way to exit. Do that.
      let errorMessage = '';

      const bat = spawn('./resources/' + os.platform() + '/minikube', ['stop', '-p', 'rancher-desktop'], opts);
      that.#current = bat;
      // TODO: For data toggle this based on a debug mode
      bat.stdout.on('data', (data) => {
        console.log(data.toString());
      });

      bat.stderr.on('data', (data) => {
        errorMessage += data;
        console.error(data.toString());
      });

      bat.on('exit', (code) => {
        that.clear();
        if (code === 0 || code === undefined || code === null) {
          that.#state = K8s.State.STOPPED;
          resolve(0);
        } else {
          that.#state = K8s.State.ERROR;
          reject({context: "stopping minikube", errorCode: code, message: errorMessage});
        }
      });
    })
  }

  async del() {
    while (this.#currentType != undefined) {
      await sleep(500);
    }
    this.#currentType = 'del';

    let that = this;
    return new Promise((resolve, reject) => {

      // Cannot delete a running instance
      if (that.state != K8s.State.STOPPED) {
        reject(1);
      }
      let opts = {};
      opts.env = { ... process.env };
      opts.env['MINIKUBE_HOME'] = paths.data();

      // TODO: There MUST be a better way to exit. Do that.
      const bat = spawn('./resources/' + os.platform() + '/minikube', ['delete', '-p', 'rancher-desktop'], opts);
      that.#current = bat;
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
        that.clear();
        if (code === 0) {
          resolve(code);
        } else {
          reject({context: "deleting minikube", errorCode: code, message: errorMessage});
        }
      });
    })
  }

  clear() {
    this.#current = undefined;
    this.#currentType = undefined;
  }
}

exports.Minikube = Minikube;

// This will try to start again, this time after handling permissions
async function startAgain(obj) {
  return new Promise((resolve, reject) => {
    const sudo = require('sudo-prompt');
    const options = {
      name: 'Rancher Desktop',
    };
    sudo.exec(`sh -c 'chown root:wheel "${paths.data()}/.minikube/bin/docker-machine-driver-hyperkit"; chmod u+s "${paths.data()}/.minikube/bin/docker-machine-driver-hyperkit"'`, options,
      async function(error) {
        if (error) throw error;
        
        let resp = await obj.start(obj.cfg, true).catch((err) => { reject(err) });
        resolve(resp);
      }
    );
  })
}

function sleep(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}
