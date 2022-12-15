<script lang="ts">
import Vue from 'vue';

import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default Vue.extend({
  name: 'preferences-layout',
  head() {
    // If dark-mode is set to auto (follow system-prefs) this is all we need
    // In a possible future with a three-way pref
    // (Always off // Always on // Follow system pref)
    // the "dark" part will be a dynamic pref.
    // See https://github.com/rancher/dashboard/blob/3454590ff6a825f7e739356069576fbae4afaebc/layouts/default.vue#L227 for an example
    return { bodyAttrs: { class: 'theme-dark' } };
  },
  mounted() {
    ipcRenderer.send('preferences/load');
  },
});
</script>

<template>
  <div class="wrapper">
    <Nuxt />
  </div>
</template>

<style lang="scss">
  @import "@pkg/assets/styles/app.scss";

  .wrapper {
    background-color: var(--body-bg);
  }
</style>
