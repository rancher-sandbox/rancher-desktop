<script lang="ts">
import { ipcRenderer } from 'electron';
import Vue from 'vue';

export default Vue.extend({
  beforeRouteEnter(to, _from, next) {
    const { params: { id } } = to;

    next((vm: any) => {
      vm.openExtension(id);
    });
  },
  beforeRouteUpdate(to, _from, next) {
    const { params: { id } } = to;

    this.openExtension(id);

    next();
  },
  beforeRouteLeave(_to, _from, next) {
    this.closeExtensionView();
    next();
  },
  methods: {
    openExtension(id: string): void {
      ipcRenderer.send('extensions/open', id);
    },
    closeExtensionView(): void {
      ipcRenderer.send('extensions/close');
    },
  },
});
</script>

<template>
  <div>
    <slot></slot>
  </div>
</template>
