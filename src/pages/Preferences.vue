<script lang="ts">
import { ipcRenderer } from 'electron';
import Vue from 'vue';
import { mapGetters } from 'vuex';
import _ from 'lodash';

import PreferencesHeader from '@/components/Preferences/ModalHeader.vue';
import PreferencesNav from '@/components/Preferences/ModalNav.vue';
import PreferencesBody from '@/components/Preferences/ModalBody.vue';
import PreferencesActions from '@/components/Preferences/ModalActions.vue';

export default Vue.extend({
  name:       'preferences-modal',
  components: {
    PreferencesHeader, PreferencesNav, PreferencesBody, PreferencesActions
  },
  layout: 'preferences',
  data() {
    return {
      currentNavItem: 'Application',
      navItems:       ['Application', 'Virtual Machine', 'Container Runtime', 'Kubernetes'],
      credentials:    {
        password: '',
        pid:      0,
        port:     0,
        user:     ''
      }
    };
  },
  computed: { ...mapGetters('preferences', ['getPreferences', 'isPreferencesDirty']) },
  watch:    {
    credentials(newVal) {
      if (newVal.port) {
        this.listPreferences();
      }
    }
  },
  beforeMount() {
    ipcRenderer.once('settings-read', (_event, settings) => {
      this.$store.dispatch('preferences/initializePreferences', settings);
    });

    ipcRenderer.on('settings-update', (_event, settings) => {
      this.$store.dispatch('preferences/initializePreferences', settings);
    });

    ipcRenderer.on('settings-read', (_event, settings) => {
      this.$store.dispatch('preferences/setPreferences', settings);
    });

    ipcRenderer.send('settings-read');

    ipcRenderer.on('api-credentials', (_event, credentials) => {
      this.credentials = credentials;
    });

    ipcRenderer.send('api-get-credentials');
  },
  methods: {
    navChanged(tabName: string) {
      this.currentNavItem = tabName;
    },
    closePreferences() {
      ipcRenderer.send('preferences-close');
    },
    applyPreferences() {
      this.$store.dispatch('preferences/commitPreferences');
      this.closePreferences();
    },
    async listPreferences() {
      console.debug({ credentials: this.credentials });

      const headers = new Headers();

      headers.set('Authorization', `Basic ${ window.btoa(`${ this.credentials.user }:${ this.credentials.password }`) }`);

      await fetch(
        `http://localhost:${ this.credentials.port }/v0/listSettings`,
        {
          mode: 'no-cors',
          headers
        }
      )
        .then((response: any) => {
          console.debug({ response });
        });
    }
  }
});
</script>

<template>
  <div class="modal-grid">
    <preferences-header
      class="preferences-header"
    />
    <preferences-nav
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
    />
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
  }

  .preferences-actions {
    grid-area: actions;
  }

  .modal-grid {
    height: 100vh;
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto 1fr;
    grid-template-areas:
      "header header"
      "nav body"
      "actions actions";
  }
</style>
