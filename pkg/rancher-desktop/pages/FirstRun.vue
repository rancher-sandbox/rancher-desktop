<template>
  <div class="first-run-container">
    <h2 data-test="k8s-settings-header">
      Welcome to Rancher Desktop by SUSE
    </h2>
    <rd-checkbox
      label="Enable Kubernetes"
      :value="hasVersions && settings.kubernetes.enabled"
      :is-locked="kubernetesLocked"
      :disabled="!hasVersions"
      @input="handleDisableKubernetesCheckbox"
    />
    <rd-fieldset
      :legend-text="t('firstRun.kubernetesVersion.legend') + offlineCheck()"
    >
      <rd-select
        v-model="settings.kubernetes.version"
        :is-locked="kubernetesVersionLocked"
        class="select-k8s-version"
        @change="onChange"
      >
        <!--
            - On macOS Chrome / Electron can't style the <option> elements.
            - We do the best we can by instead using <optgroup> for a recommended section.
            -->
        <optgroup
          v-if="recommendedVersions.length > 0"
          label="Recommended Versions"
        >
          <option
            v-for="item in recommendedVersions"
            :key="item.version"
            :value="item.version"
            :selected="item.version === unwrappedDefaultVersion"
          >
            {{ versionName(item) }}
          </option>
        </optgroup>
        <optgroup
          v-if="nonRecommendedVersions.length > 0"
          label="Other Versions"
        >
          <option
            v-for="item in nonRecommendedVersions"
            :key="item.version"
            :value="item.version"
            :selected="item.version === unwrappedDefaultVersion"
          >
            v{{ item.version }}
          </option>
        </optgroup>
      </rd-select>
    </rd-fieldset>
    <rd-fieldset
      :legend-text="t('containerEngine.label')"
      :is-locked="engineSelectorLocked"
    >
      <engine-selector
        :container-engine="settings.containerEngine.name"
        :is-locked="engineSelectorLocked"
        @change="onChangeEngine"
      />
    </rd-fieldset>
    <rd-fieldset
      v-if="pathManagementRelevant"
      :legend-text="t('pathManagement.label')"
      :legend-tooltip="t('pathManagement.tooltip', { }, true)"
      :is-locked="pathManagementSelectorLocked"
    >
      <path-management-selector
        :value="pathManagementStrategy"
        :is-locked="pathManagementSelectorLocked"
        :show-label="false"
        @input="setPathManagementStrategy"
      />
    </rd-fieldset>
    <div class="button-area">
      <button
        data-test="accept-btn"
        class="role-primary"
        @click="close"
      >
        {{ t('firstRun.ok') }}
      </button>
    </div>
  </div>
</template>

<script lang="ts">
import os from 'os';

import _ from 'lodash';
import { defineComponent } from 'vue';
import { mapGetters } from 'vuex';

import EngineSelector from '@pkg/components/EngineSelector.vue';
import PathManagementSelector from '@pkg/components/PathManagementSelector.vue';
import RdSelect from '@pkg/components/RdSelect.vue';
import RdCheckbox from '@pkg/components/form/RdCheckbox.vue';
import RdFieldset from '@pkg/components/form/RdFieldset.vue';
import { defaultSettings } from '@pkg/config/settings';
import type { ContainerEngine, Settings } from '@pkg/config/settings';
import { PathManagementStrategy } from '@pkg/integrations/pathManager';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';
import { highestStableVersion, VersionEntry } from '@pkg/utils/kubeVersions';
import { RecursivePartial } from '@pkg/utils/typeUtils';

export default defineComponent({
  name:       'first-run-dialog',
  components: {
    RdFieldset,
    RdCheckbox,
    EngineSelector,
    PathManagementSelector,
    RdSelect,
  },
  layout: 'dialog',
  data() {
    return {
      settings:                     defaultSettings,
      kubernetesLocked:             false,
      kubernetesVersionLocked:      false,
      engineSelectorLocked:         false,
      pathManagementSelectorLocked: false,
      versions:                     [] as VersionEntry[],

      // If cachedVersionsOnly is true, it means we're offline and showing only the versions in the cache,
      // not all the versions listed in <cache>/rancher-desktop/k3s-versions.json
      cachedVersionsOnly: false,
    };
  },
  computed: {
    ...mapGetters('applicationSettings', { pathManagementStrategy: 'pathManagementStrategy' }),
    /** The version that should be pre-selected as the default value. */
    defaultVersion(): VersionEntry {
      return highestStableVersion(this.recommendedVersions) ?? this.nonRecommendedVersions[0];
    },
    // This field is needed because the template-parser doesn't like `defaultVersion?.version.version`
    unwrappedDefaultVersion(): string {
      const wrappedSemver = this.defaultVersion;

      return wrappedSemver ? wrappedSemver.version : '';
    },
    hasVersions(): boolean {
      return this.versions.length > 0;
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
  beforeMount() {
    // Save default settings on closing window.
    window.addEventListener('beforeunload', this.close);
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
      if (!this.hasVersions) {
        ipcRenderer.invoke('settings-write', { kubernetes: { enabled: false } });
      }
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
    ipcRenderer.invoke('get-locked-fields').then((lockedFields) => {
      this.$data.kubernetesLocked = _.get(lockedFields, 'kubernetes.enabled');
      this.$data.kubernetesVersionLocked = _.get(lockedFields, 'kubernetes.version');
      this.$data.engineSelectorLocked = _.get(lockedFields, 'containerEngine.name');
      this.$data.pathManagementSelectorLocked = _.get(lockedFields, 'application.pathManagementStrategy');
    });
  },
  beforeUnmount() {
    window.removeEventListener('beforeunload', this.close);
  },
  methods: {
    async commitChanges(settings: RecursivePartial<Settings>) {
      try {
        return await ipcRenderer.invoke('settings-write', settings);
      } catch (ex) {
        console.log(`invoke settings-write failed: `, ex);
      }
    },
    onChange() {
      return this.commitChanges({
        application: { pathManagementStrategy: this.pathManagementStrategy },
        kubernetes:  {
          version: this.settings.kubernetes.version,
          enabled: this.settings.kubernetes.enabled && this.hasVersions,
        },
      });
    },
    close() {
      this.onChange();
      window.close();
    },
    onChangeEngine(desiredEngine: ContainerEngine) {
      return this.commitChanges({ containerEngine: { name: desiredEngine } });
    },
    handleDisableKubernetesCheckbox(value: boolean) {
      return this.commitChanges({ kubernetes: { enabled: value } });
    },
    /**
     * Get the display name of a given version.
     * @param version The version to format.
     */
    versionName(version: VersionEntry) {
      const names = (version.channels ?? []).filter(ch => !/^v?\d+/.test(ch));

      if (names.length > 0) {
        return `v${ version.version } (${ names.join(', ') })`;
      }

      return `v${ version.version }`;
    },
    setPathManagementStrategy(val: PathManagementStrategy) {
      this.$store.dispatch('applicationSettings/setPathManagementStrategy', val);
    },
    offlineCheck() {
      return this.cachedVersionsOnly ? ` ${ this.t('firstRun.kubernetesVersion.cachedOnly') }` : '';
    },
  },
});
</script>

<style lang="scss">
  html {
    height: initial;
  }
</style>

<style lang="scss" scoped>
  .button-area {
    align-self: flex-end;
  }

  .select-k8s-version {
    margin-top: 0.5rem;
  }

  .first-run-container {
    width: 26rem;
  }
</style>
