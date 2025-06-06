<script lang="ts">
import os from 'os';

import { defineComponent } from 'vue';
import { mapGetters, mapState } from 'vuex';

import EmptyState from '@pkg/components/EmptyState.vue';
import PreferencesBody from '@pkg/components/Preferences/ModalBody.vue';
import PreferencesFooter from '@pkg/components/Preferences/ModalFooter.vue';
import PreferencesHeader from '@pkg/components/Preferences/ModalHeader.vue';
import PreferencesNav from '@pkg/components/Preferences/ModalNav.vue';
import type { TransientSettings } from '@pkg/config/transientSettings';
import type { ServerState } from '@pkg/main/commandServer/httpCommandServer';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';
import { Direction, RecursivePartial } from '@pkg/utils/typeUtils';
import { preferencesNavItems } from '@pkg/window/preferenceConstants';

export default defineComponent({
  name:       'preferences-modal',
  components: {
    PreferencesHeader, PreferencesNav, PreferencesBody, PreferencesFooter, EmptyState,
  },
  layout: 'preferences',
  data() {
    return { preferencesLoaded: false };
  },
  computed: {
    ...mapGetters('preferences', ['getPreferences', 'hasError']),
    ...mapGetters('transientSettings', ['getCurrentNavItem']),
    ...mapState('credentials', ['credentials']),
    navItems(): string[] {
      return preferencesNavItems.map(({ name }) => name);
    },
  },
  async beforeMount() {
    await this.$store.dispatch('credentials/fetchCredentials');
    await this.$store.dispatch('preferences/fetchPreferences', this.credentials as ServerState);
    await this.$store.dispatch('preferences/fetchLocked', this.credentials as ServerState);
    await this.$store.dispatch('transientSettings/fetchTransientSettings', this.credentials as ServerState);
    this.preferencesLoaded = true;

    ipcRenderer.on('k8s-integrations', (_, integrations: Record<string, string | boolean>) => {
      this.$store.dispatch('preferences/setWslIntegrations', integrations);
    });

    ipcRenderer.send('k8s-integrations');

    this.$store.dispatch('preferences/setPlatformWindows', os.platform().startsWith('win'));

    ipcRenderer.on('route', async(event, args) => {
      await this.navigateToTab(args);
    });

    ipcRenderer.invoke('versions/macOs').then((macOsVersion) => {
      this.$store.dispatch('transientSettings/setMacOsVersion', macOsVersion);
    });

    ipcRenderer.invoke('host/isArm').then((isArm) => {
      this.$store.dispatch('transientSettings/setIsArm', isArm);
    });
  },
  beforeUnmount() {
    /**
     * Removing the listeners resolves the issue of receiving duplicated messages from 'route' channel.
     * Originated by: https://github.com/rancher-sandbox/rancher-desktop/issues/3232
     */
    ipcRenderer.removeAllListeners('route');
  },
  methods: {
    async navChanged(current: string) {
      await this.commitNavItem(current);
    },
    async commitNavItem(current: string) {
      await this.$store.dispatch(
        'transientSettings/commitPreferences',
        {
          ...this.credentials as ServerState,
          payload: { preferences: { navItem: { current } } } as RecursivePartial<TransientSettings>,
        },
      );
    },
    closePreferences() {
      ipcRenderer.send('preferences-close');
    },
    async applyPreferences() {
      const resetAccepted = await this.proposePreferences();

      if (!resetAccepted) {
        return;
      }

      await this.$store.dispatch(
        'preferences/commitPreferences',
        { ...this.credentials as ServerState },
      );
      this.closePreferences();
    },
    async proposePreferences() {
      const { port, user, password } = this.credentials as ServerState;
      const { reset } = await this.$store.dispatch(
        'preferences/proposePreferences',
        {
          port, user, password,
        },
      );

      if (!reset) {
        return true;
      }

      const cancelPosition = 1;

      const result = await ipcRenderer.invoke('show-message-box', {
        title:    'Rancher Desktop - Reset Kubernetes',
        type:     'warning',
        message:  'Apply preferences and reset Kubernetes?',
        detail:   'These changes will reset the Kubernetes cluster, which will result in a loss of workloads and container images.',
        cancelId: cancelPosition,
        buttons:  [
          'Apply and reset',
          'Cancel',
        ],
      });

      return result.response !== cancelPosition;
    },
    reloadPreferences() {
      window.location.reload();
    },
    async navigateToTab(args: { name?: string, direction?: Direction}) {
      const { name, direction } = args;

      if (name) {
        await this.commitNavItem(name);

        return;
      }

      if (direction) {
        const dir = (direction === 'forward' ? 1 : -1);
        const idx = (this.navItems.length + this.navItems.indexOf(this.getCurrentNavItem) + dir) % this.navItems.length;

        await this.commitNavItem(this.navItems[idx]);
      }
    },
  },
});
</script>

<template>
  <div
    v-if="preferencesLoaded"
    class="modal-grid"
  >
    <preferences-header
      class="preferences-header"
    />
    <preferences-nav
      v-if="!hasError"
      class="preferences-nav"
      :current-nav-item="getCurrentNavItem"
      :nav-items="navItems"
      @nav-changed="navChanged"
    />
    <preferences-body
      class="preferences-body"
      :current-nav-item="getCurrentNavItem"
      :preferences="getPreferences"
      v-on="$listeners"
    >
      <div
        v-if="hasError"
        class="preferences-error"
      >
        <empty-state
          icon="icon-warning"
          heading="Unable to fetch preferences"
          body="Reload Preferences to try again."
        >
          <template #primary-action>
            <button
              class="btn role-primary"
              @click="reloadPreferences"
            >
              Reload preferences
            </button>
          </template>
        </empty-state>
      </div>
    </preferences-body>
    <preferences-footer
      class="preferences-footer"
      @cancel="closePreferences"
      @apply="applyPreferences"
    />
  </div>
</template>

<style lang="scss">
  .modal .vm--modal {
    background-color: var(--body-bg);
  }

  .preferences-header {
    grid-area: header;
  }

  .preferences-nav {
    grid-area: nav;
  }

  .preferences-body {
    grid-area: body;
    max-height: 100%;
    overflow: auto;
  }

  .preferences-footer {
    grid-area: footer;
  }

  .modal-grid {
    height: 100vh;
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto 1fr auto;
    grid-template-areas:
      "header header"
      "nav body"
      "footer footer";
  }

  .preferences-error {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: center;
    padding-bottom: 6rem;
  }
</style>
