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
  },
  computed: { ...mapGetters('preferences', ['getPreferences', 'isPreferencesDirty']) },
  methods:  {
    navChanged(tabName: string) {
      this.currentNavItem = tabName;
    },
    closePreferences() {
      ipcRenderer.send('preferences-close');
    },
    async applyPreferences() {
      await this.$store.dispatch(
        'preferences/commitPreferences',
        {
          port:     this.credentials.port,
          user:     this.credentials.user,
          password: this.credentials.password
        }
      );
      this.closePreferences();
    },
    async fetchPreferences() {
      await this.$store.dispatch(
        'preferences/fetchPreferences',
        {
          port:     this.credentials.port,
          user:     this.credentials.user,
          password: this.credentials.password
        }
      );
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
