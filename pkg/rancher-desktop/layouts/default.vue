<template>
  <div
    class="wrapper"
    :class="{
      'blur': blur
    }"
  >
    <rd-nav
      class="nav"
      :items="routes"
      :extensions="installedExtensions"
      @open-dashboard="openDashboard"
      @open-preferences="openPreferences"
    />
    <the-title ref="title" />
    <main ref="body" class="body">
      <RouterView />
    </main>
    <!-- The extension area is used for sizing the extension view. -->
    <div id="extension-spacer" class="extension" />
    <status-bar class="status-bar"></status-bar>
    <!-- The ActionMenu is used by SortableTable for per-row actions. -->
    <ActionMenu />
  </div>
</template>

<script>

import { mapGetters, mapState } from 'vuex';

import ActionMenu from '@pkg/components/ActionMenu.vue';
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
    rdNav: Nav,
    TheTitle,
  },

  data() {
    return { blur: false };
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
      const badges = {
        '/Diagnostics': this.diagnosticsCount,
        '/Extensions':  this.extensionUpgradeCount,
      };

      return mainRoutes.map((route) => {
        if (route.route in badges) {
          return { ...route, error: badges[route.route] };
        }

        return route;
      });
    },
    paths() {
      return mainRoutes.map(r => r.route);
    },
    /** @returns {number} The number of diagnostics errors. */
    diagnosticsCount() {
      return this.diagnostics.filter(diagnostic => !diagnostic.mute).length;
    },
    /** @returns {number} The number of extensions with upgrade available. */
    extensionUpgradeCount() {
      return this.installedExtensions.filter(ext => ext.canUpgrade).length;
    },
    ...mapState('credentials', ['credentials']),
    ...mapGetters('diagnostics', ['diagnostics']),
    ...mapGetters('extensions', ['installedExtensions']),
  },

  beforeMount() {
    // The window title isn't set correctly in E2E; as a workaround, force set
    // it here again.
    document.title ||= 'Rancher Desktop';

    this.fetch().catch(ex => console.error(ex));

    initExtensions();
    ipcRenderer.on('window/blur', (event, blur) => {
      this.blur = blur;
    });
    ipcRenderer.on('backend-locked', (_event, action) => {
      ipcRenderer.send('preferences-close');
      this.showCreatingSnapshotDialog(action);
    });
    ipcRenderer.on('backend-unlocked', () => {
      ipcRenderer.send('dialog/close', { dialog: 'SnapshotsDialog', snapshotEventType: 'backend-lock' });
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
      /** @type {DOMRect} */
      const titleRect = this.$refs.title.$el.getBoundingClientRect();
      /** @type {DOMRect} */
      const bodyRect = this.$refs.body.getBoundingClientRect();
      const payload = {
        top:    titleRect.top,
        right:  titleRect.right,
        bottom: bodyRect.bottom,
        left:   titleRect.left,
      };

      ipcRenderer.send('ok:extensions/getContentArea', payload);
    });
  },

  mounted() {
    this.$store.dispatch('i18n/init').catch(ex => console.error(ex));
  },

  beforeUnmount() {
    ipcRenderer.off('k8s-check-state');
    ipcRenderer.off('extensions/getContentArea');
    ipcRenderer.removeAllListeners('backend-locked');
    ipcRenderer.removeAllListeners('backend-unlocked');
    ipcRenderer.removeAllListeners('window/blur');
  },

  methods: {
    async fetch() {
      await this.$store.dispatch('credentials/fetchCredentials');
      if (!this.credentials.port || !this.credentials.user || !this.credentials.password) {
        console.log(`Credentials aren't ready for getting diagnostics -- will try later`);

        return;
      }
      await this.$store.dispatch('preferences/fetchPreferences', this.credentials);
      await this.$store.dispatch('diagnostics/fetchDiagnostics', this.credentials);
    },

    openDashboard() {
      ipcRenderer.send('dashboard-open');
    },
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
    showCreatingSnapshotDialog(action) {
      ipcRenderer.invoke(
        'show-snapshots-blocking-dialog',
        {
          window: {
            buttons:  [],
            cancelId: 1,
          },
          format: {
            header:            action || this.t('snapshots.dialog.generic.header', {}, true),
            /** TODO: put here operation type information from 'state' */
            message:           this.t('snapshots.dialog.generic.message', {}, true),
            showProgressBar:   true,
            snapshotEventType: 'backend-lock',
          },
        },
      );
    },
  },
};
</script>

<style lang="scss" src="@pkg/assets/styles/app.scss"></style>
<style lang="scss" scoped>
.wrapper {
  display: grid;
  grid-template:
    "nav        title"
    "nav        body"    1fr
    "status-bar status-bar"
    / var(--nav-width) 1fr;
  background-color: var(--body-bg);
  width: 100vw;
  height: 100vh;

  &.blur {
   opacity: 0.2;
  }

  .header {
    grid-area: header;
    border-bottom: var(--header-border-size) solid var(--header-border);
  }

  .nav {
    grid-area: nav;
    border-right: var(--nav-border-size) solid var(--nav-border);
  }

  .title {
    grid-area: title;
  }

  .body {
    display: grid;
    grid-area: body;
    grid-template-rows: auto 1fr;
    padding: 0 20px 20px 20px;
    overflow: auto;
  }

  .extension {
    grid-area: title / title / body / body;
    z-index: -1000;
  }

  .status-bar {
    grid-area: status-bar;
    border-top: var(--nav-border-size) solid var(--nav-border);
  }
}
</style>
