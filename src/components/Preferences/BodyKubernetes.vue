<script lang="ts">
import Vue from 'vue';
import type { PropType } from 'vue';
import { ipcRenderer } from 'electron';

import Checkbox from '@/components/form/Checkbox.vue';
import { Settings } from '@/config/settings';
import { VersionEntry } from '@/k8s-engine/k8s';
import RdFieldset from '@/components/form/RdFieldset.vue';
import { RecursiveTypes } from '@/utils/typeUtils';

export default Vue.extend({
  name:       'preferences-body-kubernetes',
  components: { Checkbox, RdFieldset },
  props:      {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true
    }
  },
  data() {
    return {
      enableKubernetes:   true,
      enableTraefik:      true,
      kubernetesPort:     6443,
      settings:           { kubernetes: {} } as Settings,
      versions:           [] as VersionEntry[],
      cachedVersionsOnly: false,
    };
  },
  computed: {
    defaultVersion(): VersionEntry {
      const version = this.recommendedVersions.find(v => (v.channels ?? []).includes('stable'));

      return version ?? this.recommendedVersions[0] ?? this.nonRecommendedVersions[0];
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
      return !this.preferences.kubernetes.enabled;
    }
  },
  beforeMount() {
    ipcRenderer.on('k8s-versions', (event, versions, cachedVersionsOnly) => {
      this.versions = versions;
      this.cachedVersionsOnly = cachedVersionsOnly;
      this.settings.kubernetes.version = this.defaultVersion.version.version;
    });

    ipcRenderer.send('k8s-versions');
  },
  methods: {
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
    onChange<P extends keyof RecursiveTypes<Settings>>(property: P, value: RecursiveTypes<Settings>[P]) {
      this.$store.dispatch('preferences/updatePreferencesData', { property, value });
    },
    castToNumber(val: string): number | null {
      return val ? Number(val) : null;
    },
    kubernetesVersionLabel(): string {
      return `Kubernetes version${ this.cachedVersionsOnly ? ' (cached versions only)' : '' }`;
    },
  }
});
</script>

<template>
  <div class="preferences-body">
    <rd-fieldset
      data-test="kubernetesToggle"
      legend-text="Kubernetes"
    >
      <checkbox
        label="Enable Kubernetes"
        :value="preferences.kubernetes.enabled"
        @input="onChange('kubernetes.enabled', $event)"
      />
    </rd-fieldset>
    <rd-fieldset
      data-test="kubernetesVersion"
      class="width-xs"
      :legend-text="kubernetesVersionLabel()"
    >
      <select
        class="select-k8s-version"
        :disabled="isKubernetesDisabled"
        :value="preferences.kubernetes.version"
        @change="onChange('kubernetes.version', $event.target.value)"
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
      data-test="kubernetesPort"
      class="width-xs"
      legend-text="Kubernetes Port"
    >
      <input
        type="number"
        :disabled="isKubernetesDisabled"
        :value="preferences.kubernetes.port"
        @input="onChange('kubernetes.port', castToNumber($event.target.value))"
      />
    </rd-fieldset>
    <rd-fieldset
      data-test="traefikToggle"
      legend-text="Traefik"
    >
      <checkbox
        label="Enable Traefik"
        :disabled="isKubernetesDisabled"
        :value="preferences.kubernetes.options.traefik"
        @input="onChange('kubernetes.options.traefik', $event)"
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
