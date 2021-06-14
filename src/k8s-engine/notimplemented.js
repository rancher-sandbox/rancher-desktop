'use strict';

const events = require('events');
const { dialog } = require('electron');
const { State } = require('./k8s');

/**
 * OSNotImplemented is a class for the case that a platform is not implemented.
 */
class OSNotImplemented extends events.EventEmitter {
  #notified = false

  get state() {
    return State.ERROR;
  }

  get availableVersions() {
    return Promise.resolve([]);
  }

  get version() {
    return 'Not Implemented';
  }

  get cpus() {
    this.#notified = displayError(this.#notified);

    return Promise.reject(new Error('not implemented'));
  }

  get memory() {
    this.#notified = displayError(this.#notified);

    return Promise.reject(new Error('not implemented'));
  }

  get progress() {
    this.#notified = displayError(this.#notified);

    return { current: 0, max: 0 };
  }

  getBackendInvalidReason() {
    return Promise.resolve(null);
  }

  start(config) {
    this.#notified = displayError(this.#notified);

    return Promise.reject(new Error('not implemented'));
  }

  stop() {
    this.#notified = displayError(this.#notified);

    return Promise.reject(new Error('not implemented'));
  }

  del() {
    this.#notified = displayError(this.#notified);

    return Promise.reject(new Error('not implemented'));
  }

  reset(config) {
    this.#notified = displayError(this.#notified);

    return Promise.reject(new Error('not implemented'));
  }

  factoryReset() {
    this.#notified = displayError(this.#notified);

    return Promise.reject(new Error('not implemented'));
  }

  requiresRestartReasons() {
    this.#notified = displayError(this.#notified);

    return Promise.reject(new Error('not implemented'));
  }

  listServices(namespace) {
    this.#notified = displayError(this.#notified);

    return [];
  }

  forwardPort(namespace, service, port) {
    this.#notified = displayError(this.#notified);

    return Promise.reject(new Error('not implemented'));
  }

  cancelForward(namespace, service, port) {
    this.#notified = displayError(this.#notified);

    return Promise.reject(new Error('not implemented'));
  }

  ensureCompatibleKubectl(desiredVersion) {
    this.#notified = displayError(this.#notified);

    return Promise.reject(new Error('not implemented'));
  }
}

exports.OSNotImplemented = OSNotImplemented;

function displayError(already) {
  // The error is only displayed once. So this way they don't get repeated error
  // messages for the same thing.
  if (!already) {
    dialog.showErrorBox('Unfortunately, your operating system is not supported at this time.');
  }

  return true;
}
