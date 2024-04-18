<script lang="ts">

import Vue from 'vue';
import { mapGetters } from 'vuex';

import EngineSelector from '@pkg/components/EngineSelector.vue';
import IncompatiblePreferencesAlert, { CompatiblePrefs } from '@pkg/components/IncompatiblePreferencesAlert.vue';
import RdCheckbox from '@pkg/components/form/RdCheckbox.vue';
import RdFieldset from '@pkg/components/form/RdFieldset.vue';
import { ContainerEngine, Settings } from '@pkg/config/settings';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default Vue.extend({
  name:       'preferences-container-engine-general',
  components: {
    EngineSelector,
    IncompatiblePreferencesAlert,
    RdCheckbox,
    RdFieldset,
  },
  props: {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  data() {
    return { containerEngine: ContainerEngine.CONTAINERD };
  },
  computed: {
    ...mapGetters('preferences', ['isPreferenceLocked']),
    webAssemblyIncompatiblePrefs(): CompatiblePrefs {
      if (!this.preferences.kubernetes.enabled) {
        // If Kubernetes is disabled, we don't have to worry about the operator.
        return [];
      }
      if (this.preferences.experimental.kubernetes.options.spinkube) {
        if (!this.preferences.experimental.containerEngine.webAssembly.enabled) {
          return [{
            title:       'Install Spin Operator',
            navItemName: 'Kubernetes',
          }];
        }
      }

      return [];
    },
  },
  methods: {
    onChangeEngine(desiredEngine: ContainerEngine) {
      this.containerEngine = desiredEngine;
      this.$emit('container-engine-change', desiredEngine);
    },
    onChange<P extends keyof RecursiveTypes<Settings>>(property: P, value: RecursiveTypes<Settings>[P]) {
      this.$store.dispatch('preferences/updatePreferencesData', { property, value });
    },
  },
});
</script>

<template>
  <div class="container-engine-general">
    <rd-fieldset
      data-test="containerEngine"
      :legend-text="t('containerEngine.label')"
      :is-locked="isPreferenceLocked('containerEngine.name')"
    >
      <template #default="{ isLocked }">
        <engine-selector
          :container-engine="preferences.containerEngine.name"
          :is-locked="isLocked"
          @change="onChange('containerEngine.name', $event)"
        />
      </template>
    </rd-fieldset>
    <rd-fieldset
      data-test="webAssembly"
      :legend-text="t('webAssembly.label')"
      :is-experimental="true"
    >
      <rd-checkbox
        data-test="webAssemblyCheckbox"
        :label="t('webAssembly.enabled')"
        :description="t('webAssembly.description')"
        :value="preferences.experimental.containerEngine.webAssembly.enabled"
        :is-locked="isPreferenceLocked('experimental.containerEngine.webAssembly.enabled')"
        @input="onChange('experimental.containerEngine.webAssembly.enabled', $event)"
      />
      <incompatible-preferences-alert
        v-if="webAssemblyIncompatiblePrefs.length > 0"
        mode="disabled"
        :compatible-prefs="webAssemblyIncompatiblePrefs"
      />
    </rd-fieldset>
  </div>
</template>

<style lang="scss" scoped>
.container-engine-general {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.container-engine-general::v-deep .checkbox-outer-container-description {
  font-size: 11px;
}
</style>
