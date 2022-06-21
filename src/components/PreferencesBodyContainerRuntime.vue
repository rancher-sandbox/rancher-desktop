<script lang="ts">
import Vue from 'vue';
import { ContainerEngine } from '@/config/settings';
import EngineSelector from '@/components/EngineSelector.vue';

export default Vue.extend({
  name:       'preferences-body-container-runtime',
  components: { EngineSelector },
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
    <engine-selector
      :container-engine="containerEngine"
      @change="onChangeEngine"
    >
      <template #label>
        <div class="preference-title">
          {{ t('containerRuntime.label') }}
        </div>
      </template>
    </engine-selector>
  </div>
</template>

<style lang="scss" scoped>
  .preference-title {
    font-size: 1rem;
    line-height: 1.5rem;
    padding-bottom: 0.5rem;
  }

  .preference-body {
    padding: 0.75rem;
  }
</style>
