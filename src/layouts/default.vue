<template>
  <div class="wrapper">
    <rd-header class="header" @open-preferences="openPreferences" />
    <rd-nav class="nav" :items="routes" />
    <the-title />
    <main class="body">
      <Nuxt />
    </main>
    <BackendProgress class="progress" />
    <!-- The ActionMenu is used by SortableTable for per-row actions. -->
    <ActionMenu />
  </div>
</template>

<script>
import { ipcRenderer } from 'electron';

import ActionMenu from '@/components/ActionMenu.vue';
import BackendProgress from '@/components/BackendProgress.vue';
import Header from '@/components/Header.vue';
import Nav from '@/components/Nav.vue';
import TheTitle from '@/components/TheTitle.vue';

export default {
  name:       'App',
  components: {
    ActionMenu,
    BackendProgress,
    rdNav:    Nav,
    rdHeader: Header,
    TheTitle,
  },

  head() {
    // If dark-mode is set to auto (follow system-prefs) this is all we need
    // In a possible future with a three-way pref
    // (Always off // Always on // Follow system pref)
    // the "dark" part will be a dynamic pref.
    // See https://github.com/rancher/dashboard/blob/3454590ff6a825f7e739356069576fbae4afaebc/layouts/default.vue#L227 for an example
    return { bodyAttrs: { class: 'theme-dark' } };
  },

  computed: {
    routes() {
      return [
        '/General',
        '/PortForwarding',
        '/Images',
        '/Troubleshooting',
      ];
    },
  },

  beforeMount() {
    ipcRenderer.on('k8s-check-state', (event, state) => {
      this.$store.dispatch('k8sManager/setK8sState', state);
    });
  },

  mounted() {
    ipcRenderer.send('app-ready');
  },

  beforeDestroy() {
    ipcRenderer.off('k8s-check-state');
  },

  methods: {
    openPreferences() {
      ipcRenderer.send('preferences-open');
    },
  },
};
</script>

<style lang="scss" scoped>
@import "@/assets/styles/app.scss";

.wrapper {
  display: grid;
  grid-template:
    "header   header"
    "nav      title"
    "nav      body"    1fr
    "progress body"
    / var(--nav-width) 1fr;
  background-color: var(--body-bg);
  width: 100vw;
  height: 100vh;

  .header {
    grid-area: header;
    border-bottom: var(--header-border-size) solid var(--header-border);
  }

  .nav {
    grid-area: nav;
    border-right: var(--nav-border-size) solid var(--nav-border);
  }

  .progress {
    grid-area: progress;
    background-color: var(--nav-bg);
    padding: 10px;
    border-right: var(--nav-border-size) solid var(--nav-border);
  }

  .body {
    display: grid;
    grid-area: body;
    grid-template-rows: auto 1fr;
    padding: 0 20px 20px 20px;
    overflow: auto;
  }
}
</style>
