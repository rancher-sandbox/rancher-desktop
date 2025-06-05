<script lang="ts">

import { Banner } from '@rancher/components';
import { defineComponent } from 'vue';
import { mapGetters } from 'vuex';

import RdInput from '@pkg/components/RdInput.vue';
import RdSelect from '@pkg/components/RdSelect.vue';
import RdCheckbox from '@pkg/components/form/RdCheckbox.vue';
import RdFieldset from '@pkg/components/form/RdFieldset.vue';
import { Settings } from '@pkg/config/settings';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';
import { highestStableVersion, VersionEntry } from '@pkg/utils/kubeVersions';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default defineComponent({
  name:       'preferences-body-kubernetes',
  components: {
    Banner,
    RdCheckbox,
    RdFieldset,
    RdSelect,
    RdInput,
  },
  props: {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  data() {
    return {
      versions:           [] as VersionEntry[],
      cachedVersionsOnly: false,
    };
  },
  computed: {
    ...mapGetters('preferences', ['isPreferenceLocked']),
    defaultVersion(): VersionEntry {
      return highestStableVersion(this.recommendedVersions) ?? this.nonRecommendedVersions[0];
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
    spinOperatorIncompatible(): boolean {
      return !this.isKubernetesDisabled &&
        !this.preferences.experimental.containerEngine.webAssembly.enabled &&
        this.preferences.experimental.kubernetes.options.spinkube;
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
        return `v${ version.version } (${ names.join(', ') })`;
      }

      return `v${ version.version }`;
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
        <optgroup
          v-if="recommendedVersions.length > 0"
          label="Recommended Versions"
        >
          <option
            v-for="item in recommendedVersions"
            :key="item.version"
            :value="item.version"
            :selected="item.version === defaultVersion.version"
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
            :selected="item.version === defaultVersion.version"
          >
            v{{ item.version }}
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
      data-test="kubernetesOptions"
      legend-text="Options"
    >
      <rd-checkbox
        label="Enable Traefik"
        :disabled="isKubernetesDisabled"
        :value="preferences.kubernetes.options.traefik"
        :is-locked="isPreferenceLocked('kubernetes.options.traefik')"
        @input="onChange('kubernetes.options.traefik', $event)"
      />
      <!-- Don't disable Spinkube option when Wasm is disabled; let validation deal with it  -->
      <rd-checkbox
        label="Install Spin Operator"
        :disabled="isKubernetesDisabled"
        :value="preferences.experimental.kubernetes.options.spinkube"
        :is-locked="isPreferenceLocked('experimental.kubernetes.options.spinkube')"
        :is-experimental="true"
        @input="onChange('experimental.kubernetes.options.spinkube', $event)"
      >
        <template v-if="spinOperatorIncompatible" #below>
          <banner color="warning">
            Spin operator requires
            <a href="#" @click.prevent="$root.navigate('Container Engine', 'general')">WebAssembly</a>
            to be enabled.
          </banner>
        </template>
      </rd-checkbox>
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
