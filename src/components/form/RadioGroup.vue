<script>
import RadioButton from '@/components/form/RadioButton';
import { _VIEW } from '@/config/query-params';

export default {
  components: { RadioButton },
  props:      {
    // Name for the checkbox grouping, must be unique on page
    name: {
      type:     String,
      required: true,
    },

    // Options can be an array of {label, value}, or just values
    options: {
      type:     Array,
      required: true
    },

    // If options are just values, then labels can be a corresponding display value
    labels: {
      type:    Array,
      default: null,
    },

    // The selected value
    value: {
      type:    [Boolean, String],
      default: null
    },

    disabled: {
      type:    Boolean,
      default: false
    },

    mode: {
      type:    String,
      default: 'edit'
    },

    // Label for above the radios
    label: {
      type:    String,
      default: null
    },
    labelKey: {
      type:    String,
      default: null
    },

    // Label for above the radios
    tooltip: {
      type:    [String, Object],
      default: null
    },
    tooltipKey: {
      type:    String,
      default: null
    },

    // show radio buttons in column or row
    row: {
      type:    Boolean,
      default: false
    }
  },

  computed: {
    normalizedOptions() {
      const out = [];

      for ( let i = 0 ; i < this.options.length ; i++ ) {
        const opt = this.options[i];

        if ( typeof opt === 'object' && opt ) {
          out.push(opt);
        } else if ( this.labels ) {
          out.push({
            label: this.labels[i],
            value: opt,
          });
        } else {
          out.push({
            label: opt,
            value: opt
          });
        }
      }

      return out;
    },

    isView() {
      return this.mode === _VIEW;
    },

    isDisabled() {
      return (this.disabled || this.isView);
    }
  },

  methods: {
    // keyboard left/right event listener to select next/previous option
    clickNext(direction) {
      const opts = this.normalizedOptions;
      const selected = opts.find(x => x.value === this.value);
      let newIndex = (selected ? opts.indexOf(selected) : -1 ) + direction;

      if ( newIndex >= opts.length ) {
        newIndex = opts.length - 1;
      } else if ( newIndex < 0 ) {
        newIndex = 0;
      }

      this.$emit('input', opts[newIndex].value);
    }
  }
};
</script>

<template>
  <div>
    <div v-if="label || labelKey || tooltip || tooltipKey" class="radio-group label">
      <slot name="label">
        <h3>
          <t v-if="labelKey" :k="labelKey" />
          <template v-else-if="label">
            {{ label }}
          </template>
          <i v-if="tooltipKey" v-tooltip="t(tooltipKey)" class="icon icon-info icon-lg" />
          <i v-else-if="tooltip" v-tooltip="tooltip" class="icon icon-info icon-lg" />
        </h3>
      </slot>
    </div>
    <div
      class="radio-group"
      :class="{'row':row}"
      tabindex="0"
      @keyup.down.stop="clickNext(1)"
      @keyup.up.stop="clickNext(-1)"
    >
      <div
        v-for="(option, i) in normalizedOptions"
        :key="name+'-'+i"
      >
        <RadioButton
          :key="name+'-'+i"
          :name="name"
          :value="value"
          :label="option.label"
          :val="option.value"
          :disabled="isDisabled"
          :mode="mode"
          v-on="$listeners"
        />
      </div>
    </div>
  </div>
</template>

<style lang='scss'>
.radio-group {
  &:focus {
    border:none;
    outline:none;
  }

  h3 {
    position: relative;
  }

  &.row {
    display: flex;
    .radio-container {
      margin-right: 10px;
    }
  }

  .label{
    font-size: 14px !important;
  }
}
</style>
