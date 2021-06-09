<script>
import { _VIEW } from '@/config/query-params';
export default {
  props: {
    // The name of the input, for grouping
    name: {
      type:    String,
      default: ''
    },

    // The value for this option
    val: {
      required:  true,
      validator: x => true,
    },

    // The selected value...
    value: {
      required:  true,
      validator: x => true,
    },

    // The label shown next to the radio
    label: {
      type:    String,
      default: ''
    },

    disabled: {
      type:    Boolean,
      default: false
    },

    mode: {
      type:    String,
      default: 'edit',
    },

    descriptionKey: {
      type:    String,
      default: null
    },

    description: {
      type:    String,
      default: null
    },
  },

  data() {
    return { isChecked: this.value === this.val };
  },

  computed: {
    isDisabled() {
      return this.mode === _VIEW || this.disabled;
    },

    muteLabel() {
      // Don't mute the label if the mode is view and the button is checked
      return this.disabled && !(this.mode === _VIEW && this.isChecked);
    }
  },

  watch: {
    value(neu) {
      this.isChecked = this.val === neu;
      if ( this.isChecked ) {
        this.$refs.custom.focus();
      }
    }
  },

  methods: {
    clicked(e) {
      if (this.isDisabled) {
        return;
      }

      if (e.srcElement?.tagName === 'A') {
        return;
      }

      this.$emit('input', this.val);
    },
  }
};
</script>

<template>
  <label
    :class="{'disabled': isDisabled, 'radio-container': true}"
    @keydown.enter="clicked($event)"
    @keydown.space="clicked($event)"
    @click.stop="clicked($event)"
  >
    <input
      :id="_uid+'-radio'"
      :disabled="isDisabled"
      :name="name"
      :value="''+val"
      :checked="isChecked"
      type="radio"
      :tabindex="-1"
      @click.stop.prevent
    />
    <span
      ref="custom"
      :class="[ isDisabled ? 'text-muted' : '', 'radio-custom']"
      :tabindex="isDisabled ? -1 : 0"
      :aria-label="label"
      :aria-checked="isChecked"
      role="radio"
    />
    <div class="labeling">
      <label
        v-if="label"
        :class="[ muteLabel ? 'text-muted' : '', 'radio-label', 'm-0']"
        v-html="label"
      >
        <slot name="label">{{ label }}</slot>
      </label>
      <div v-if="descriptionKey || description" class="radio-button-outer-container-description">
        <t v-if="descriptionKey" :k="descriptionKey" />
        <template v-else-if="description">
          {{ description }}
        </template>
      </div>
    </div>
  </label>
</template>

<style lang='scss'>
$fontColor: var(--input-label);

.radio-view {
  display: flex;
  flex-direction: column;
  LABEL {
    color: var(--input-label)
  }
}

.radio-group {
  .text-label {
    display: block;
    padding-bottom: 5px;
  }
}

.radio-container {
  position: relative;
  display: inline-flex;
  align-items: flex-start;
  margin: 0;
  cursor: pointer;
  user-select: none;
  border-radius: var(--border-radius);
  padding-bottom: 5px;

  &.disabled {
    cursor: not-allowed
  }

 .radio-custom {
    height: 14px;
    width: 14px;
    min-height: 14px;
    min-width: 14px;
    background-color: var(--input-bg);
    border-radius: 50%;
    transition: all 0.3s ease-out;
    border: 1.5px solid var(--border);
    margin-top: 5px;

    &:focus {
      outline: none;
      border-radius: 50%;
    }
  }

  input {
    display: none;
  }

  .radio-custom {
    &[aria-checked="true"] {
      background-color: var(--primary);
      -webkit-transform: rotate(0deg) scale(1);
      -ms-transform: rotate(0deg) scale(1);
      transform: rotate(0deg) scale(1);
      opacity:1;
      border: 1.5px solid var(--primary);

      // Ensure that checked radio buttons are muted but still visibly selected when muted
      &.text-muted {
        opacity: .25;
      }
    }
  }

  input:disabled ~ .radio-custom:not([aria-checked="true"]) {
    background-color: var(--disabled-bg);
    opacity: .25;
  }

  .radio-button-outer-container-description {
    color: $fontColor;
    font-size: 11px;
    margin-top: 5px;
  }

  .labeling {
    display: inline-flex;
    flex-direction: column;

    margin: 3px 10px 0px 5px;
  }
}

</style>
