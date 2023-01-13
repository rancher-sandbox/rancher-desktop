<script lang="ts">
import Vue from 'vue';

import EngineSelector from '@pkg/components/EngineSelector.vue';
import RdFieldset from '@pkg/components/form/RdFieldset.vue';
import { ContainerEngine, Settings } from '@pkg/config/settings';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default Vue.extend({
  name:       'preferences-container-engine-general',
  components: { EngineSelector, RdFieldset },
  props:      {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  data() {
    return { containerEngine: ContainerEngine.CONTAINERD };
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
    >
      <engine-selector
        :container-engine="preferences.containerEngine.name"
        @change="onChange('containerEngine.name', $event)"
      />
    </rd-fieldset>
  </div>
</template>
