<script lang="ts">
import Vue from 'vue';
import type { PropType } from 'vue';

import { ContainerEngine, Settings } from '@/config/settings';
import EngineSelector from '@/components/EngineSelector.vue';
import RdFieldset from '@/components/form/RdFieldset.vue';
import { RecursiveTypes } from '@/utils/typeUtils';

export default Vue.extend({
  name:       'preferences-body-container-runtime',
  components: { EngineSelector, RdFieldset },
  props:      {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true
    }
  },
  data() {
    return { containerEngine: ContainerEngine.CONTAINERD };
  },
  methods: {
    onChangeEngine(desiredEngine: ContainerEngine) {
      this.containerEngine = desiredEngine;
      this.$emit('container-runtime-change', desiredEngine);
    },
    onChange<P extends keyof RecursiveTypes<Settings>>(property: P, value: RecursiveTypes<Settings>[P]) {
      this.$store.dispatch('preferences/updatePreferencesData', { property, value });
    }
  }
});
</script>

<template>
  <div class="preference-body">
    <rd-fieldset
      data-test="containerRuntime"
      :legend-text="t('containerRuntime.label')"
    >
      <engine-selector
        :container-engine="preferences.kubernetes.containerEngine"
        @change="onChange('kubernetes.containerEngine', $event)"
      />
    </rd-fieldset>
  </div>
</template>

<style lang="scss" scoped>
  .preference-body {
    padding: var(--preferences-content-padding);
  }
</style>
