<script lang="ts">
import { RadioButton, RadioGroup } from '@rancher/components';
import Vue from 'vue';

import { PathManagementStrategy } from '@pkg/integrations/pathManager';

interface pathManagementOptions {
  label: string,
  value: PathManagementStrategy,
  description: string
}

export default Vue.extend({
  components: {
    RadioGroup,
    RadioButton,
  },
  props: {
    value: {
      type:    String,
      default: PathManagementStrategy.RcFiles,
    },
    row: {
      type:    Boolean,
      default: false,
    },
    showLabel: {
      type:    Boolean,
      default: true,
    },
    isLocked: {
      type:    Boolean,
      default: false,
    },
  },
  computed: {
    options(): pathManagementOptions[] {
      return [
        {
          label:       this.t('pathManagement.options.rcFiles.label'),
          value:       PathManagementStrategy.RcFiles,
          description: this.t('pathManagement.options.rcFiles.description', { }, true),
        },
        {
          label:       this.t('pathManagement.options.manual.label'),
          value:       PathManagementStrategy.Manual,
          description: this.t('pathManagement.options.manual.description', { }, true),
        },
      ];
    },
    groupName(): string {
      return 'pathManagement';
    },
    label(): string {
      return this.showLabel ? this.t('pathManagement.label') : '';
    },
    tooltip(): string {
      return this.showLabel ? this.t('pathManagement.tooltip', { }, true) : '';
    },
  },
  methods: {
    updateVal(value: PathManagementStrategy) {
      this.$emit('input', value);
    },
  },
});
</script>

<template>
  <radio-group
    :name="groupName"
    :label="label"
    :tooltip="tooltip"
    :value="value"
    :options="options"
    :row="row"
    :disabled="isLocked"
    :class="{ 'locked-radio' : isLocked }"
    class="path-management"
    @input="updateVal"
  >
    <template
      v-if="showLabel"
      #label
    >
      <slot name="label" />
    </template>
    <template #1="{ option, index, isDisabled, mode }">
      <radio-button
        :key="groupName+'-'+index"
        :name="groupName"
        :value="value"
        :label="option.label"
        :val="option.value"
        :disabled="isDisabled"
        :mode="mode"
        v-on="$listeners"
      >
        <template #description>
          <span v-html="option.description" />
        </template>
      </radio-button>
    </template>
  </radio-group>
</template>

<style lang="scss" scoped>
.path-management :deep(code) {
  user-select: text;
  cursor: text;
  padding: 2px;
}

.path-management :deep(label) {
  color: var(--input-label);
}
</style>
