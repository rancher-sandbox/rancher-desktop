<template>
  <div class="about">
    <select class="select-k8s-version" :value="settings.kubernetes.version" @change="onChange($event)">
      <option v-for="item in versions" :key="item" :value="item">{{ item }}</option>
    </select> Kubernetes version
    <hr>
    <RadioGroup
      name="rancherMode"
      :options="['NONE', 'HOMESTEAD']"
      :labels="['Disabled', 'Minimal']"
      v-model="settings.kubernetes.rancherMode"
      label="Rancher Installation"
      :row="true"
      @input="onRancherModeChanged()"
    />
    <hr>
    <button @click="reset" :disabled="cannotReset" class="role-destructive btn-sm" :class="{ 'btn-disabled': cannotReset }">Reset Kubernetes</button>
    Resetting Kubernetes to default will delete all workloads and configuration
    <hr>
    <system-preferences :memoryInGB="settings.kubernetes.memoryInGB"
                        :numberCPUs="settings.kubernetes.numberCPUs"
                        :availMemoryInGB="availMemoryInGB"
                        :availNumCPUs="availNumCPUs"
                        @updateMemory="handleUpdateMemory"
                        @updateCPU="handleUpdateCPU"
    />
    <p>Supporting Utilities:</p>
    <Checkbox :label="'link to /usr/local/bin/kubectl'"
              :disabled="symlinks.kubectl === null"
              :value="symlinks.kubectl"
              @input="value => handleCheckbox(value, 'kubectl')"
             />
    <hr>
    <Checkbox :label="'link to /usr/local/bin/helm'"
              :disabled="symlinks.helm === null"
              :value="symlinks.helm"
              @input="value => handleCheckbox(value, 'helm')"
    />
    <hr>

  </div>
</template>

<script>
import Checkbox from '@/src/components/Checkbox.vue';
import RadioGroup from './form/RadioGroup.vue';
import SystemPreferences from "@/src/components/SystemPreferences.vue";
import debounce from 'lodash/debounce';
const os = require('os');

const { ipcRenderer } = require('electron');
const K8s = require('../k8s-engine/k8s.js');
const semver = require('semver');

/** @typedef { import("../config/settings").Settings } Settings */

export default {
  name: 'K8s',
  title: 'Kubernetes Settings',
  components: {
    Checkbox,
    RadioGroup,
    SystemPreferences,
  },
  data() {
    return {
      state: ipcRenderer.sendSync('k8s-state'),
      /** @type Settings */
      settings: ipcRenderer.sendSync('settings-read'),
      versions: require("../generated/versions.json"),
      symlinks: {
        helm: null,
        kubectl: null,
      }
    }
  },

  computed: {
    cannotReset: function() {
      return (this.state !== K8s.State.STARTED && this.state !== K8s.State.READY);
    },

    memoryValueIsValid: function() {
      let value = this.settings.kubernetes.memoryInGB;
      let numericValue;
      if (typeof(value) !== "number") {
        numericValue = parseFloat(value, 10);
        if (isNaN(numericValue)) {
          return false;
        }
      }
      if (numericValue < 2 ||
          (numericValue > this.availMemoryInGB && this.availMemoryInGB)) {
        return false;
      }
      return true;
    },

    numCPUsValueIsValid: function() {
      let value = this.settings.kubernetes.numberCPUs;
      let numericValue;
      if (typeof (value) !== "number") {
        numericValue = parseInt(value, 10);
        if (isNaN(numericValue)) {
          return false;
        }
      } else {
        numericValue = value;
      }
      if (numericValue < 2 ||
        (numericValue > this.availNumCPUs && this.availNumCPUs)) {
        return false;
      }
      return true;
    }
  },

  created() {
    this.debouncedActOnUpdateMemory = debounce(this.actOnUpdatedMemory, 1000);
    this.debouncedActOnUpdateCPUs = debounce(this.actOnUpdatedCPUs, 1000);
    const totalMemInGB = os.totalmem() / 2**30;
    const reservedMemoryInGB = 6; // should be higher?
    if (totalMemInGB <= reservedMemoryInGB) {
      console.log("Warning: There might not be enough memory to run kubernetes on this machine");
      this.availMemoryInGB = 0;
    } else {
      this.availMemoryInGB = totalMemInGB - reservedMemoryInGB;
    }
    this.availNumCPUs = os.cpus().length; // do we need to reserve one or two?
    if (this.settings.kubernetes.memoryInGB > this.availMemoryInGB) {
      window.alert(`Reducing memory size from ${this.settings.kubernetes.memoryInGB} to ${this.availMemoryInGB}`);
      this.settings.kubernetes.memoryInGB = this.availMemoryInGB;
    }
    if (this.settings.kubernetes.numberCPUs > this.availNumCPUs) {
      window.alert(`Reducing # of CPUs from ${this.settings.kubernetes.numberCPUs} to ${this.availNumCPUs}`);
      this.settings.kubernetes.numberCPUs = this.availNumCPUs;
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
    handleCheckbox(value, name) {
      ipcRenderer.send('install-set', name, value);
    },
    handleUpdateMemory(value) {
      this.settings.kubernetes.memoryInGB = value;
      if (this.memoryValueIsValid) {
        this.debouncedActOnUpdateMemory();
      }
    },
    handleUpdateCPU(value) {
      this.settings.kubernetes.numberCPUs = value;
      if (this.numCPUsValueIsValid) {
        this.debouncedActOnUpdateCPUs();
      }
    },
    onRancherModeChanged() {
      ipcRenderer.invoke('settings-write', {
        kubernetes: {
          rancherMode: this.$data.settings.kubernetes.rancherMode,
        },
      });
    },
    actOnUpdatedMemory() {
      if (this.memoryValueIsValid) {
        ipcRenderer.invoke('settings-write', {
          kubernetes: {
              memoryInGB: this.settings.kubernetes.memoryInGB
          }
        })
      }
    },
    actOnUpdatedCPUs() {
      if (this.numCPUsValueIsValid) {
        ipcRenderer.invoke('settings-write', {
          kubernetes: {
              numberCPUs: this.settings.kubernetes.numberCPUs
            }
        })
      }
    },
    onRancherModeChanged() {
      ipcRenderer.invoke('settings-write', {
        kubernetes: {
          rancherMode: this.$data.settings.kubernetes.rancherMode,
        },
      });
  },

  mounted: function() {
    let that = this;
    ipcRenderer.on('k8s-check-state', function(event, stt) {
      that.$data.state = stt;
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
