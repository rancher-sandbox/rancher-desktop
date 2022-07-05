<script lang="ts">
import Vue from 'vue';
import { ContainerEngine } from '@/config/settings';
import EngineSelector from '@/components/EngineSelector.vue';
import RdFieldset from '@/components/form/RdFieldset.vue';

export default Vue.extend({
  name:       'preferences-body-container-runtime',
  components: { EngineSelector, RdFieldset },
  data() {
    return { containerEngine: ContainerEngine.CONTAINERD };
  },
  methods: {
    onChangeEngine(desiredEngine: ContainerEngine) {
      this.containerEngine = desiredEngine;
      this.$emit('container-runtime-change', desiredEngine);
    },
  }
});
</script>

<template>
  <div class="preference-body">
    <rd-fieldset
      :legend-text="t('containerRuntime.label')"
    >
      <engine-selector
        :container-engine="containerEngine"
        @change="onChangeEngine"
      />
    </rd-fieldset>
  </div>
</template>

<style lang="scss" scoped>
  .preference-body {
    padding: 0.75rem;
  }
</style>
