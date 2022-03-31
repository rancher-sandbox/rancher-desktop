<template>
  <div>
    <h2 data-test="k8s-settings-header">
      Welcome to Rancher Desktop
    </h2>
    <div class="k8s-settings">
      <label>
        Please select a Kubernetes version:
        <select v-model="settings.kubernetes.version" class="select-k8s-version" @change="onChange">
          <!--
            - On macOS Chrome / Electron can't style the <option> elements.
            - We do the best we can by instead using <optgroup> for a recommended section.
            -->
          <optgroup v-if="recommendedVersions.length > 0" label="Recommended Versions">
            <option
              v-for="item in recommendedVersions"
              :key="item.version.version"
              :value="item.version.version"
              :selected="item.version.version === defaultVersion.version.version"
            >
              {{ versionName(item) }}
            </option>
          </optgroup>
          <optgroup v-if="nonRecommendedVersions.length > 0" label="Other Versions">
            <option
              v-for="item in nonRecommendedVersions"
              :key="item.version.version"
              :value="item.version.version"
              :selected="item.version.version === defaultVersion.version.version"
            >
              v{{ item.version.version }}
            </option>
          </optgroup>
        </select>
      </label>
      <engine-selector
        :container-engine="settings.kubernetes.containerEngine"
        @change="onChangeEngine"
      />
      <Checkbox
        label="Enable Kubernetes"
        :value="settings.kubernetes.enabled"
        @input="handleDisableKubernetesCheckbox"
      />
    </div>
    <div class="button-area">
      <button data-test="accept-btn" class="role-primary" @click="close">
        Accept
      </button>
    </div>
  </div>
</template>

<script lang="ts">
import { ipcRenderer } from 'electron';
import Vue from 'vue';
import Checkbox from '@/components/form/Checkbox.vue';
import EngineSelector from '@/components/EngineSelector.vue';

import { Settings } from '@/config/settings';
import { VersionEntry } from '@/k8s-engine/k8s';

export default Vue.extend({
  components: { Checkbox, EngineSelector },
  layout:     'dialog',
  data() {
    return {
      settings: { kubernetes: {} } as Settings,
      versions: [] as VersionEntry[],
    };
  },
  computed: {
    /** The version that should be pre-selected as the default value. */
    defaultVersion(): VersionEntry {
      const version = this.recommendedVersions.find(v => (v.channels ?? []).includes('stable'));

      return version ?? (this.recommendedVersions ?? this.nonRecommendedVersions)[0];
    },
    /** Versions that are the tip of a channel */
    recommendedVersions(): VersionEntry[] {
      return this.versions.filter(v => !!v.channels);
    },
    /** Versions that are not supported by a channel. */
    nonRecommendedVersions(): VersionEntry[] {
      return this.versions.filter(v => !v.channels);
    }
  },
  mounted() {
    ipcRenderer.on('settings-read', (event, settings) => {
      this.$data.settings = settings;
    });
    ipcRenderer.send('settings-read');
    ipcRenderer.on('k8s-versions', (event, versions) => {
      this.versions = versions;
      this.settings.kubernetes.version = this.defaultVersion.version.version;
      ipcRenderer.send('firstrun/ready');
    });
    ipcRenderer.on('settings-update', (event, config) => {
      this.settings.kubernetes.containerEngine = config.kubernetes.containerEngine;
      this.settings.kubernetes.enabled = config.kubernetes.enabled;
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
    onChangeEngine(desiredEngine: string) {
      try {
        ipcRenderer.invoke(
          'settings-write',
          { kubernetes: { containerEngine: desiredEngine } }
        );
      } catch (err) {
        console.log('invoke settings-write failed: ', err);
      }
    },
    handleDisableKubernetesCheckbox(value: boolean) {
      try {
        ipcRenderer.invoke(
          'settings-write',
          { kubernetes: { enabled: value } }
        );
      } catch (err) {
        console.log('invoke settings-write failed: ', err);
      }
    },
    /**
     * Get the display name of a given version.
     * @param version The version to format.
     */
    versionName(version: VersionEntry) {
      const names = (version.channels ?? []).filter(ch => !/^v?\d+/.test(ch));

      if (names.length > 0) {
        return `v${ version.version.version } (${ names.join(', ') })`;
      }

      return `v${ version.version.version }`;
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

  .k8s-settings {
    flex: 1;
  }
</style>
