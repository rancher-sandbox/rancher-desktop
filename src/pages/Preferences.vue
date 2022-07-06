<script lang="ts">
import Vue from 'vue';
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
      navItems:       ['Application', 'Virtual Machine', 'Container Runtime', 'Kubernetes']
    };
  },
  methods: {
    navChanged(tabName: string) {
      this.currentNavItem = tabName;
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
    />
    <preferences-actions class="preferences-actions" />
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
