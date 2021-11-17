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
      containerEngineValues: Object.values(ContainerEngine).filter(x => x !== ContainerEngine.NONE),
      containerEngineNames:  Object.values(ContainerEngineNames).filter(x => x !== ContainerEngineNames[ContainerEngine.NONE]),
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
      :options="containerEngineValues"
      :labels="containerEngineNames"
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
