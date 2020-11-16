<template>
  <div class="about">
    <select class="select-k8s-version" :value="settings.kubernetes.version" @change="onChange(settings, $event)">
      <option v-for="item in versions" :key="item" :value="item">{{ item }}</option>
    </select>
    <hr>
    <button @click="reset" :disabled="isResetting" class="role-destructive btn-sm" :class="{ 'btn-disabled': resetting }">Reset Kubernetes</button>
    Resetting Kubernetes to default will delete all workloads and configuration
  </div>
</template>

<script>
const { ipcRenderer } = window.require('electron')
const settings = window.require('./src/config/settings.js')
const fs = window.require('fs')

export default {
  name: 'Kubernetes Settings',
  data() {
    return {
      'resetting': ipcRenderer.sendSync('is-k8s-resetting'),
      'settings': settings.load(),
      'versions': JSON.parse(fs.readFileSync("./src/generated/versions.json"))
    }
  },

  computed: {
    isResetting: function() {
      return this.resetting
    }
  }, 

  methods: {
    // Reset a Kubernetes cluster to default at the same version
    reset() {
      ipcRenderer.send('k8s-reset', 'Reset Kubernetes to default')
      this.resetting = true
    },
    onChange(cfg, event) {
      if (event.target.value != this.settings.kubernetes.version) {
        if (confirm("Changing from version " + cfg.kubernetes.version + " to " + event.target.value + " will reset Kubernetes. Do you want to proceed?")) {
          cfg.kubernetes.version = event.target.value
          settings.save(cfg)
          this.reset()
        } else {
          alert("The Kubernetes version was no changed")
        }
      }
    }
  },

  mounted() {
    ipcRenderer.on('k8s-reset-reply', () => {
      this.resetting = false
    })
  },
}
</script>

<style scoped>
.select-k8s-version {
  width: inherit;
}
</style>
