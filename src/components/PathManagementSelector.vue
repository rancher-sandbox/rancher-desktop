<script lang="ts">
import Vue from 'vue';
import RadioGroup from '@/components/form/RadioGroup.vue';
import { PathManagementStrategy } from '@/integrations/pathManager';

interface pathManagementOptions {
  label: string,
  value: PathManagementStrategy,
  description: string
}

export default Vue.extend({
  components: { RadioGroup },
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
          description: this.t('pathManagement.options.rcFiles.description'),
        },
        {
          label:       this.t('pathManagement.options.manual.label'),
          value:       PathManagementStrategy.Manual,
          description: this.t('pathManagement.options.manual.description'),
        },
      ];
    },
  },
  methods: {
    updateVal(value: PathManagementStrategy) {
      this.$emit('input', value);
    },
  }
});
</script>

<template>
  <div class="engine-selector">
    <radio-group
      name="pathManagement"
      :label="t('pathManagement.label')"
      :tooltip-key="'pathManagement.tooltip'"
      :value="value"
      :options="options"
      :row="row"
      @input="updateVal"
    />
  </div>
</template>
