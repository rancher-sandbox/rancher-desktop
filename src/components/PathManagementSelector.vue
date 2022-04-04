<script>
import RadioGroup from '@/components/form/RadioGroup';
import { PathManagementStrategy } from '@/integrations/pathManager';

export default {
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
    labelsAndValues() {
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
    options() {
      return this.labelsAndValues;
    }
  },
  methods: {
    updateVal(value) {
      this.$emit('input', value);
    },
  }
};
</script>

<template>
  <div class="engine-selector">
    <radio-group
      name="pathManagement"
      :label="t('pathManagement.label')"
      :tooltip-key="t('pathManagement.tooltip')"
      :value="value"
      :options="options"
      :row="row"
      @input="updateVal"
    />
  </div>
</template>
