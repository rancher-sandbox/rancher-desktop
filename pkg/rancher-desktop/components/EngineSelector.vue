<script>
import { RadioGroup } from '@rancher/components';

import { ContainerEngine } from '@pkg/config/settings';

export default {
  components: { RadioGroup },
  props:      {
    containerEngine: {
      type:    String,
      default: 'containerd',
    },
    row: {
      type:    Boolean,
      default: false,
    },
    isLocked: {
      type:    Boolean,
      default: false,
    },
  },
  computed: {
    options() {
      return Object.values(ContainerEngine)
        .filter(x => x !== ContainerEngine.NONE)
        .map((x) => {
          return {
            label:       this.t(`containerEngine.options.${ x }.label`),
            value:       x,
            description: this.t(`containerEngine.options.${ x }.description`),
          };
        });
    },
  },
  methods: {
    updateEngine(value) {
      this.$emit('change', value);
    },
  },
};
</script>

<template>
  <div class="engine-selector">
    <radio-group
      name="containerEngine"
      class="container-engine"
      :class="{ 'locked-radio' : isLocked }"
      :value="containerEngine"
      :options="options"
      :row="row"
      :disabled="isLocked"
      @input="updateEngine"
    >
      <template #label>
        <slot name="label" />
      </template>
    </radio-group>
  </div>
</template>

<style lang="scss" scoped>
.container-engine :deep(label) {
  color: var(--input-label);
}
</style>
