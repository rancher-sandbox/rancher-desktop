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
        <li>Project Discussions: #rancher-desktop in <a href="#" onclick="require('electron').shell.openExternal('https://slack.rancher.io/')">Rancher Users</a> Slack</li>
        <li>Project Links: <a href="#" onclick="require('electron').shell.openExternal('https://github.com/rancher-sandbox/rd')">Homepage</a> <a href="#" onclick="require('electron').shell.openExternal('https://github.com/rancher-sandbox/rd/issues')">Issues</a></li>
      </ul>
    </div>
    <hr>
    <div class="versionInfo">
      <p><b>Version:</b> {{ version }} </p>
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
  name:       'General',
  title:      'General',
  components: { TelemetryOptIn },
  data() {
    return {
      /** @type Settings */
      settings: ipcRenderer.sendSync('settings-read'),
      version:  '',
    };
  },

  mounted() {
    ipcRenderer.on('settings-update', (event, settings) => {
      console.log('settings have been updated');
      this.$data.settings = settings;
    });
    ipcRenderer.invoke('get-app-version').then((result) => {
      this.version = result;
    }).catch((error) => {
      console.log(`get-app-version() failed with error ${ error }`);
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

.general li {
  margin-bottom: .5em;
}

</style>
