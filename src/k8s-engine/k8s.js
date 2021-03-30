'use strict';

const os = require('os');
const { Minikube } = require('./minikube.js');
const { OSNotImplemented } = require('./notimplemented.js');
const { KubeClient } = require('./client');

const State = {
  STOPPED:  0, // The engine is not running.
  STARTING: 1, // The engine is attempting to start.
  STARTED:  2, // The engine is started.
  STOPPING: 3, // The engine is attempting to stop.
  ERROR:    4, // There is an error and we cannot recover automatically.
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
