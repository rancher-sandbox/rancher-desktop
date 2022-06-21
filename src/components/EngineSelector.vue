<script>
import RadioGroup from '@/components/form/RadioGroup';
import { ContainerEngine } from '@/config/settings';

export default {
  components: { RadioGroup },
  props:      {
    containerEngine: {
      type:    String,
      default: 'containerd',
    },
    row: {
      type:    Boolean,
      default: false
    }
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
    <radio-group
      name="containerEngine"
      :value="containerEngine"
      :options="options"
      :row="row"
      @input="updateEngine"
    >
      <template #label>
        <slot name="label" />
      </template>
    </radio-group>
  </div>
</template>
