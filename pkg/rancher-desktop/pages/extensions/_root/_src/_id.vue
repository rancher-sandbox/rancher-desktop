<script lang="ts">
import { ipcRenderer } from 'electron';
import Vue from 'vue';

export default Vue.extend({
  beforeRouteEnter(to, _from, next) {
    const { params: { root, src, id } } = to;

    next((vm: any) => {
      vm.openExtension(id, root, src);
    });
  },
  beforeRouteUpdate(to, _from, next) {
    const { params: { root, src, id } } = to;

    this.openExtension(id, root, src);

    next();
  },
  beforeRouteLeave(_to, _from, next) {
    this.closeExtensionView();
    next();
  },
  methods: {
    openExtension(id: string, root: string, src: string): void {
      ipcRenderer.send('extensions/open', id, `${ root }/${ src }`);
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
