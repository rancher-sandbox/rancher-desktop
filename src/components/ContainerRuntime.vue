<template>
  <radio-group
    name="container-runtime"
    class="mb-15"
    :label="t('containerRuntime.label')"
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
      default: 'moby'
    }
  },
  data() {
    return {
      options: [{
        label:       this.t('containerRuntime.options.moby.label'),
        value:       'moby',
        description: this.t('containerRuntime.options.moby.description'),
      },
      {
        label:       this.t('containerRuntime.options.containerd.label'),
        value:       'containerd',
        description: this.t('containerRuntime.options.containerd.description'),
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
