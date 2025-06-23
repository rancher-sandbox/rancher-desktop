import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router';

import Containers from '../pages/Containers.vue';
import DenyRoot from '../pages/DenyRoot.vue';
import Diagnostics from '../pages/Diagnostics.vue';
import Dialog from '../pages/Dialog.vue';
import Extensions from '../pages/Extensions.vue';
import FirstRun from '../pages/FirstRun.vue';
import General from '../pages/General.vue';
import Images from '../pages/Images.vue';
import KubernetesError from '../pages/KubernetesError.vue';
import PortForwarding from '../pages/PortForwarding.vue';
import Preferences from '../pages/Preferences.vue';
import Snapshots from '../pages/Snapshots.vue';
import SudoPrompt from '../pages/SudoPrompt.vue';
import Troubleshooting from '../pages/Troubleshooting.vue';
import UnmetPrerequisites from '../pages/UnmetPrerequisites.vue';
import ExtensionsItem from '../pages/extensions/_root/_src/_id.vue';
import ImagesAdd from '../pages/images/add.vue';
import ImagesScan from '../pages/images/scans/_image-name.vue';
import SnapshotsCreate from '../pages/snapshots/create.vue';
import SnapshotsDialog from '../pages/snapshots/dialog.vue';

export default createRouter({
  history: createWebHashHistory(),
  routes:  [
    { path: '/', redirect: '/General' },
    {
      path: '/General', component: General, name: 'General',
    },
    {
      path: '/Containers', component: Containers, name: 'Containers',
    },
    {
      path: '/PortForwarding', component: PortForwarding, name: 'Port Forwarding',
    },
    {
      path:      '/Images',
      component: Images,
      name:      'Images',
    },
    {
      path: '/images/add', component: ImagesAdd, name: 'images-add',
    },
    {
      path: '/images/scans/:image-name?/:namespace?', component: ImagesScan, name: 'images-scans-image-name',
    },
    {
      path: '/Snapshots', component: Snapshots, name: 'Snapshots',
    },
    {
      path: '/snapshots/create', component: SnapshotsCreate, name: 'snapshots-create',
    },
    {
      path: '/Troubleshooting', component: Troubleshooting, name: 'Troubleshooting',
    },
    {
      path: '/Diagnostics', component: Diagnostics, name: 'Diagnostics',
    },
    {
      path: '/Extensions', component: Extensions, name: 'Extensions',
    },
    {
      path: '/extensions/:id/:root(.*)/:src', component: ExtensionsItem, name: 'rdx-root-src-id',
    },
    {
      path: '/DenyRoot', component: DenyRoot, name: 'DenyRoot',
    },
    {
      path: '/FirstRun', component: FirstRun, name: 'FirstRun',
    },
    {
      path: '/KubernetesError', component: KubernetesError, name: 'KubernetesError',
    },
    {
      path: '/preferences', component: Preferences, name: 'Preferences',
    },
    {
      path: '/Dialog', component: Dialog, name: 'Dialog',
    },
    {
      path: '/SudoPrompt', component: SudoPrompt, name: 'SudoPrompt',
    },
    {
      path: '/UnmetPrerequisites', component: UnmetPrerequisites, name: 'UnmetPrerequisites',
    },
    {
      path: '/SnapshotsDialog', component: SnapshotsDialog, name: 'SnapshotsDialog',
    },
  ],
});
