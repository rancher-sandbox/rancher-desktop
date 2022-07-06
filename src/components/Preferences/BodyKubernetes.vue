<script lang="ts">
import Vue from 'vue';
import { ipcRenderer } from 'electron';
import Checkbox from '@/components/form/Checkbox.vue';
import { Settings } from '@/config/settings';
import { VersionEntry } from '@/k8s-engine/k8s';
import RdFieldset from '@/components/form/RdFieldset.vue';

export default Vue.extend({
  name:       'preferences-body-kubernetes',
  components: { Checkbox, RdFieldset },
  data() {
    return {
      enableKubernetes: true,
      enableTraefik:    true,
      kubernetesPort:   6443,
      settings:         { kubernetes: {} } as Settings,
      versions:         [] as VersionEntry[],
    };
  },
  computed: {
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
    },
    isKubernetesDisabled(): boolean {
      return !this.enableKubernetes;
    }
  },
  beforeMount() {
    ipcRenderer.on('k8s-versions', (event, versions) => {
      this.versions = versions;
      this.settings.kubernetes.version = this.defaultVersion.version.version;
    });

    ipcRenderer.send('k8s-versions');
  },
  methods: {
    onChange() {
      this.$emit('change:kubernetes-version');
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

<template>
  <div class="preferences-body">
    <rd-fieldset
      legend-text="Kubernetes"
    >
      <checkbox
        v-model="enableKubernetes"
        label="Enable Kubernetes"
      />
    </rd-fieldset>
    <rd-fieldset
      class="width-xs"
      legend-text="Kubernetes Version"
    >
      <select
        v-model="settings.kubernetes.version"
        class="select-k8s-version"
        :disabled="isKubernetesDisabled"
        @change="onChange"
      >
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
    </rd-fieldset>
    <rd-fieldset
      class="width-xs"
      legend-text="Kubernetes Port"
    >
      <input
        v-model="kubernetesPort"
        type="number"
        :disabled="isKubernetesDisabled"
      />
    </rd-fieldset>
    <rd-fieldset legend-text="Traefik">
      <checkbox
        v-model="enableTraefik"
        :disabled="isKubernetesDisabled"
        label="Enable Traefik"
      />
    </rd-fieldset>
  </div>
</template>

<style lang="scss" scoped>
  .checkbox-title {
    font-size: 1rem;
    line-height: 1.5rem;
    padding-bottom: 0.5rem;
  }

  .preferences-body {
    padding: var(--preferences-content-padding);
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .width-xs {
    max-width: 20rem;
    min-width: 20rem;
  }
</style>
