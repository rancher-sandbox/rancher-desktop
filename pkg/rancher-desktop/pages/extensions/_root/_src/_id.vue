<script lang="ts">
import { ipcRenderer } from 'electron';
import Vue from 'vue';

import ExtensionsError from '@pkg/components/ExtensionsError.vue';
import { hexDecode } from '@pkg/utils/string-encode';

interface ExtensionsData {
  error: Error | undefined;
}

export default Vue.extend({
  components: { ExtensionsError },
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
  data(): ExtensionsData {
    return { error: undefined };
  },
  computed: {
    extensionId(): string | undefined {
      return hexDecode(this.$route.params.id);
    },
  },
  mounted() {
    this.$store.dispatch(
      'page/setHeader',
      { title: this.extensionId },
    );

    ipcRenderer.on('err:extensions/open', this.extensionError);
  },
  beforeDestroy() {
    ipcRenderer.off('err:extensions/open', this.extensionError);
  },
  methods: {
    openExtension(id: string, root: string, src: string): void {
      ipcRenderer.send('extensions/open', id, `${ root }/${ src }`);
    },
    closeExtensionView(): void {
      ipcRenderer.send('extensions/close');
    },
    extensionError(_event: any, err: Error): void {
      this.error = err;
    },
  },
});
</script>

<template>
  <extensions-error
    v-if="error"
    :error="error"
    :extension-id="extensionId"
  />
</template>
