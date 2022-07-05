<script lang="ts">
import Vue from 'vue';
import RadioGroup from '@/components/form/RadioGroup.vue';
import RadioButton from '@/components/form/RadioButton.vue';
import { PathManagementStrategy } from '@/integrations/pathManager';

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
  props:      {
    value: {
      type:    String,
      default: PathManagementStrategy.RcFiles
    },
    row: {
      type:    Boolean,
      default: false
    }
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
    }
  },
  methods: {
    updateVal(value: PathManagementStrategy) {
      this.$emit('input', value);
    },
  }
});
</script>

<template>
  <radio-group
    :name="groupName"
    :label="t('pathManagement.label')"
    :tooltip="t('pathManagement.tooltip', { }, true)"
    :value="value"
    :options="options"
    :row="row"
    class="path-management"
    @input="updateVal"
  >
    <template #label>
      <slot name="label" />
    </template>
    <template #option="{ option, index, isDisabled, mode }">
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
.path-management::v-deep code {
  user-select: text;
  cursor: text;
  padding: 2px;
}

.path-management::v-deep label {
  color: var(--input-label);
}
</style>
