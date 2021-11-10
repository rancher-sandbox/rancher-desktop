<template>
  <div>
    <h2 data-test="k8s-settings-header">
      Welcome to Rancher Desktop
    </h2>
    <label>
      Please select a Kubernetes version:
      <select
        v-model="settings.kubernetes.version"
        class="select-k8s-version"
        @change="onChange"
      >
        <option v-for="item in versions" :key="item" :value="item" :selected="item === versions[0]">
          {{ item }}
        </option>
      </select>
    </label>
    <container-runtime />
    <div class="button-area">
      <button data-test="accept-btn" class="role-primary" @click="close">
        Accept
      </button>
    </div>
  </div>
</template>

<script lang="ts">
import { ipcRenderer } from 'electron';
import ContainerRuntime from '@/components/ContainerRuntime.vue';
import Vue from 'vue';

import { Settings } from '@/config/settings';

export default Vue.extend({
  components: { ContainerRuntime },
  layout:     'dialog',
  data() {
    return {
      settings: { kubernetes: {} } as Settings,
      versions: [] as string[],
    };
  },
  mounted() {
    ipcRenderer.invoke('settings-read').then((settings) => {
      this.settings = settings;
    });
    ipcRenderer.on('k8s-versions', (event, versions) => {
      this.versions = versions;
      this.settings.kubernetes.version = versions[0];
      ipcRenderer.send('firstrun/ready');
    });
    ipcRenderer.send('k8s-versions');
  },
  methods: {
    onChange() {
      ipcRenderer.invoke('settings-write',
        { kubernetes: { version: this.settings.kubernetes.version } });
    },
    close() {
      this.onChange();
      window.close();
    },
  }
});
</script>

<style lang="scss" scoped>
  .select-k8s-version {
    margin-top: 0.5rem;
    margin-bottom: 1.5rem;
  }

  .button-area {
    // sass doesn't understand `end` here, and sets up `[dir]` selectors that
    // will never match anything.  So we need to use `right`, which breaks RTL.
    text-align: right;
  }
</style>
