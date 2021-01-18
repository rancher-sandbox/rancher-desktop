import Vue from 'vue';
import VueRouter from 'vue-router';

import App from './App.vue';
import Welcome from './components/Welcome.vue';
import K8s from './components/K8s.vue';
import Troubleshooting from './components/Troubleshooting.vue';

Vue.use(VueRouter);

const routes = [
  { path: '/', component: Welcome },
  { path: '/k8s', component: K8s, meta: { title: "Kubernetes Settings"} },
  { path: '/troubleshooting', component: Troubleshooting },
];

const router = new VueRouter({ routes });

router.afterEach((to) => {
  Vue.nextTick(() => {
    document.title = to.meta.title || "Rancher Desktop";
  })
});

new Vue({
  router,
  render: h => h(App, { props: { navItems: routes } }),
  el: "#app"
});
