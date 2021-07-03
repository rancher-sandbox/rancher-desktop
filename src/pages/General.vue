<router lang="yaml">
  name: General
</router>
<template>
  <div>
    <div class="general">
      <h1>
        Welcome to Rancher Desktop
      </h1>
      <p>Rancher Desktop provides Kubernetes and image management through the use of a desktop application.</p>
      <ul>
        <li>Project Status: <i>alpha</i></li>
        <li>Project Discussions: #rancher-desktop in <a href="https://slack.rancher.io/">Rancher Users</a> Slack</li>
        <li>
          Project Links:
          <a href="https://github.com/rancher-sandbox/rancher-desktop">Homepage</a>
          <a href="https://github.com/rancher-sandbox/rancher-desktop/issues">Issues</a>
        </li>
      </ul>
    </div>
    <hr>
    <update-status :enabled="settings.updater" @enabled="onUpdateEnabled" />
    <hr>
    <telemetry-opt-in
      :telemetry="settings.telemetry"
      @updateTelemetry="updateTelemetry"
    />
  </div>
</template>

<script>
import TelemetryOptIn from '@/components/TelemetryOptIn.vue';
import UpdateStatus from '@/components/UpdateStatus.vue';
const { ipcRenderer } = require('electron');

export default {
  name:       'General',
  title:      'General',
  components: { TelemetryOptIn, UpdateStatus },
  data() {
    return {
      /** @type Settings */
      settings: ipcRenderer.sendSync('settings-read'),
    };
  },

  mounted() {
    ipcRenderer.on('settings-update', (event, settings) => {
      this.$data.settings = settings;
    });
  },

  methods: {
    onUpdateEnabled(value) {
      ipcRenderer.invoke('settings-write', { updater: value });
    },
    updateTelemetry(value) {
      ipcRenderer.invoke('settings-write', { telemetry: value });
    },
  }
};
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>

.general li {
  margin-bottom: .5em;
}

</style>
