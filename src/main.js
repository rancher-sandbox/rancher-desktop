import { createApp, nextTick } from 'vue';
import App from './App.vue';
import {createRouter, createWebHashHistory } from 'vue-router';

import Welcome from './components/Welcome.vue';
import K8s from './components/K8s.vue';
import Troubleshooting from './components/Troubleshooting.vue';

const routes = [
  { path: '/', component: Welcome },
  { path: '/k8s', component: K8s, meta: { title: "Kubernetes Settings"} },
  { path: '/troubleshooting', component: Troubleshooting },
]

let router = createRouter({
    history: createWebHashHistory(),
    routes,
});

router.afterEach((to) => {
  nextTick(() => {
    document.title = to.meta.title || "Rancher Desktop";
  })
});

const app = createApp(App, {navItems: routes});

app.use(router);

app.mount('#app');
