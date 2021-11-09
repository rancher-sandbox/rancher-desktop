<template>
  <radio-group
    name="container-runtime"
    label="Container Runtime"
    class="mb-15"
    :value="initialValue"
    :options="options"
    @input="onInput"
  />
</template>

<script>
import RadioGroup from '@/components/form/RadioGroup';

export default {
  name:       'container-runtime',
  components: { RadioGroup },
  props:      {
    value: {
      type:    String,
      default: 'dockerd'
    }
  },
  data() {
    return {
      options: [{
        label:       'dockerd (moby)',
        value:       'dockerd',
        description: 'Provide native docker API; use with docker cli and k3d.'
      },
      {
        label:       'containerd',
        value:       'containerd',
        description: 'Separate namespaces for regular and kubernetes container images; use with nerdctl.'
      }],
      initialValue: this.value
    };
  },
  methods: {
    onInput(val) {
      this.initialValue = val;
      this.$emit('input', val);
    }
  }
};
</script>
