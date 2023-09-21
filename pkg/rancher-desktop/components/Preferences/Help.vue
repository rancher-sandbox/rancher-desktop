<script lang="ts">

import Help from '@pkg/components/Help.vue';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';
import Vue from 'vue';

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
