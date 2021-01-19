<template>
  <div class="about">
    <select class="select-k8s-version" :value="settings.kubernetes.version" @change="onChange($event)">
      <option v-for="item in versions" :key="item" :value="item">{{ item }}</option>
    </select> Kubernetes version
    <hr>
    <button @click="reset" :disabled="cannotReset" class="role-destructive btn-sm" :class="{ 'btn-disabled': cannotReset }">Reset Kubernetes</button>
    Resetting Kubernetes to default will delete all workloads and configuration
    <hr>
    <div class="minikube-settings">
    <MinikubeMemory :memoryInGB="settings.minikube.allocations.memoryInGB"
                    :numberCPUs="settings.minikube.allocations.numberCPUs"
                    :availMemoryInGB = "availMemoryInGB"
                    :availNumCPUs="availNumCPUs"
                    @updateMemory="handleUpdateMemory"
                    @updateCPU="handleUpdateCPU"
                    @input="ignoreInputEvent"
                    />
    </div>
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
import debounce from 'lodash/debounce';
const os = require('os');

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
    },
    invalidMemoryValueReason: function() {
      let value = this.settings.minikube.allocations.memoryInGB;
      if (typeof(value) === "string") {
        // This might not work due to floating-point inaccuracies,
        // but testing showed it works for up to 3 decimal points.
        if (value === "") {
          return "No value provided";
        }
        if (!/^-?\d+(?:\.\d*)?$/.test(value)) {
          return "Contains non-numeric characters";
        }
      }
      let numericValue = parseFloat(value);
      if (isNaN(numericValue)) {
        return `${value} isnt numeric`
      }
      if (numericValue < 2) {
        return "Specified value is too low, must be at least 2 (GB)";
      }
      if (numericValue > this.availMemoryInGB && this.availMemoryInGB) {
        let etre = this.availMemoryInGB == 1 ? "is" : "are";
        return `Specified value is too high, only ${this.availMemoryInGB} GB ${etre} available`;
      }
      return '';
    },

    memoryValueIsValid: function() {
      return !this.invalidMemoryValueReason;
    },
    memoryValueIsntValid: function() {
      return !this.memoryValueIsValid;
    },
    invalidNumCPUsValueReason: function() {
      let value = this.settings.numberCPUs;
      let numericValue;
      if (typeof (value) === "string") {
        numericValue = parseFloat(value);
        if (isNaN(numericValue)) {
          return `${value} isnt numeric`
        }
      } else {
        numericValue = value;
      }
      if (numericValue < 2) {
        return "Specified value is too low, must be at least 2 (GB)";
      }
      if (numericValue > this.availNumCPUs && this.availNumCPUs) {
        return `Specified value is too high, only ${this.availNumCPUs} CPUs are available`;
      }
      return '';
    },

    numCPUsValueIsValid: function() {
      return !this.invalidNumCPUsValueReason;
    },
    numCPUsValueIsntValid: function() {
      return !this.numCPUsValueIsValid;
    },
  },

  created() {
    this.debouncedActOnUpdateMemory = debounce(this.actOnUpdatedMemory, 1000);
    this.debouncedActOnUpdateCPUs = debounce(this.actOnUpdatedCPUs, 1000);
    const totalMemInGB = os.totalmem() / 2**30;
    const minGBForNonMinikubeStuff = 6; // should be higher?
    if (totalMemInGB <= minGBForNonMinikubeStuff) {
      alert("There might not be enough memory to run minikube on this machine");
      this.availMemoryInGB = 0;
    } else {
      this.availMemoryInGB = totalMemInGB - minGBForNonMinikubeStuff;
    }
      this.availNumCPUs = os.cpus().length; // do we need to reserve one or two?

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
    handleUpdateMemory(event) {
      if (!event) {
        alert("awp - handleUpdateMemory has no event");
        return;
      }
      let value = event.target.value;
      this.settings.minikube.allocations.memoryInGB = value;
      if (this.memoryValueIsValid) {
        this.debouncedActOnUpdateMemory();
      }
    },
    handleUpdateCPU(event) {
      if (!event) {
        alert("awp - handleUpdateCPU has no event");
        return;
      }
      let value = event.target.value;
      this.settings.minikube.allocations.numberCPUs = parseInt(value, 10);
      if (this.numCPUsValueIsValid) {
        this.debouncedActOnUpdateCPUs();
      }
    },
    ignoreInputEvent(event) {
      //TODO: We shouldn't need this method
      console.log(`***: ignoring input event ${event}`);
    },
    actOnUpdatedMemory() {
      if (this.memoryValueIsValid) {
        ipcRenderer.invoke('settings-write', {
          minikube: {
            allocations: {
              memoryInGB: this.settings.minikube.allocations.memoryInGB
            }
          }
        })
      }
    },
    actOnUpdatedCPUs() {
      if (this.numCPUsValueIsValid) {
        ipcRenderer.invoke('settings-write', {
          minikube: {
            allocations: {
              numberCPUs: this.settings.minikube.allocations.numberCPUs
            }
          }
        })
      }
    },
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

p.bad-input {
  border: red 1px solid;
}

div.minikube-settings {
  width: 15em;
}
</style>
