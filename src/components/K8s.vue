<template>
  <div class="about">
    <select class="select-k8s-version" :value="settings.kubernetes.version" @change="onChange($event)">
      <option v-for="item in versions" :key="item" :value="item">{{ item }}</option>
    </select> Kubernetes version
    <hr>
    <button @click="reset" :disabled="cannotReset" class="role-destructive btn-sm" :class="{ 'btn-disabled': cannotReset }">Reset Kubernetes</button>
    Resetting Kubernetes to default will delete all workloads and configuration
    <hr>
    <p>Minikube Settings:</p>
    <MinikubeMemory :memory_in_gb="settings.minikube.allocations.memory_in_gb"
                    @input="updatedMemory"/>
    <p>Supporting Utilities:</p>
    <Checkbox :label="'link to /usr/local/bin/kubectl'"
              :disabled="symlinks.kubectl === null"
              :value="symlinks.kubectl"
              @input="handleCheckbox($event, 'kubectl')"
             />
    <hr>
    <Checkbox :label="'link to /usr/local/bin/helm'"
              :disabled="symlinks.helm === null"
              :value="symlinks.helm"
              @input="handleCheckbox($event, 'helm')"
    />
    <hr>

  </div>
</template>

<script>
import Checkbox from './Checkbox.vue';
import MinikubeMemory from "./MinikubeMemory.vue";

const { ipcRenderer } = require('electron');
const K8s = require('../k8s-engine/k8s.js');
const semver = require('semver');

export default {
  name: 'K8s',
  title: 'Kubernetes Settings',
  components: {
    MinikubeMemory,
    Checkbox
  },
  data() {
    return {
      'state': ipcRenderer.sendSync('k8s-state'),
      'settings': ipcRenderer.sendSync('settings-read'),
      'versions': require("../generated/versions.json"),
      'symlinks': {
        'helm': null,
        'kubectl': null,
      }
    }
  },

  computed: {
    cannotReset: function() {
      return (this.state !== K8s.State.STARTED && this.state !== K8s.State.READY);
    }
  }, 

  methods: {
    // Reset a Kubernetes cluster to default at the same version
    reset() {
      this.state = K8s.State.STOPPING;
      ipcRenderer.send('k8s-reset', 'Reset Kubernetes to default');
    },
    restart() {
      this.state = K8s.State.STOPPING;
      ipcRenderer.send('k8s-restart', 'Restart Kubernetes');
    },
    onChange(event) {
      if (event.target.value != this.settings.kubernetes.version) {
        if (semver.lt(event.target.value, this.settings.kubernetes.version)){
          if (confirm("Changing from version " + this.settings.kubernetes.version + " to " + event.target.value + " will reset Kubernetes. Do you want to proceed?")) {
            ipcRenderer.invoke('settings-write', {kubernetes: {version: event.target.value}})
              .then(() => this.reset());
          } else {
            alert("The Kubernetes version was not changed");
          }
        } else {
          if (confirm("Changing from version " + this.settings.kubernetes.version + " to " + event.target.value + " will upgrade Kubernetes. Do you want to proceed?")) {
            ipcRenderer.invoke('settings-write', {kubernetes: {version: event.target.value}})
              .then(() => this.restart());
          } else {
            alert("The Kubernetes version was not changed");
          }
        }
      }
    },
    handleCheckbox(event, name) {
      ipcRenderer.send('install-set', name, event.target.checked);
    },
    updatedMemory(event) {
      let value = event.target.value;
      console.log(`QQQ: called updatedMemory! from ${event.target.nodeName}, value:${value}`);
      this.settings.minikube.allocations.memory_in_gb = value;
    }
  },

  mounted: function() {
    let that = this;
    ipcRenderer.on('k8s-check-state', function(event, stt) {
      that.$data.state = stt;
    })
    ipcRenderer.on('settings-update', (event, settings) => {
      this.$data.settings = settings;
    })
    ipcRenderer.on('install-state', (event, name, state) => {
      console.log(`install state changed for ${name}: ${state}`);
      this.$data.symlinks[name] = state;
    });
    ipcRenderer.send('install-state', 'kubectl');
    ipcRenderer.send('install-state', 'helm');
  },
}
</script>

<style scoped>
.select-k8s-version {
  width: inherit;
  display: inline-block;
}
</style>
