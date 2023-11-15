<template>
  <div class="wrapper">
    <rd-header
      class="header"
      @open-preferences="openPreferences"
    />
    <rd-nav
      class="nav"
      :items="routes"
      :extensions="extensions"
    />
    <the-title ref="rdx-title" />
    <main class="body">
      <Nuxt />
    </main>
    <status-bar class="status-bar"></status-bar>
    <!-- The ActionMenu is used by SortableTable for per-row actions. -->
    <ActionMenu />
  </div>
</template>

<script>

import { mapGetters, mapState } from 'vuex';

import ActionMenu from '@pkg/components/ActionMenu.vue';
import Header from '@pkg/components/Header.vue';
import Nav from '@pkg/components/Nav.vue';
import StatusBar from '@pkg/components/StatusBar.vue';
import TheTitle from '@pkg/components/TheTitle.vue';
import initExtensions from '@pkg/preload/extensions';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';
import { mainRoutes } from '@pkg/window/constants';

export default {
  name:       'App',
  components: {
    StatusBar,
    ActionMenu,
    rdNav:    Nav,
    rdHeader: Header,
    TheTitle,
  },

  async fetch() {
    await this.$store.dispatch('credentials/fetchCredentials');
    if (!this.credentials.port || !this.credentials.user || !this.credentials.password) {
      console.log(`Credentials aren't ready for getting diagnostics -- will try later`);

      return;
    }
    await this.$store.dispatch('preferences/fetchPreferences', this.credentials);
    await this.$store.dispatch('diagnostics/fetchDiagnostics', this.credentials);
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
      return mainRoutes.map(route => route.route === '/Diagnostics' ? { ...route, error: this.errorCount } : route);
    },
    paths() {
      return mainRoutes.map(r => r.route);
    },
    errorCount() {
      return this.diagnostics.filter(diagnostic => !diagnostic.mute).length;
    },
    ...mapState('credentials', ['credentials']),
    ...mapGetters('diagnostics', ['diagnostics']),
    ...mapGetters('extensions', { extensions: 'list' }),
  },

  beforeMount() {
    initExtensions();
    ipcRenderer.once('backend-locked', (event) => {
      ipcRenderer.send('preferences-close');
      this.showCreatingSnapshotDialog();
    });
    ipcRenderer.once('backend-unlocked', () => {
      ipcRenderer.send('dialog/close', { dialog: 'SnapshotsDialog' });
      ipcRenderer.removeAllListeners('backend-locked');
    });
    ipcRenderer.send('backend-state-check');
    ipcRenderer.on('k8s-check-state', (event, state) => {
      this.$store.dispatch('k8sManager/setK8sState', state);
    });
    ipcRenderer.on('route', (event, args) => {
      this.goToRoute(args);
    });
    ipcRenderer.on('extensions/changed', () => {
      this.$store.dispatch('extensions/fetch');
    });
    this.$store.dispatch('extensions/fetch');

    ipcRenderer.on('preferences/changed', () => {
      this.$store.dispatch('preferences/fetchPreferences', this.credentials);
    });

    ipcRenderer.on('extensions/getContentArea', () => {
      const rect = this.$refs['rdx-title'].$el.getBoundingClientRect();

      const payload = {
        x: rect.left,
        y: rect.top,
      };

      ipcRenderer.send('ok:extensions/getContentArea', payload);
    });
  },

  beforeDestroy() {
    ipcRenderer.off('k8s-check-state');
    ipcRenderer.off('extensions/getContentArea');
    ipcRenderer.removeAllListeners('backend-locked');
    ipcRenderer.removeAllListeners('backend-unlocked');
  },

  methods: {
    openPreferences() {
      ipcRenderer.send('preferences-open');
    },
    goToRoute(args) {
      const { path, direction } = args;

      if (path) {
        this.$router.push({ path });

        return;
      }

      if (direction) {
        const dir = (direction === 'forward' ? 1 : -1);
        const idx = (this.paths.length + this.paths.indexOf(this.$router.currentRoute.path) + dir) % this.paths.length;

        this.$router.push({ path: this.paths[idx] });
      }
    },
    showCreatingSnapshotDialog() {
      ipcRenderer.invoke(
        'show-snapshots-blocking-dialog',
        {
          window: {
            buttons:  [],
            cancelId: 1,
          },
          format: {
            /** ToDo put here operation type and snapshot name from 'state' */
            header:          this.t('snapshots.dialog.generic.header', {}, true),
            /** ToDo put here operation type information from 'state' */
            message:         this.t('snapshots.dialog.generic.message', {}, true),
            showProgressBar: true,
          },
        },
      );
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
    "nav      status-bar"
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

  .body {
    display: grid;
    grid-area: body;
    grid-template-rows: auto 1fr;
    padding: 0 20px 20px 20px;
    overflow: auto;
  }

  .status-bar {
    grid-area: status-bar;
    border-top: var(--nav-border-size) solid var(--nav-border);
  }
}
</style>
