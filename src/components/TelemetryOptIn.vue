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
      <v-popover placement="right">
        <i class="icon icon-info" />
        <span slot="popover">
          Rancher Labs would like to collect a bit of anonymized information<br />
          about the configuration of your installation to help make Rancher Desktop better.<br /><br />
          Your data will not be shared with anyone else, and no information about<br />
          what specific resources or endpoints you are deploying is included.<br />
          Once enabled you can view exactly what data will be sent at <code>/v1-telemetry</code>.<br /><br />
          <a href="https://rancher.com/docs/rancher/v2.x/en/faq/telemetry/" target="_blank">More Info</a>
        </span>
      </v-popover>
    </div>
  </div>
</template>

<style scoped>
</style>
