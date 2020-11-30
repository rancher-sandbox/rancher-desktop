'use strict';

const { Minikube } = require('./minikube.js')
const { OSNotImplemented } = require('./notimplemented.js')
const os = require('os')

const State = {
    STOPPED: 0,
    STARTING: 1,
    STARTED: 2,
    STOPPING: 3,
}

Object.freeze(State)

// 
function factory(cfg) {
    switch (os.platform()) {
        case 'darwin':
            return new Minikube(cfg)
        default:
            return new OSNotImplemented(cfg)
    }
}

exports.State = State;
exports.factory = factory;