<script>
import Checkbox from '@/components/form/Checkbox';

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
      <br /><span class="fineprint">
        Send anonymized usage info, error reports, etc. to help improve Rancher Desktop.<br />
        Your data will not be shared with anyone else, and no information about<br />
        what specific resources or endpoints you are deploying is included.<br />
      </span>
    </div>
  </div>
</template>

<style scoped>
span.fineprint {
  font-size: small;
}
</style>
