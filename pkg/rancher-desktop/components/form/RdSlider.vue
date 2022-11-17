<script lang="ts">
import Vue from 'vue';
import VueSlider from 'vue-slider-component';

import RdFieldset from '@pkg/components/form/RdFieldset.vue';
import 'vue-slider-component/theme/default.css';

export default Vue.extend({
  name:       'rd-slider',
  components: { VueSlider, RdFieldset },
  props:      {
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
  >
    <div class="rd-slider">
      <input
        type="number"
        class="slider-input"
        :value="value"
        @input="updatedVal($event.target.value)"
      />
      <vue-slider
        ref="memory"
        class="rd-slider-rail"
        :value="value"
        :min="min"
        :max="max"
        :interval="interval"
        :marks="marks"
        :tooltip="'none'"
        :disabled="disabled"
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

.vue-slider::v-deep .vue-slider-rail {
  background-color: var(--progress-bg);
}

.vue-slider::v-deep .vue-slider-mark-step {
  background-color: var(--checkbox-tick-disabled);
  opacity: 0.5;
}

.vue-slider::v-deep .vue-slider-dot-handle {
  background-color: var(--scrollbar-thumb);
  box-shadow: 0.5px 0.5px 2px 1px var(--darker);
}

@media screen and (prefers-color-scheme: dark) {
  .vue-slider::v-deep .vue-slider-dot-handle {
    background-color: var(--checkbox-tick-disabled);
  }
}

.vue-slider::v-deep .vue-slider-process {
  background-color: var(--error);
}

.slider-input, .slider-input:focus, .slider-input:hover {
  max-width: 6rem;
  border: solid var(--border-width) var(--input-border);
  padding:10px;
}
</style>
