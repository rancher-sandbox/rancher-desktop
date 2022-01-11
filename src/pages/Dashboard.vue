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

  mounted() {
    this.$store.dispatch(
      'page/setHeader',
      { title: 'Rancher Dashboard' }
    );
  },

  methods: {
    openDashboard() {
      console.debug('NOT FAIL');
      ipcRenderer.send('ok:dashboard');
    }
  }
};
</script>
