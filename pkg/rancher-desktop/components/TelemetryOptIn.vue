<script>
import RdCheckbox from '@pkg/components/form/RdCheckbox.vue';

export default {
  components: { RdCheckbox },
  props:      {
    // misc
    telemetry: {
      type:    Boolean,
      default: false,
    },
    isTelemetryLocked: {
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
      <rd-checkbox
        :value="telemetry"
        :is-locked="isTelemetryLocked"
        label="Allow collection of anonymous statistics to help us improve Rancher Desktop"
        @update:value="toggleTelemetry"
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
