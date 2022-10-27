<script>
import { Checkbox } from '@rancher/components';

export default {
  components: { Checkbox },
  props:      {
    // misc
    telemetry: {
      type:    Boolean,
      default: false,
    },
  },
  methods: {
    toggleTelemetry(value) {
      this.$emit('updateTelemetry', value);
    },
  },
};
</script>

<template>
  <div class="system-preferences">
    <div class="checkbox">
      <Checkbox
        :value="telemetry"
        label="Allow collection of anonymous statistics to help us improve Rancher Desktop"
        @input="toggleTelemetry"
      />
      <p class="fineprint">
        Send anonymized usage info, error reports, etc. to help improve Rancher Desktop. Your data will not be shared with anyone else, and no information about what specific resources or endpoints you are deploying is included.
      </p>
    </div>
  </div>
</template>

<style scoped>
p.fineprint {
  font-size: small;
  margin-top: 2px;
  color: var(--input-label);
}
</style>
