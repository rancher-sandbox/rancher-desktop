import { RouteConfig } from 'vue-router';

import Default from '@pkg/layouts/default.vue';
import Images from '@pkg/pages/Images.vue';
import PortForwarding from '@pkg/pages/PortForwarding.vue';
import Troubleshooting from '@pkg/pages/Troubleshooting.vue';

const routes: RouteConfig[] = [
  {
    name:      'rancher-desktop-general',
    path:      '/general',
    component: Default,
  },
  {
    name:      'rancher-desktop-port-forwarding',
    path:      '/port-forwarding',
    component: PortForwarding,
  },
  {
    name:      'rancher-desktop-images',
    path:      '/images',
    component: Images,
  },
  {
    name:      'rancher-desktop-troubleshooting',
    path:      '/troubleshooting',
    component: Troubleshooting,
  },
];

export default routes;
