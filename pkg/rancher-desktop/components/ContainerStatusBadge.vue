<template>
  <badge-state
    v-if="currentContainer"
    :color="isRunning ? 'bg-success' : 'bg-darker'"
    :label="containerState"
    data-testid="container-state"
  />
</template>

<script>
import { BadgeState } from '@rancher/components';
import { defineComponent } from 'vue';

import { mapTypedState } from '@pkg/entry/store';

export default defineComponent({
  name:       'ContainerStatusBadge',
  components: { BadgeState },
  computed: {
    ...mapTypedState('container-engine', ['containers']),
    containerId() {
      return this.$route.params.id || '';
    },
    currentContainer() {
      if (!this.containers || !this.containerId) {
        return null;
      }
      return this.containers[this.containerId];
    },
    containerState() {
      if (!this.currentContainer) {
        return 'unknown';
      }
      return this.currentContainer.state || this.currentContainer.status || 'unknown';
    },
    isRunning() {
      if (!this.currentContainer) {
        return false;
      }
      return this.currentContainer.state === 'running' || this.currentContainer.status === 'Up';
    },
  },
});
</script>
