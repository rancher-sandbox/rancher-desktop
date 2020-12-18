<template>
  <div class="about">
    <select class="select-k8s-version" :value="settings.kubernetes.version" @change="onChange($event)">
      <option v-for="item in versions" :key="item" :value="item">{{ item }}</option>
    </select> Kubernetes version
    <hr>
    <button @click="reset" :disabled="isDisabled" class="role-destructive btn-sm" :class="{ 'btn-disabled': isDisabled }">Reset Kubernetes</button>
    Resetting Kubernetes to default will delete all workloads and configuration
    <hr>
    <Checkbox :label="'link to /usr/local/bin/kubectl'"
              v-model="symlinks.kubectl"
              @input="handleCheckbox($event, 'kubectl')"
             />
    <hr>
    <Checkbox :label="'link to /usr/local/bin/helm'"
              v-model="symlinks.helm"
              @input="handleCheckbox($event, 'helm')"
    />
    <hr>

  </div>
</template>

<script>
import Checkbox from './Checkbox.vue';

const { ipcRenderer } = window.require('electron');
const fs = window.require('fs');
const K8s = window.require('./src/k8s-engine/k8s.js');
const semver = window.require('semver');
const { exec } = require('child_process');

export default {
  name: 'Kubernetes Settings',
  components: {
    Checkbox
  },
  data() {
    return {
      'state': ipcRenderer.sendSync('k8s-state'),
      'settings': ipcRenderer.sendSync('settings-read'),
      'versions': JSON.parse(fs.readFileSync("./src/generated/versions.json")),
      'symlinks': {
        'helm': this.isLinked('helm'),
        'kubectl': this.isLinked('kubectl'),
      }
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
      const status = event.target.checked;
      const fullSourceName = `./resources/darwin/bin/${name}`
      const fullTargetName = `/usr/local/bin/${name}`
      if (!(name in this.symlinks)) {
        console.error(`No setting for symlink ${name}`)
      } else if (status) {
        if (this.filePresentAndNotSymLink(fullSourceName)) {
          console.log(`Already have /usr/local/bin/${name}`);
        } else {
          this.doCommand(`ln -s ${fullSourceName} ${fullTargetName}`);
        }
      } else if (this.isLinked(name)) {
        const stat = fs.statSync(fullTargetName, { throwIfNoEntry: false})
        if (stat &&
            stat.isSymbolicLink() &&
            fs.readlinkSync(fullTargetName) == fullSourceName) {
          this.doCommand(`rm ${fullTargetName}`);
        } else {
          console.log(`File ${this.fullLocalPath(name)} isn't linked by us`);
        }
      }
    },

    doCommand(cmd) {
      exec(cmd, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error executing ${cmd}: ${error}`)
        }
        if (stdout) {
          console.log(`${cmd} output: ${stdout}`)
        }
        if (stderr) {
          console.log(`${cmd} output: ${stderr}`)
        }
      })
    },

    fullLocalPath(baseName) {
      return `/usr/local/bin/${baseName}`
    },

    isLinked(baseName) {
      const sourcePath = `resources/darwin/bin/${baseName}`
      const stat = fs.statSync(this.fullLocalPath(baseName), { throwIfNoEntry: false});
      if (!stat || !stat.isSymbolicLink()) {
        return false;
      }
      const targetPath = fs.readlinkSync(this.fullLocalPath(baseName));
      return targetPath.indexOf(sourcePath) > -1;
    },

    filePresentAndNotSymLink(path) {
      const stat = fs.statSync(path, { throwIfNoEntry: false })
      if (stat === undefined) {
        return false;
      }
      return stat.isFile() && !stat.isSymbolicLink();
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
