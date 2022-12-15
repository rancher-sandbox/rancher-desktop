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

import { mapGetters, mapState } from 'vuex';

import ActionMenu from '@pkg/components/ActionMenu.vue';
import BackendProgress from '@pkg/components/BackendProgress.vue';
import Header from '@pkg/components/Header.vue';
import Nav from '@pkg/components/Nav.vue';
import TheTitle from '@pkg/components/TheTitle.vue';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default {
  name:       'App',
  components: {
    ActionMenu,
    BackendProgress,
    rdNav:    Nav,
    rdHeader: Header,
    TheTitle,
  },
  async fetch() {
    if (this.$config.featureDiagnostics) {
      await this.$store.dispatch('credentials/fetchCredentials');
      if (!this.credentials.port || !this.credentials.user || !this.credentials.password) {
        console.log(`Credentials aren't ready for getting diagnostics -- will try later`);

        return;
      }
      await this.$store.dispatch('preferences/fetchPreferences', this.credentials);
      await this.$store.dispatch('diagnostics/fetchDiagnostics', this.credentials);
    }
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
      const routeTable = [
        { route: '/General' },
        { route: '/PortForwarding' },
        { route: '/Images' },
        { route: '/Troubleshooting' },
      ];

      if (this.featureDiagnostics) {
        routeTable.push({ route: '/Diagnostics', error: this.errorCount });
      }

      return routeTable;
    },
    featureDiagnostics() {
      return !!this.$config.featureDiagnostics;
    },
    errorCount() {
      return this.diagnostics.filter(diagnostic => !diagnostic.mute).length;
    },
    ...mapState('credentials', ['credentials']),
    ...mapGetters('diagnostics', ['diagnostics']),
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
@import "@pkg/assets/styles/app.scss";

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
