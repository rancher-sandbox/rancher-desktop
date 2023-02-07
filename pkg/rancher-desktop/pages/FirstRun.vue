<template>
  <div>
    <h2 data-test="k8s-settings-header">
      Welcome to Rancher Desktop
    </h2>
    <Checkbox
      label="Enable Kubernetes"
      :value="settings.kubernetes.enabled"
      @input="handleDisableKubernetesCheckbox"
    />
    <label>
      Please select a Kubernetes version{{ offlineCheck() }}:
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
            :selected="item.version.version === unwrappedDefaultVersion"
          >
            {{ versionName(item) }}
          </option>
        </optgroup>
        <optgroup v-if="nonRecommendedVersions.length > 0" label="Other Versions">
          <option
            v-for="item in nonRecommendedVersions"
            :key="item.version.version"
            :value="item.version.version"
            :selected="item.version.version === unwrappedDefaultVersion"
          >
            v{{ item.version.version }}
          </option>
        </optgroup>
      </select>
    </label>
    <engine-selector
      :container-engine="settings.containerEngine.name"
      @change="onChangeEngine"
    />
    <path-management-selector
      v-if="pathManagementRelevant"
      :value="pathManagementStrategy"
      @input="setPathManagementStrategy"
    />
    <div class="button-area">
      <button
        data-test="accept-btn"
        class="role-primary"
        @click="close"
      >
        Accept
      </button>
    </div>
  </div>
</template>

<script lang="ts">
import os from 'os';

import { Checkbox } from '@rancher/components';
import Vue from 'vue';
import { mapGetters } from 'vuex';

import { VersionEntry } from '@pkg/backend/k8s';
import EngineSelector from '@pkg/components/EngineSelector.vue';
import PathManagementSelector from '@pkg/components/PathManagementSelector.vue';
import { defaultSettings } from '@pkg/config/settings';
import type { ContainerEngine } from '@pkg/config/settings';
import { PathManagementStrategy } from '@pkg/integrations/pathManager';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default Vue.extend({
  components: {
    Checkbox, EngineSelector, PathManagementSelector,
  },
  layout: 'dialog',
  data() {
    return {
      settings: defaultSettings,
      versions: [] as VersionEntry[],

      // If cachedVersionsOnly is true, it means we're offline and showing only the versions in the cache,
      // not all the versions listed in <cache>/rancher-desktop/k3s-versions.json
      cachedVersionsOnly: false,
    };
  },
  computed: {
    ...mapGetters('applicationSettings', { pathManagementStrategy: 'pathManagementStrategy' }),
    /** The version that should be pre-selected as the default value. */
    defaultVersion(): VersionEntry {
      const version = this.recommendedVersions.find(v => (v.channels ?? []).includes('stable'));

      return version ?? this.recommendedVersions[0] ?? this.nonRecommendedVersions[0];
    },
    // This field is needed because the template-parser doesn't like `defaultVersion?.version.version`
    unwrappedDefaultVersion(): string {
      const wrappedSemver = this.defaultVersion;

      return wrappedSemver ? wrappedSemver.version.version : '';
    },
    /** Versions that are the tip of a channel */
    recommendedVersions(): VersionEntry[] {
      return this.versions.filter(v => !!v.channels);
    },
    /** Versions that are not supported by a channel. */
    nonRecommendedVersions(): VersionEntry[] {
      return this.versions.filter(v => !v.channels);
    },
    pathManagementRelevant(): boolean {
      return os.platform() === 'linux' || os.platform() === 'darwin';
    },
  },
  mounted() {
    ipcRenderer.on('settings-read', (event, settings) => {
      this.$data.settings = settings;
    });
    ipcRenderer.send('settings-read');
    ipcRenderer.on('k8s-versions', (event, versions, cachedVersionsOnly) => {
      this.versions = versions;
      this.cachedVersionsOnly = cachedVersionsOnly;
      this.settings.kubernetes.version = this.unwrappedDefaultVersion;
      // Manually send the ready event here, as we do not use the normal
      // "dialog/populate" event.
      ipcRenderer.send('dialog/ready');
    });
    ipcRenderer.on('settings-update', (event, config) => {
      this.settings.containerEngine.name = config.containerEngine.name;
      this.settings.kubernetes.enabled = config.kubernetes.enabled;
    });
    ipcRenderer.send('k8s-versions');
    if (this.pathManagementRelevant) {
      this.setPathManagementStrategy(PathManagementStrategy.RcFiles);
    }
  },
  methods: {
    onChange() {
      ipcRenderer.invoke(
        'settings-write',
        {
          kubernetes:  { version: this.settings.kubernetes.version },
          application: { pathManagementStrategy: this.pathManagementStrategy },
        });
    },
    close() {
      this.onChange();
      window.close();
    },
    onChangeEngine(desiredEngine: ContainerEngine) {
      try {
        ipcRenderer.invoke(
          'settings-write',
          { containerEngine: { name: desiredEngine } },
        );
      } catch (err) {
        console.log('invoke settings-write failed: ', err);
      }
    },
    handleDisableKubernetesCheckbox(value: boolean) {
      try {
        ipcRenderer.invoke(
          'settings-write',
          { kubernetes: { enabled: value } },
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
    setPathManagementStrategy(val: PathManagementStrategy) {
      this.$store.dispatch('applicationSettings/setPathManagementStrategy', val);
    },
    offlineCheck() {
      return this.cachedVersionsOnly ? ' (cached versions only)' : '';
    },
  },
});
</script>

<style lang="scss" scoped>
  .button-area {
    align-self: flex-end;
  }

  .select-k8s-version {
    margin-top: 0.5rem;
  }
</style>
