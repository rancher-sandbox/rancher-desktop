<script>
import RadioGroup from '@/components/form/RadioGroup';
import { ContainerEngine, ContainerEngineNames } from '@/config/settings';
export default {
  components: { RadioGroup },
  props:      {
    containerEngine: {
      type:    String,
      default: 'containerd',
    },
  },
  computed: {
    options() {
      return Object.values(ContainerEngine)
        .filter(x => x !== ContainerEngine.NONE)
        .map((x) => {
          return {
            label:       this.t(`containerRuntime.options.${ x }.label`),
            value:       x,
            description: this.t(`containerRuntime.options.${ x }.description`)
          };
        });
    }
  },
  methods: {
    updateEngine(value) {
      this.$emit('change', value);
    },
  }
};
</script>

<template>
  <div class="engine-selector">
    <RadioGroup
      name="containerEngine"
      class="mb-15"
      :label="t('containerRuntime.label')"
      :value="containerEngine"
      :options="options"
      @input="updateEngine"
    />
  </div>
</template>
