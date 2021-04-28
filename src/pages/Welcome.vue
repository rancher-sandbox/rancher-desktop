<router lang="yaml">
  name: Welcome
</router>
<template>
  <div>
    <div class="welcome">
      <p>
        Welcome...
      </p>
    </div>
    <hr>
    <telemetry-opt-in
      :telemetry="settings.telemetry"
      @updateTelemetry="updateTelemetry"
    />
  </div>
</template>

<script>
import TelemetryOptIn from '@/components/TelemetryOptIn.vue';
const { ipcRenderer } = require('electron');

export default {
  name:       'Welcome',
  title:      'Welcome',
  components: { TelemetryOptIn },
  data() {
    return {
      /** @type Settings */
      settings: ipcRenderer.sendSync('settings-read'),
    };
  },

  mounted() {
    ipcRenderer.on('settings-update', (event, settings) => {
      console.log('settings have been updated');
      this.$data.settings = settings;
    });
  },

  methods: {
    updateTelemetry(value) {
      this.settings.telemetry = value;
      ipcRenderer.invoke('settings-write',
        { telemetry: value });
    },
  }
};
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
</style>
