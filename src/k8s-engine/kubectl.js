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
  opts.env = { ... process.env };
  opts.env['MINIKUBE_HOME'] = paths.data();

  const bat = spawn('./resources/' + os.platform() + '/bin/kubectl', ['config', 'use-context', cxt], opts);

  // TODO: For data toggle this based on a debug mode
  bat.stdout.on('data', (data) => {
    console.log(data.toString());
  });

  bat.stderr.on('data', (data) => {
    console.error(data.toString());
  });

  bat.on('exit', exitfunc);
}


exports.setCurrentContext = setCurrentContext;
