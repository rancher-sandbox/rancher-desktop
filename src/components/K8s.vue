<template>
  <div class="about">
    <select class="select-k8s-version" :value="settings.kubernetes.version" @change="onChange(settings, $event)">
      <option v-for="item in versions" :key="item" :value="item">{{ item }}</option>
    </select> Kubernetes version
    <hr>
    <button @click="reset" :disabled="isDisabled" class="role-destructive btn-sm" :class="{ 'btn-disabled': isDisabled }">Reset Kubernetes</button>
    Resetting Kubernetes to default will delete all workloads and configuration
  </div>
</template>

<script>
const { ipcRenderer } = window.require('electron');
const settings = window.require('./src/config/settings.js');
const fs = window.require('fs');
const K8s = window.require('./src/k8s-engine/k8s.js');
const semver = window.require('semver');

export default {
  name: 'Kubernetes Settings',
  data() {
    return {
      'state': ipcRenderer.sendSync('k8s-state'),
      'settings': settings.load(),
      'versions': JSON.parse(fs.readFileSync("./src/generated/versions.json"))
    }
  },

  computed: {
    isDisabled: function() {
      if (this.state != K8s.State.STARTED) {
            return true;
      }
      return false;
    }
  }, 

  methods: {
    // Reset a Kubernetes cluster to default at the same version
    reset() {
      ipcRenderer.send('k8s-reset', 'Reset Kubernetes to default');
      this.state = K8s.State.STOPPING;
    },
    restart() {
      ipcRenderer.send('k8s-restart', 'Restart Kubernetes');
      this.state = K8s.State.STOPPING;
    },
    onChange(cfg, event) {
      if (event.target.value != this.settings.kubernetes.version) {
        if (semver.lt(event.target.value, cfg.kubernetes.version)){
          if (confirm("Changing from version " + cfg.kubernetes.version + " to " + event.target.value + " will reset Kubernetes. Do you want to proceed?")) {
            cfg.kubernetes.version = event.target.value;
            settings.save(cfg);
            this.reset();
          } else {
            alert("The Kubernetes version was not changed");
          }
        } else {
          if (confirm("Changing from version " + cfg.kubernetes.version + " to " + event.target.value + " will upgrade Kubernetes. Do you want to proceed?")) {
            cfg.kubernetes.version = event.target.value;
            settings.save(cfg, true);
            this.restart();
          } else {
            alert("The Kubernetes version was not changed");
          }
        }
      }
    }
  },

  mounted: function() {
    let that = this;
    ipcRenderer.on('k8s-check-state', function(event, stt) {
      that.$data.state = stt;
    })

    if (this.state != K8s.State.STARTED) {
      let tmr = setInterval(() => {
        let stt = ipcRenderer.sendSync('k8s-state');
        if (stt === K8s.State.STARTED) {
          this.state = stt;
          clearInterval(tmr);
        }
      }, 5000)
    }
  },
}
</script>

<style scoped>
.select-k8s-version {
  width: inherit;
  display: inline-block;
}
</style>
