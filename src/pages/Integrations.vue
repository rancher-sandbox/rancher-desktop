<router lang="yaml">
  name: Supporting Utilities
</router>

<script lang="ts">
import os from 'os';
import { ipcRenderer } from 'electron';
import Vue from 'vue';
import Integration from '@/components/Integration.vue';

declare module 'vue/types/vue' {
  interface t {
    (key: string): string
  }

  interface Vue {
    t: t;
  }
}

export default Vue.extend({
  components: { Integration },
  data() {
    return {
      /** @type Record<string, boolean | string> */
      integrations:        {},
      /** @type Record<string, Array<string>> */
      integrationWarnings: {},
    };
  },
  computed:   {
    hasIntegration() {
      return /^win|^darwin$/.test(os.platform());
    },
    integrationTitle(): string {
      if (os.platform() === 'darwin') {
        return this.t('integrations.darwin.title');
      }

      return this.t('integrations.windows.title');
    },
    integrationDescription(): string {
      if (os.platform() === 'darwin') {
        return this.t('integrations.darwin.description');
      }

      return '';
    },
  },
  created() {
    this.$store.dispatch(
      'page/setHeader',
      { title: this.integrationTitle }
    );
  },
  mounted() {
    ipcRenderer.on('k8s-integrations', (event, integrations) => {
      this.$data.integrations = integrations;
    });
    ipcRenderer.send('k8s-integrations');
    ipcRenderer.on('k8s-integration-warnings', (event, name, warnings) => {
      if (warnings.length === 0) {
        this.$delete(this.integrationWarnings, name);
      } else {
        this.$set(this.integrationWarnings, name, warnings);
      }
    });
    this.$nextTick(() => {
      ipcRenderer.send('k8s-integration-warnings');
    });
  },
  methods: {
    handleSetIntegration(distro: any, value: any) {
      // TODO: Find out the type for distro and value
      ipcRenderer.send('k8s-integration-set', distro, value);
    },
  }
});
</script>

<template>
  <integration
    v-if="hasIntegration"
    :integrations="integrations"
    :integration-warnings="integrationWarnings"
    :title="integrationTitle"
    :description="integrationDescription"
    @integration-set="handleSetIntegration"
  />
</template>
