<script>
import LabeledFormElement from '../../mixins/labeled-form-element';
import TextAreaAutoGrow from './TextAreaAutoGrow.vue';
import LabeledTooltip from './LabeledTooltip.vue';
import { escapeHtml } from '../../utils/string';

export default {
  components: { LabeledTooltip, TextAreaAutoGrow },
  mixins:     [LabeledFormElement],

  props: {
    type: {
      type:    String,
      default: 'text',
    },

    status: {
      type:      String,
      default:   null
    },

    tooltip: {
      type:    String,
      default: null,
    },

    hoverTooltip: {
      type:    Boolean,
      default: true,
    },
  },

  computed: {
    hasLabel() {
      return !!this.label || !!this.labelKey || !!this.$slots.label;
    },

    hasSuffix() {
      return !!this.$slots.suffix;
    }
  },

  methods: {
    focus() {
      const comp = this.$refs.value;

      if ( comp ) {
        comp.focus();
      }
    },

    select() {
      const comp = this.$refs.value;

      if ( comp ) {
        comp.select();
      }
    },

    onFocus() {
      this.onFocusLabeled();
    },

    onBlur() {
      this.onBlurLabeled();
    },

    escapeHtml
  }
};
</script>

<template>
  <div :class="{'labeled-input': true, focused, [mode]: true, disabled: isDisabled, [status]: status, suffix:hasSuffix}">
    <slot name="label">
      <label>
        <span v-if="labelKey">{{ labelKey}}</span>
        <template v-else-if="label">{{ label }}</template>

        <span v-if="required" class="required">*</span>
      </label>
    </slot>

    <slot name="prefix" />

    <slot name="field">
      <TextAreaAutoGrow
        v-if="type === 'multiline' || type === 'multiline-password'"
        ref="value"
        v-bind="$attrs"
        :disabled="isDisabled"
        :value="value"
        :placeholder="placeholder"
        autocapitalize="off"
        @input="$emit('input', $event)"
        @focus="onFocus"
        @blur="onBlur"
      />
      <input
        v-else
        ref="value"
        :class="{'no-label': !hasLabel}"
        v-bind="$attrs"
        :disabled="isDisabled"
        :type="type"
        :value="value"
        :placeholder="placeholder"
        autocomplete="off"
        autocapitalize="off"
        @input="$emit('input', $event.target.value)"
        @focus="onFocus"
        @blur="onBlur"
      >
    </slot>
    <slot name="suffix" />
    <LabeledTooltip
      v-if="tooltipKey && !focused"
      :hover="hoverTooltip"
      :value="tooltipKey"
      :status="status"
    />
    <LabeledTooltip
      v-else-if="tooltip && !focused"
      :hover="hoverTooltip"
      :value="tooltip"
      :status="status"
    />
  </div>
</template>
