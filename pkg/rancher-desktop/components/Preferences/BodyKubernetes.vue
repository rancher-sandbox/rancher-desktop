<script lang="ts">

import Vue from 'vue';
import { mapGetters } from 'vuex';

import { VersionEntry } from '@pkg/backend/k8s';
import RdInput from '@pkg/components/RdInput.vue';
import RdSelect from '@pkg/components/RdSelect.vue';
import RdCheckbox from '@pkg/components/form/RdCheckbox.vue';
import RdFieldset from '@pkg/components/form/RdFieldset.vue';
import { Settings } from '@pkg/config/settings';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default Vue.extend({
  name:       'preferences-body-kubernetes',
  components: {
    RdCheckbox, RdFieldset, RdSelect, RdInput,
  },
  props: {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  data() {
    return {
      enableKubernetes:   true,
      enableTraefik:      true,
      kubernetesPort:     6443,
      versions:           [] as VersionEntry[],
      cachedVersionsOnly: false,
    };
  },
  computed: {
    ...mapGetters('preferences', ['isPreferenceLocked']),
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
    },
    kubernetesVersion(): string {
      return this.preferences.kubernetes.version;
    },
    kubernetesVersionLabel(): string {
      return `Kubernetes version${ this.cachedVersionsOnly ? ' (cached versions only)' : '' }`;
    },
  },
  beforeMount() {
    ipcRenderer.on('k8s-versions', (event, versions, cachedVersionsOnly) => {
      this.versions = versions;
      this.cachedVersionsOnly = cachedVersionsOnly;
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
  },
});
</script>

<template>
  <div class="preferences-body">
    <rd-fieldset
      data-test="kubernetesToggle"
      legend-text="Kubernetes"
    >
      <rd-checkbox
        label="Enable Kubernetes"
        :value="preferences.kubernetes.enabled"
        :is-locked="isPreferenceLocked('kubernetes.enabled')"
        @input="onChange('kubernetes.enabled', $event)"
      />
    </rd-fieldset>
    <rd-fieldset
      data-test="kubernetesVersion"
      class="width-xs"
      :legend-text="kubernetesVersionLabel"
    >
      <rd-select
        class="select-k8s-version"
        :value="kubernetesVersion"
        :disabled="isKubernetesDisabled"
        :is-locked="isPreferenceLocked('kubernetes.version')"
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
      </rd-select>
    </rd-fieldset>
    <rd-fieldset
      data-test="kubernetesPort"
      class="width-xs"
      legend-text="Kubernetes Port"
    >
      <rd-input
        type="number"
        :disabled="isKubernetesDisabled"
        :value="preferences.kubernetes.port"
        :is-locked="isPreferenceLocked('kubernetes.port')"
        @input="onChange('kubernetes.port', castToNumber($event.target.value))"
      />
    </rd-fieldset>
    <rd-fieldset
      data-test="traefikToggle"
      legend-text="Traefik"
    >
      <rd-checkbox
        label="Enable Traefik"
        :disabled="isKubernetesDisabled"
        :value="preferences.kubernetes.options.traefik"
        :is-locked="isPreferenceLocked('kubernetes.options.traefik')"
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
