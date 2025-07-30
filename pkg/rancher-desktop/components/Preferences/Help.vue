<script lang="ts">

import { defineComponent } from 'vue';

import Help from '@pkg/components/Help.vue';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default defineComponent({
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
