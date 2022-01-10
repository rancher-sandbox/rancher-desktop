<template>
  <button
    class="btn role-primary"
    @click="openDashboard"
  >
    Open Dashboard
  </button>
</template>

<script>
import { ipcRenderer } from 'electron';

export default {
  name: 'dashboard',

  methods: {
    openDashboard() {
      console.debug('NOT FAIL');
      ipcRenderer.send('ok:dashboard');
    }
  }
};
</script>
