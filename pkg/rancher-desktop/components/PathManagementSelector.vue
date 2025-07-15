<script lang="ts">
import { RadioButton, RadioGroup } from '@rancher/components';
import { defineComponent } from 'vue';

import { PathManagementStrategy } from '@pkg/integrations/pathManager';

interface pathManagementOptions {
  label: string,
  value: PathManagementStrategy,
  description: string
}

export default defineComponent({
  name:       'path-management-selector',
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
  emits: ['input'],
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
    @update:value="updateVal"
  >
    <template
      v-if="showLabel"
      #label
    >
      <slot name="label" />
    </template>
    <template #1="{ option, isDisabled, mode }">
      <radio-button
        v-bind="$attrs"
        :key="groupName+'-'+option.value"
        :name="groupName"
        :value="value"
        :label="option.label"
        :description="option.description"
        :val="option.value"
        :disabled="isDisabled"
        :mode="mode"
        @update:value="updateVal(option.value)"
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
