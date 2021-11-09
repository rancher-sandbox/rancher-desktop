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
  data() {
    return {
      containerEngineValues: ContainerEngine,
      containerEngineNames:  ContainerEngineNames,
    };
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
      label="Container Engine:"
      name="containerEngine"
      :value="containerEngine"
      :options="[containerEngineValues.CONTAINERD, containerEngineValues.MOBY]"
      :labels="[containerEngineNames[containerEngineValues.CONTAINERD], containerEngineNames[containerEngineValues.MOBY]]"
      :row="true"
      @input="updateEngine"
    />
  </div>
</template>

<style scoped>
.engine-selector {
  margin-left: 10%;
}
</style>
