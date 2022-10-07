<template>
  <div>
    <p v-if="isUnix">
      Rancher Desktop cannot be run with root privileges.
      Please run again as a regular user.
    </p>
    <p v-else>
      Rancher Desktop cannot be run as administrator.
      Please run again as a regular user.
    </p>
    <div class="button-area">
      <button
        data-test="accept-btn"
        class="role-primary"
        @click="close"
      >
        Ok
      </button>
    </div>
  </div>
</template>

<script lang="ts">
import os from 'os';
import Vue from 'vue';
import { ipcRenderer } from 'electron';

export default Vue.extend({
  layout: 'dialog',
  computed: {
    isUnix(): boolean {
      return ['linux', 'darwin'].includes(os.platform());
    }
  },
  mounted() {
    ipcRenderer.send('dialog/ready');
  },
  methods:{
    close() {
      window.close();
    },
  }
});
</script>

<style lang="scss" scoped>
  .button-area {
    align-self: flex-end;
  }
</style>
