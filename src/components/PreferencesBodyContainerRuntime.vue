<script lang="ts">
import Vue from 'vue';
import { ContainerEngine } from '@/config/settings';
import EngineSelector from '@/components/EngineSelector.vue';
import InputLegend from '@/components/form/InputLegend.vue';

export default Vue.extend({
  name:       'preferences-body-container-runtime',
  components: { EngineSelector, InputLegend },
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
    <input-legend>
      <template #legend>
        {{ t('containerRuntime.label') }}
      </template>
      <engine-selector
        :container-engine="containerEngine"
        @change="onChangeEngine"
      />
    </input-legend>
  </div>
</template>

<style lang="scss" scoped>
  .preference-body {
    padding: 0.75rem;
  }
</style>
