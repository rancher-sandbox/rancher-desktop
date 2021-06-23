<script>
import LabeledInput from '@/components/form/LabeledInput.vue';
export default {
  components: { LabeledInput },
  props:      {
    port: {
      type:    Number,
      default: 6443,
    },
  },
  methods: {
    updatePort(value) {
      this.$emit('updatePort', parseInt(value, 10));
    },
  },
};
</script>

<template>
  <div class="system-preferences">
    <div id="portWrapper" class="labeled-input">
      <LabeledInput :value="port" :label="'Port'" type="'number'" @input="updatePort" />
    </div>
  </div>
</template>

<style scoped>

.labeled-input .vue-slider {
  margin: 2em 1em;
}

</style>
