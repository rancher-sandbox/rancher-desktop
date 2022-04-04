<script>
import RadioGroup from '@/components/form/RadioGroup';

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
          label:       'Automatic (sudo-less)',
          value:       'A',
          description: 'Rancher Desktop edits your shell profile for you. Restart any open shells for changes to take effect.',
        },
        {
          label:       'Manual',
          value:       'C',
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
