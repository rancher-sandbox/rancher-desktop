<script>
import RadioGroup from '@/components/form/RadioGroup';
import { PathManagementStrategy } from '@/integrations/pathManager';

export default {
  components: { RadioGroup },
  props:      {
    value: {
      type:     String,
      required: true
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
          label:       'Automatic',
          value:       PathManagementStrategy.RcFiles,
          description: 'Rancher Desktop edits your shell profile for you. Restart any open shells for changes to take effect.',
        },
        {
          label:       'Manual',
          value:       PathManagementStrategy.Manual,
          description: 'Rancher Desktop will not change your PATH configuration; use your favorite editor to add ~/.rd/bin to your path manually.',
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
      name="supportingUtils"
      label="Configure PATH"
      :value="value"
      :options="options"
      :row="row"
      @input="updateVal"
    />
  </div>
</template>
