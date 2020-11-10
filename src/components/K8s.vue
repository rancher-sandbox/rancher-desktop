<template>
  <div class="about">
    <p>
      K8s Settings...
      <button @click="reset" :disabled="isResetting" class="role-primary" :class="{ 'btn-disabled': resetting }">Reset Kubernetes</button>

    </p>
  </div>
</template>

<script>
const { ipcRenderer } = window.require('electron')

export default {
  name: 'Kubernetes Settings',
  data() {
    return {'resetting': false,}
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
