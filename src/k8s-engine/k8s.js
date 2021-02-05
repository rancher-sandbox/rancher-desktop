'use strict';

const { Minikube } = require('./minikube.js');
const { OSNotImplemented } = require('./notimplemented.js');
const { KubeClient } = require('./client');
const os = require('os');

const State = {
  STOPPED:  0,  // The engine is not running.
  STARTING: 1, // The engine is attempting to start.
  STARTED:  2,  // The engine is started; the dashboard is not yet ready.
  READY:    3,    // The engine is started, and the dashboard is ready.
  STOPPING: 4, // The engine is attempting to stop.
  ERROR:    5,    // There is an error and we cannot recover automatically.
};

Object.freeze(State);

// 
function factory(cfg) {
  switch (os.platform()) {
    case 'darwin':
      return new Minikube(cfg);
    default:
      return new OSNotImplemented(cfg);
  }
}

exports.State = State;
exports.factory = factory;
exports.Client = KubeClient;
