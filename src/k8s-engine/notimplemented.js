'use strict';

const events = require('events');
const { dialog } = require('electron');
const { State } = require('./k8s');

/**
 * OSNotImplemented is a class for the case that a platform is not implemented.
 */
export class OSNotImplemented extends events.EventEmitter {
  #notified = false

  /** @returns {'not-implemented'} */
  get backend() {
    return 'not-implemented';
  }

  get state() {
    return State.ERROR;
  }

  get availableVersions() {
    return Promise.resolve([]);
  }

  get version() {
    return 'Not Implemented';
  }

  get desiredPort() {
    return 0;
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

  get ipAddress() {
    this.#notified = displayError(this.#notified);

    return Promise.reject(new Error('not implemented'));
  }

  listServices(namespace) {
    this.#notified = displayError(this.#notified);

    return [];
  }

  isServiceReady(namespace, service) {
    this.#notified = displayError(this.#notified);

    return Promise.reject(new Error('not implemented'));
  }

  get portForwarder() {
    return null;
  }

  listIntegrations() {
    this.#notified = displayError(this.#notified);

    return Promise.reject(new Error('not implemented'));
  }

  listIntegrationWarnings() {
    this.#notified = displayError(this.#notified);

    return Promise.reject(new Error('not implemented'));
  }

  setIntegration(name, state) {
    this.#notified = displayError(this.#notified);

    return Promise.reject(new Error('not implemented'));
  }
}

function displayError(already) {
  // The error is only displayed once. So this way they don't get repeated error
  // messages for the same thing.
  if (!already) {
    dialog.showErrorBox('Unfortunately, your operating system is not supported at this time.');
  }

  return true;
}
