/**
 * This module is an EventEmitter for communication between various parts of the
 * main process.
 */

import { EventEmitter } from 'events';

import * as K8s from '@/k8s-engine/k8s';

interface MainEvents extends EventEmitter {
    /**
     * Emitted when the Kubernetes backend state has changed.
     */
    on(event: 'k8s-check-state', listener: (mgr: K8s.KubernetesBackend) => void): this;
}
class MainEventsImpl extends EventEmitter implements MainEvents { }
const mainEvents = new MainEventsImpl();

export default mainEvents;
