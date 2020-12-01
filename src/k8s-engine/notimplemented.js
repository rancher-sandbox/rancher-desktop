'use strict';

const { dialog } = require('electron')
const { State } = require('./k8s.js')

/**
 * OSNotImplemented is a class for the case that a platform is not implemented.
 */
class OSNotImplemented {
    #notified = false
    constructor(cfg) {
        this.cfg = cfg
    }

    get state() {
        return State.STOPPED
    }

    start() {
        this.#notified = displayError(this.#notified)
    }

    stop() {
        this.#notified = displayError(this.#notified)
    }

    del() {
        this.#notified = displayError(this.#notified)
    }
}

exports.OSNotImplemented = OSNotImplemented

function displayError(already) {
    // The error is only displayed once. So this way they don't get repeated error
    // messages for the same thing.
    if (!already) {
        dialog.showErrorBox("Unfortunately, your operating system is not supported at this time.")
    }
    return true
}