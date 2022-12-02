<script lang="ts">
import { ipcRenderer } from 'electron';
import Vue from 'vue';

import Help from '@pkg/components/Help.vue';

export default Vue.extend({
  name:       'preferences-help',
  components: { Help },
  methods:    {
    openUrl() {
      ipcRenderer.send('help/preferences/open-url');
    },
  },
});
</script>

<template>
  <help @open:url="openUrl" />
</template>
