import { normalizeURL } from 'ufo';
import Vue from 'vue';
import Router from 'vue-router';

import scrollBehavior from '@pkg/nuxt/router.scrollBehavior';
import { interopDefault } from '@pkg/nuxt/utils';

const _4e9ebc18 = () => interopDefault(import('./pages/Snapshots.vue' /* webpackChunkName: "pages/Snapshots" */));
const _4b9ecc18 = () => interopDefault(import('./pages/Containers.vue' /* webpackChunkName: "pages/Containers" */));
const _01130ad8 = () => interopDefault(import('./pages/DenyRoot.vue' /* webpackChunkName: "pages/DenyRoot" */));
const _075a3596 = () => interopDefault(import('./pages/Diagnostics.vue' /* webpackChunkName: "pages/Diagnostics" */));
const _816d3d64 = () => interopDefault(import('./pages/Dialog.vue' /* webpackChunkName: "pages/Dialog" */));
const _1be5231a = () => interopDefault(import('./pages/Extensions.vue' /* webpackChunkName: "pages/Extensions" */));
const _dc98fe7e = () => interopDefault(import('./pages/FirstRun.vue' /* webpackChunkName: "pages/FirstRun" */));
const _5f7b1fd2 = () => interopDefault(import('./pages/General.vue' /* webpackChunkName: "pages/General" */));
const _86386304 = () => interopDefault(import('./pages/Images.vue' /* webpackChunkName: "pages/Images" */));
const _b936eb68 = () => interopDefault(import('./pages/KubernetesError.vue' /* webpackChunkName: "pages/KubernetesError" */));
const _72631538 = () => interopDefault(import('./pages/PortForwarding.vue' /* webpackChunkName: "pages/PortForwarding" */));
const _86ca163c = () => interopDefault(import('./pages/Preferences.vue' /* webpackChunkName: "pages/Preferences" */));
const _57372a92 = () => interopDefault(import('./pages/SudoPrompt.vue' /* webpackChunkName: "pages/SudoPrompt" */));
const _e938e378 = () => interopDefault(import('./pages/Troubleshooting.vue' /* webpackChunkName: "pages/Troubleshooting" */));
const _3f6156a0 = () => interopDefault(import('./pages/UnmetPrerequisites.vue' /* webpackChunkName: "pages/UnmetPrerequisites" */));
const _e2b699b6 = () => interopDefault(import('./pages/extensions/installed.vue' /* webpackChunkName: "pages/extensions/installed" */));
const _20fa1c71 = () => interopDefault(import('./pages/snapshots/create.vue' /* webpackChunkName: "pages/snapshots/create" */));
const _4e9ebc17 = () => interopDefault(import('./pages/snapshots/dialog.vue' /* webpackChunkName: "pages/snapshots/dialog" */));
const _20fa1c70 = () => interopDefault(import('./pages/images/add.vue' /* webpackChunkName: "pages/images/add" */));
const _1165c4f2 = () => interopDefault(import('./pages/images/scans/_image-name.vue' /* webpackChunkName: "pages/images/scans/_image-name" */));
const _65f243c3 = () => interopDefault(import('./pages/extensions/_root/_src/_id.vue' /* webpackChunkName: "pages/extensions/_root/_src/_id" */));

const emptyFn = () => {};

Vue.use(Router);

export const routerOptions = {
  mode:                 'hash',
  base:                 '/',
  linkActiveClass:      'nuxt-link-active',
  linkExactActiveClass: 'nuxt-link-exact-active',
  scrollBehavior,

  routes: [{
    path:      '/Snapshots',
    component: _4e9ebc18,
    name:      'Snapshots',
  }, {
    path:      '/Containers',
    component: _4b9ecc18,
    name:      'Containers',
  }, {
    path:      '/DenyRoot',
    component: _01130ad8,
    name:      'DenyRoot',
  }, {
    path:      '/Diagnostics',
    component: _075a3596,
    name:      'Diagnostics',
  }, {
    path:      '/Dialog',
    component: _816d3d64,
    name:      'Dialog',
  }, {
    path:      '/Extensions',
    component: _1be5231a,
    name:      'Extensions',
  }, {
    path:      '/FirstRun',
    component: _dc98fe7e,
    name:      'FirstRun',
  }, {
    path:      '/General',
    component: _5f7b1fd2,
    name:      'General',
  }, {
    path:      '/Images',
    component: _86386304,
    name:      'Images',
  }, {
    path:      '/KubernetesError',
    component: _b936eb68,
    name:      'KubernetesError',
  }, {
    path:      '/PortForwarding',
    component: _72631538,
    name:      'Port Forwarding',
  }, {
    path:      '/Preferences',
    component: _86ca163c,
    name:      'Preferences',
  }, {
    path:      '/SudoPrompt',
    component: _57372a92,
    name:      'SudoPrompt',
  }, {
    path:      '/Troubleshooting',
    component: _e938e378,
    name:      'Troubleshooting',
  }, {
    path:      '/UnmetPrerequisites',
    component: _3f6156a0,
    name:      'UnmetPrerequisites',
  }, {
    path:      '/extensions/installed',
    component: _e2b699b6,
    name:      'extensions-installed',
  }, {
    path:      '/images/add',
    component: _20fa1c70,
    name:      'images-add',
  }, {
    path:      '/images/scans/:image-name?',
    component: _1165c4f2,
    name:      'images-scans-image-name',
  }, {
    path:      '/snapshots/create',
    component: _20fa1c71,
    name:      'snapshots-create',
  }, {
    path:      '/SnapshotsDialog',
    component: _4e9ebc17,
    name:      'SnapshotsDialog',
  }, {
    path:      '/extensions/:root?/:src?/:id?',
    component: _65f243c3,
    name:      'extensions-root-src-id',
  }, {
    path:      '/extensions/:root(.*)/:src/:id',
    component: _65f243c3,
    name:      'rdx-root-src-id',
  }],

  fallback: false,
};

export function createRouter(ssrContext, config) {
  const base = (config._app && config._app.basePath) || routerOptions.base;
  const router = new Router({ ...routerOptions, base });

  // TODO: remove in Nuxt 3
  const originalPush = router.push;

  router.push = function push(location, onComplete = emptyFn, onAbort) {
    return originalPush.call(this, location, onComplete, onAbort);
  };

  const resolve = router.resolve.bind(router);

  router.resolve = (to, current, append) => {
    if (typeof to === 'string') {
      to = normalizeURL(to);
    }

    return resolve(to, current, append);
  };

  return router;
}
