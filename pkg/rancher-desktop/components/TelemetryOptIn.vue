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
        :label="t('telemetryOptIn.label')"
        @update:value="toggleTelemetry"
      />
      <p class="fineprint">
        {{ t('telemetryOptIn.fineprint') }}
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
