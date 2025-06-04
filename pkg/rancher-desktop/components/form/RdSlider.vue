<script lang="ts">
import Vue from 'vue';
import VueSlider from 'vue-slider-component';

import RdInput from '@pkg/components/RdInput.vue';
import RdFieldset from '@pkg/components/form/RdFieldset.vue';

import 'vue-slider-component/theme/default.css';

export default Vue.extend({
  name:       'rd-slider',
  components: {
    VueSlider, RdFieldset, RdInput,
  },
  props: {
    label: {
      type:    String,
      default: '',
    },
    value: {
      type:     Number,
      required: true,
    },
    min: {
      type:     Number,
      required: true,
    },
    max: {
      type:     Number,
      required: true,
    },
    interval: {
      type:    Number,
      default: 1,
    },
    marks: {
      type:     Array,
      required: true,
    },
    disabled: {
      type:    Boolean,
      default: false,
    },
    process: {
      type:     Function,
      required: true,
    },
    isLocked: {
      type:    Boolean,
      default: false,
    },
  },
  methods: {
    updatedVal(value: string) {
      this.$emit('change', value);
    },
  },
});
</script>

<template>
  <rd-fieldset
    :legend-text="label"
    :is-locked="isLocked"
  >
    <div class="rd-slider">
      <rd-input
        type="number"
        class="slider-input"
        :value="value"
        :is-locked="isLocked"
        @input="updatedVal($event.target.value)"
      >
        <template #after>
          <div class="empty-content" />
        </template>
      </rd-input>
      <vue-slider
        ref="memory"
        class="rd-slider-rail"
        :value="value"
        :min="min"
        :max="max"
        :interval="interval"
        :marks="marks"
        :tooltip="'none'"
        :disabled="disabled || isLocked"
        :process="process"
        @change="updatedVal($event)"
      />
    </div>
  </rd-fieldset>
</template>

<style lang="scss" scoped>
.rd-fieldset {
  width: 100%;
}

.rd-slider {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 2rem;
}

.rd-slider-rail {
  flex-grow: 1;
}

.labeled-input .vue-slider {
  margin: 2em 1em;
  flex: 1;
}

.vue-slider :deep(.vue-slider-rail) {
  background-color: var(--progress-bg);
}

.vue-slider :deep(.vue-slider-mark-step) {
  background-color: var(--checkbox-tick-disabled);
  opacity: 0.5;
}

.vue-slider :deep(.vue-slider-dot-handle) {
  background-color: var(--scrollbar-thumb);
  box-shadow: 0.5px 0.5px 2px 1px var(--darker);
}

@media screen and (prefers-color-scheme: dark) {
  .vue-slider :deep(.vue-slider-dot-handle) {
    background-color: var(--checkbox-tick-disabled);
  }
}

.vue-slider :deep(.vue-slider-process) {
  background-color: var(--error);
}

.slider-input, .slider-input:focus, .slider-input:hover {
  max-width: 6rem;
}

.empty-content {
  display: none;
}
</style>
