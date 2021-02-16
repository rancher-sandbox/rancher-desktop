<router lang="yaml">
  name: Kubernetes Settings
</router>
<template>
  <div class="about">
    <select class="select-k8s-version" :value="settings.kubernetes.version" @change="onChange($event)">
      <option v-for="item in versions" :key="item" :value="item">
        {{ item }}
      </option>
    </select> Kubernetes version
    <hr>
    <RadioGroup
      v-model="settings.kubernetes.rancherMode"
      name="rancherMode"
      :options="['NONE', 'HOMESTEAD']"
      :labels="['Disabled', 'Minimal']"
      label="Rancher Installation"
      :row="true"
      @input="onRancherModeChanged()"
    />
    <hr>
    <system-preferences
      :memory-in-g-b="settings.kubernetes.memoryInGB"
      :number-c-p-us="settings.kubernetes.numberCPUs"
      :avail-memory-in-g-b="availMemoryInGB"
      :avail-num-c-p-us="availNumCPUs"
      :reserved-memory-in-g-b="6"
      :reserved-num-c-p-us="1"
      @updateMemory="handleUpdateMemory"
      @updateCPU="handleUpdateCPU"
    />
    <hr>
    <button :disabled="cannotReset" class="role-destructive btn-sm" :class="{ 'btn-disabled': cannotReset }" @click="reset">
      Reset Kubernetes
    </button>
    Resetting Kubernetes to default will delete all workloads and configuration
    <hr>
    <p>Supporting Utilities:</p>
    <Checkbox
      :label="'link to /usr/local/bin/kubectl'"
      :disabled="symlinks.kubectl === null"
      :value="symlinks.kubectl"
      @input="value => handleCheckbox(value, 'kubectl')"
    />
    <hr>
    <Checkbox
      :label="'link to /usr/local/bin/helm'"
      :disabled="symlinks.helm === null"
      :value="symlinks.helm"
      @input="value => handleCheckbox(value, 'helm')"
    />
    <hr>
  </div>
</template>

<script>
import Checkbox from '@/components/Checkbox.vue';
import RadioGroup from '@/components/form/RadioGroup.vue';
import SystemPreferences from '@/components/SystemPreferences.vue';
const os = require('os');

const { ipcRenderer } = require('electron');
const semver = require('semver');
const K8s = require('../k8s-engine/k8s.js');

/** @typedef { import("../config/settings").Settings } Settings */

export default {
  name:       'K8s',
  title:      'Kubernetes Settings',
  components: {
    Checkbox,
    RadioGroup,
    SystemPreferences,
  },
  data() {
    return {
      state:    ipcRenderer.sendSync('k8s-state'),
      /** @type Settings */
      settings: ipcRenderer.sendSync('settings-read'),
      versions: require('../generated/versions.json'),
      symlinks: {
        helm:    null,
        kubectl: null,
      },
    };
  },

  computed: {
    availMemoryInGB() {
      return os.totalmem() / 2 ** 30;
    },
    availNumCPUs() {
      return os.cpus().length;
    },
    cannotReset() {
      return (this.state !== K8s.State.STARTED && this.state !== K8s.State.READY);
    },
  },

  created() {
    if (this.settings.kubernetes.memoryInGB > this.availMemoryInGB) {
      alert(`Reducing memory size from ${ this.settings.kubernetes.memoryInGB } to ${ this.availMemoryInGB }`);
      this.settings.kubernetes.memoryInGB = this.availMemoryInGB;
    }
    if (this.settings.kubernetes.numberCPUs > this.availNumCPUs) {
      alert(`Reducing # of CPUs from ${ this.settings.kubernetes.numberCPUs } to ${ this.availNumCPUs }`);
      this.settings.kubernetes.numberCPUs = this.availNumCPUs;
    }
  },

  mounted() {
    const that = this;

    ipcRenderer.on('k8s-check-state', (event, stt) => {
      that.$data.state = stt;
    });
    ipcRenderer.on('settings-update', (event, settings) => {
      // TODO: put in a status bar
      console.log('settings have been updated');
      this.$data.settings = settings;
    });
    ipcRenderer.on('install-state', (event, name, state) => {
      console.log(`install state changed for ${ name }: ${ state }`);
      this.$data.symlinks[name] = state;
    });
    ipcRenderer.send('install-state', 'kubectl');
    ipcRenderer.send('install-state', 'helm');
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
      if (event.target.value !== this.settings.kubernetes.version) {
        if (semver.lt(event.target.value, this.settings.kubernetes.version)) {
          if (confirm(`Changing from version ${ this.settings.kubernetes.version } to ${ event.target.value } will reset Kubernetes. Do you want to proceed?`)) {
            ipcRenderer.invoke('settings-write', { kubernetes: { version: event.target.value } })
              .then(() => this.reset());
          } else {
            alert('The Kubernetes version was not changed');
          }
        } else if (confirm(`Changing from version ${ this.settings.kubernetes.version } to ${ event.target.value } will upgrade Kubernetes. Do you want to proceed?`)) {
          ipcRenderer.invoke('settings-write', { kubernetes: { version: event.target.value } })
            .then(() => this.restart());
        } else {
          alert('The Kubernetes version was not changed');
        }
      }
    },
    handleCheckbox(value, name) {
      ipcRenderer.send('install-set', name, value);
    },
    handleUpdateMemory(value) {
      this.settings.kubernetes.memoryInGB = value;
      ipcRenderer.invoke('settings-write',
        { kubernetes: { memoryInGB: value } });
    },
    handleUpdateCPU(value) {
      this.settings.kubernetes.numberCPUs = value;
      ipcRenderer.invoke('settings-write',
        { kubernetes: { numberCPUs: value } });
    },
    onRancherModeChanged() {
      ipcRenderer.invoke('settings-write', { kubernetes: { rancherMode: this.$data.settings.kubernetes.rancherMode } });
    },
  },
};
</script>

<style scoped>
.select-k8s-version {
  width: inherit;
  display: inline-block;
}
</style>
