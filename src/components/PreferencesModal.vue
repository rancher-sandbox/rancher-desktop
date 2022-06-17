<script lang="ts">
import Vue from 'vue';
import PreferencesHeader from '@/components/PreferencesHeader.vue';
import PreferencesNav from '@/components/PreferencesNav.vue';
import PreferencesBody from '@/components/PreferencesBody.vue';

export default Vue.extend({
  name:       'preferences-modal',
  components: {
    PreferencesHeader, PreferencesNav, PreferencesBody
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
      <preferences-header class="grid-header" />
      <preferences-nav class="grid-nav" />
      <preferences-body class="grid-body" />
    </div>
  </modal>
</template>

<style lang="scss">
  .modal .vm--modal {
    background-color: var(--body-bg);
  }

  .grid-header {
    grid-area: header;
  }

  .grid-nav {
    grid-area: nav;
  }

  .grid-body {
    grid-area: body;
  }

  .modal-grid {
    height: 100%;
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto 1fr;
    grid-template-areas:
      "header header"
      "nav body";
  }
</style>
