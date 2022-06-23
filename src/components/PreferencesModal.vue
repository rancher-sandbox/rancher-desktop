<script lang="ts">
import Vue from 'vue';
import PreferencesHeader from '@/components/PreferencesHeader.vue';
import PreferencesNav from '@/components/PreferencesNav.vue';
import PreferencesBody from '@/components/PreferencesBody.vue';
import PreferencesActions from '@/components/PreferencesActions.vue';

export default Vue.extend({
  name:       'preferences-modal',
  components: {
    PreferencesHeader, PreferencesNav, PreferencesBody, PreferencesActions
  },
  data() {
    return {
      currentNavItem: 'Application',
      navItems:       ['Application', 'Virtual Machine', 'Container Runtime', 'Kubernetes']
    };
  },
  methods: {
    navChanged(tabName: string) {
      this.currentNavItem = tabName;
    },
    closeModal() {
      this.$modal.hide('preferences');
    }
  }
});
</script>

<template>
  <modal
    name="preferences"
    class="modal"
    height="95%"
    width="75%"
  >
    <div class="modal-grid">
      <preferences-header
        class="preferences-header"
        @click:close="closeModal"
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
  </modal>
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
    height: 100%;
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto 1fr;
    grid-template-areas:
      "header header"
      "nav body"
      "actions actions";
  }
</style>
