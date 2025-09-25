<template>
  <div class="container-info-page">
    <div class="header">
      <h1 class="title">{{ containerName || containerId }}</h1>
      <badge-state
        :color="isRunning ? 'bg-success' : 'bg-darker'"
        :label="containerState"
      />
    </div>

    <div class="tabs-container">
      <div class="tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          :class="['tab', 'role-tertiary', { active: activeTab === tab.id }]"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="tab-content">
        <div
          v-show="activeTab === 'logs'"
          class="tab-panel"
        >
          <container-logs
            v-if="containerId"
            :container-id="containerId"
            :is-container-running="isRunning"
            :namespace="settings?.containers?.namespace"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { BadgeState } from '@rancher/components';
import { defineComponent } from 'vue';
import { mapGetters } from 'vuex';

import ContainerLogs from '@pkg/components/ContainerLogs.vue';
import { mapTypedState } from '@pkg/entry/store';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default defineComponent({
  name:       'ContainerInfo',
  components: { BadgeState, ContainerLogs },
  data() {
    return {
      activeTab:      'logs',
      settings:       undefined,
      subscribeTimer: undefined,
      tabs:           [
        { id: 'logs', label: 'Logs' },
      ],
    };
  },
  computed: {
    ...mapGetters('k8sManager', { isK8sReady: 'isReady' }),
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
    containerName() {
      if (!this.currentContainer) {
        return this.containerId.substring(0, 12);
      }
      const names = this.currentContainer.names || this.currentContainer.containerName;
      if (Array.isArray(names)) {
        return names[0]?.replace(/^\//, '').replace(/_[a-z0-9-]{36}_[0-9]+/, '') || this.containerId.substring(0, 12);
      }
      if (typeof names === 'string') {
        return names.replace(/^\//, '').replace(/_[a-z0-9-]{36}_[0-9]+/, '') || this.containerId.substring(0, 12);
      }
      return this.containerId.substring(0, 12);
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
  mounted() {
    this.$store.dispatch('page/setHeader', {
      title:       'Container Info',
      description: '',
    });

    ipcRenderer.on('settings-read', (event, settings) => {
      this.settings = settings;
      this.subscribe().catch(console.error);
    });

    ipcRenderer.send('settings-read');

    ipcRenderer.on('settings-update', (_event, settings) => {
      this.settings = settings;
    });

    this.subscribe().catch(console.error);
  },
  beforeUnmount() {
    ipcRenderer.removeAllListeners('settings-update');
    ipcRenderer.removeAllListeners('settings-read');
    this.$store.dispatch('container-engine/unsubscribe').catch(console.error);
    clearTimeout(this.subscribeTimer);
  },
  methods: {
    async subscribe() {
      clearTimeout(this.subscribeTimer);
      try {
        if (!window.ddClient || !this.isK8sReady || !this.settings) {
          this.subscribeTimer = setTimeout(() => this.subscribe(), 1_000);
          return;
        }
        await this.$store.dispatch('container-engine/subscribe', {
          type:   'containers',
          client: window.ddClient,
        });
      } catch (error) {
        console.error('There was a problem subscribing to container events:', { error });
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.container-info-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 1.25rem;
  overflow: hidden;
  min-height: 0;
}

.header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border);
  margin-bottom: 1rem;

  .title {
    flex: 1;
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--body-text);
  }
}

.tabs-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.tabs {
  display: flex;
  gap: 0.25rem;
  padding: 0.5rem;
  background: var(--nav-bg);
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  margin-bottom: 1rem;

  .tab {
    padding: 0.75rem 1.5rem;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--border-radius);
    cursor: pointer;
    color: var(--muted);
    font-size: 0.875rem;
    font-weight: 500;
    transition: all 0.2s;
    line-height: normal;
    min-height: auto;

    &:hover {
      background: var(--dropdown-hover-bg);
      color: var(--body-text);
      border-color: transparent;
    }

    &.active {
      background: var(--primary);
      color: white;
      border-color: var(--primary);

      &:hover {
        background: var(--primary-hover);
        border-color: var(--primary-hover);
      }
    }

    &:focus {
      outline: none;
      box-shadow: 0 0 0 var(--outline-width) var(--outline);
    }
  }
}

.tab-content {
  flex: 1;
  min-height: 0;
  background: var(--nav-bg);
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  overflow: hidden;
}

.tab-panel {
  height: 100%;
  padding: 1rem;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
