<script lang="ts">
import os from 'os';
import { ipcRenderer } from 'electron';
import Vue from 'vue';
import { mapGetters, mapActions } from 'vuex';

import PreferencesHeader from '@/components/Preferences/ModalHeader.vue';
import PreferencesNav from '@/components/Preferences/ModalNav.vue';
import PreferencesBody from '@/components/Preferences/ModalBody.vue';
import PreferencesActions from '@/components/Preferences/ModalActions.vue';
import EmptyState from '@/components/EmptyState.vue';

export default Vue.extend({
  name:       'preferences-modal',
  components: {
    PreferencesHeader, PreferencesNav, PreferencesBody, PreferencesActions, EmptyState
  },
  layout: 'preferences',
  data() {
    return {
      currentNavItem: 'Application',
      credentials:    {
        password: '',
        pid:      0,
        port:     0,
        user:     ''
      },
      preferencesLoaded: false
    };
  },
  fetch() {
    ipcRenderer.on('api-credentials', async(_event, credentials) => {
      this.credentials = credentials;
      await this.fetchPreferences();
      this.preferencesLoaded = true;
    });

    ipcRenderer.send('api-get-credentials');

    ipcRenderer.on('k8s-integrations', (_, integrations: Record<string, string | boolean>) => {
      this.$store.dispatch('preferences/setWslIntegrations', integrations);
    });

    ipcRenderer.send('k8s-integrations');

    this.$store.dispatch('preferences/setPlatformWindows', os.platform().startsWith('win'));
  },
  computed: {
    ...mapGetters('preferences', ['getPreferences', 'isPreferencesDirty', 'hasError', 'isPlatformWindows']),
    navItems(): string[] {
      return [
        'Application',
        this.isPlatformWindows ? 'WSL' : 'Virtual Machine',
        'Container Runtime',
        'Kubernetes'
      ];
    }
  },
  async beforeMount() {
    const credentials = await this.fetchCredentials();

    console.debug('CREDENTIALS', { credentials });

    window.addEventListener('keydown', this.handleKeypress, true);
  },
  beforeDestroy() {
    window.removeEventListener('keydown', this.handleKeypress, true);
  },
  methods:  {
    async fetchCredentials() {
      const result = await this.$store.dispatch('credentials/fetchCredentials', undefined);

      return result;
    },
    navChanged(tabName: string) {
      this.currentNavItem = tabName;
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
        this.credentials
      );
      this.closePreferences();
    },
    async fetchPreferences() {
      await this.$store.dispatch(
        'preferences/fetchPreferences',
        this.credentials
      );
    },
    async proposePreferences() {
      const { reset } = await this.$store.dispatch('preferences/proposePreferences', this.credentials);

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
          'Cancel'
        ]
      });

      if (result.response === cancelPosition) {
        return false;
      }

      return true;
    },
    reloadPreferences() {
      window.location.reload();
    },
    handleKeypress(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        this.closePreferences();
      }
    }
  }
});
</script>

<template>
  <div v-if="preferencesLoaded" class="modal-grid">
    <preferences-header
      class="preferences-header"
    />
    <preferences-nav
      v-if="!hasError"
      class="preferences-nav"
      :current-nav-item="currentNavItem"
      :nav-items="navItems"
      @nav-changed="navChanged"
    />
    <preferences-body
      class="preferences-body"
      :current-nav-item="currentNavItem"
      :preferences="getPreferences"
      v-on="$listeners"
    >
      <div v-if="hasError" class="preferences-error">
        <empty-state
          icon="icon-warning"
          heading="Unable to fetch preferences"
          body="Reload Preferences to try again."
        >
          <template #primary-action>
            <button class="btn role-primary" @click="reloadPreferences">
              Reload preferences
            </button>
          </template>
        </empty-state>
      </div>
    </preferences-body>
    <preferences-actions
      class="preferences-actions"
      :is-dirty="isPreferencesDirty"
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

  .preferences-actions {
    grid-area: actions;
  }

  .modal-grid {
    height: 100vh;
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto 1fr auto;
    grid-template-areas:
      "header header"
      "nav body"
      "actions actions";
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
