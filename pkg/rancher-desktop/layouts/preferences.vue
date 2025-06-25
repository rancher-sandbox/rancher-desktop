<script lang="ts">
import Vue from 'vue';

import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default Vue.extend({
  name: 'preferences-layout',
  mounted() {
    this.$store.dispatch('i18n/init').catch(ex => console.error(ex));
    ipcRenderer.send('preferences/load');
  },
});
</script>

<template>
  <div class="wrapper">
    <RouterView />
  </div>
</template>

<style lang="scss" src="@pkg/assets/styles/app.scss"></style>
<style lang="scss" scoped>
  .wrapper {
    background-color: var(--body-bg);
  }
</style>
