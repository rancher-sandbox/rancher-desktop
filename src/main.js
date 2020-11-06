import { createApp } from 'vue'
import App from './App.vue'
import {createRouter, createWebHashHistory } from 'vue-router'

import Welcome from './components/Welcome.vue'
import K8s from './components/K8s.vue'

const routes = [
    { path: '/', component: Welcome },
    { path: '/k8s', component: K8s },
]

const router = createRouter({
    history: createWebHashHistory(),
    routes,
})

const app = createApp(App)

app.use(router)

app.mount('#app')
