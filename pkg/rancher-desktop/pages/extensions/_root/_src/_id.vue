<script lang="ts">

import { ipcRenderer } from 'electron';
import { defineComponent } from 'vue';

import ExtensionsError from '@pkg/components/ExtensionsError.vue';
import ExtensionsUninstalled from '@pkg/components/ExtensionsUninstalled.vue';
import { hexDecode } from '@pkg/utils/string-encode';

interface ExtensionsData {
  error: Error | undefined;
  isExtensionGone: boolean;
}

export default defineComponent({
  name:       'extension-ui',
  components: { ExtensionsError, ExtensionsUninstalled },
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
    return {
      error:           undefined,
      isExtensionGone: false,
    };
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
    ipcRenderer.on('ok:extensions/uninstall', this.extensionUninstalled);
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
    extensionUninstalled(_event: any, extensionId: string): void {
      if (!this.extensionId) {
        return;
      }

      if (extensionId.startsWith(this.extensionId)) {
        this.isExtensionGone = true;
        this.closeExtensionView();
      }
    },
    browseCatalog() {
      this.$router.push({ name: 'Extensions' });
    },
  },
});
</script>

<template>
  <div class="extensions-container">
    <extensions-uninstalled
      v-if="isExtensionGone"
      :extension-id="extensionId"
      @click:browse="browseCatalog"
    />
    <extensions-error
      v-if="error"
      :error="error"
      :extension-id="extensionId"
    />
  </div>
</template>

<style lang="scss" scoped>
  .extensions-container {
    padding: 0 6rem;
    max-width: 64rem;
    justify-self: center;
  }
</style>
