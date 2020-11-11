<template>
  <div class="about">
    <button @click="reset" :disabled="isResetting" class="role-destructive btn-sm" :class="{ 'btn-disabled': resetting }">Reset Kubernetes</button>
    Resetting Kubernetes to default will delete all workloads and configuration
  </div>
</template>

<script>
const { ipcRenderer } = window.require('electron')

export default {
  name: 'Kubernetes Settings',
  data() {
    return {'resetting': ipcRenderer.sendSync('is-k8s-resetting'),}
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
</style>
