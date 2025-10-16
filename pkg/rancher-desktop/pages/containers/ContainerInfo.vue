<template>
  <div
    class="container-info-page"
    data-testid="container-info"
  >
    <div class="tab-header-row">
      <ul class="tabs">
        <li
          class="tab active"
          data-testid="tab-logs"
        >
          <a>
            <span>Logs</span>
          </a>
        </li>
      </ul>
      <div class="search-widget">
        <input
          ref="searchInput"
          v-model="searchTerm"
          aria-label="Search in logs"
          class="search-input"
          data-testid="search-input"
          placeholder="Search logs..."
          type="search"
          @input="onSearchInput"
          @keydown="handleSearchKeydown"
        >
        <button
          :disabled="!searchTerm"
          aria-label="Previous match"
          class="search-btn btn role-tertiary"
          data-testid="search-prev-btn"
          title="Previous match"
          @click="searchPrevious"
        >
          <i
            aria-hidden="true"
            class="icon icon-chevron-up"
          />
        </button>
        <button
          :disabled="!searchTerm"
          aria-label="Next match"
          class="search-btn btn role-tertiary"
          data-testid="search-next-btn"
          title="Next match"
          @click="searchNext"
        >
          <i
            aria-hidden="true"
            class="icon icon-chevron-down"
          />
        </button>
        <button
          :disabled="!searchTerm"
          aria-label="Clear search"
          class="search-btn btn role-tertiary"
          data-testid="search-clear-btn"
          title="Clear search"
          @click="clearSearch"
        >
          <i
            aria-hidden="true"
            class="icon icon-x"
          />
        </button>
      </div>
    </div>
    <div class="tab-content">
      <container-logs
        v-if="containerId"
        ref="containerLogs"
        :container-id="containerId"
        :is-container-running="isRunning"
        :namespace="settings?.containers?.namespace"
      />
    </div>
  </div>
</template>

<script>
import { defineComponent } from 'vue';
import { mapGetters } from 'vuex';

import ContainerLogs from '@pkg/components/ContainerLogs.vue';
import { mapTypedState } from '@pkg/entry/store';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default defineComponent({
  name:       'ContainerInfo',
  components: {
    ContainerLogs,
  },
  data() {
    return {
      activeTab:      'logs',
      settings:       undefined,
      subscribeTimer: undefined,
      searchTerm:     '',
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
  watch: {
    containerName: {
      handler(name) {
        this.$store.dispatch('page/setHeader', {
          title:       name || 'Container Info',
          description: '',
          action:      'ContainerStatusBadge',
        });
      },
      immediate: true,
    },
  },
  mounted() {
    ipcRenderer.on('settings-read', (event, settings) => {
      this.settings = settings;
      this.subscribe().catch(console.error);
    });

    ipcRenderer.send('settings-read');

    ipcRenderer.on('settings-update', (_event, settings) => {
      this.settings = settings;
    });

    this.subscribe().catch(console.error);

    window.addEventListener('keydown', this.handleGlobalKeydown);
  },
  beforeUnmount() {
    this.$store.dispatch('page/setHeader', { action: null });
    ipcRenderer.removeAllListeners('settings-update');
    ipcRenderer.removeAllListeners('settings-read');
    this.$store.dispatch('container-engine/unsubscribe').catch(console.error);
    clearTimeout(this.subscribeTimer);
    window.removeEventListener('keydown', this.handleGlobalKeydown);
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
    onSearchInput() {
      if (this.$refs.containerLogs) {
        this.$refs.containerLogs.performSearch(this.searchTerm);
      }
    },
    searchNext() {
      if (this.$refs.containerLogs) {
        this.$refs.containerLogs.searchNext(this.searchTerm);
      }
    },
    searchPrevious() {
      if (this.$refs.containerLogs) {
        this.$refs.containerLogs.searchPrevious(this.searchTerm);
      }
    },
    clearSearch() {
      this.searchTerm = '';
      if (this.$refs.containerLogs) {
        this.$refs.containerLogs.clearSearch();
      }
      this.$nextTick(() => {
        if (this.$refs.searchInput) {
          this.$refs.searchInput.focus();
        }
      });
    },
    handleSearchKeydown(event) {
      if (event.key === 'Enter') {
        if (event.shiftKey) {
          this.searchPrevious();
        } else {
          this.searchNext();
        }
        event.preventDefault();
      } else if (event.key === 'Escape') {
        this.clearSearch();
        event.preventDefault();
      }
    },
    handleGlobalKeydown(event) {
      if (event.key === '/') {
        event.preventDefault();
        if (this.$refs.searchInput) {
          this.$refs.searchInput.focus();
          this.$refs.searchInput.select();
        }
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
  overflow: hidden;
  min-height: 0;
}

.tab-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.tabs {
  list-style-type: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: row;
  align-items: center;
  flex: 1;
  min-width: 0;

  .tab {
    position: relative;
    cursor: pointer;
    margin-bottom: -1px;
    border-bottom: 2px solid transparent;

    a {
      display: flex;
      align-items: center;
      padding: 10px 15px;
      color: var(--body-text);
      text-decoration: none;

      &:hover {
        color: var(--link);
        text-decoration: none;

        span {
          text-decoration: none;
        }
      }
    }

    &.active {
      border-bottom-color: var(--primary);

      > a {
        color: var(--link);
        text-decoration: none;
      }
    }
  }
}

.search-widget {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
  flex-shrink: 0;
}

.search-input {
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  background: var(--input-bg);
  color: var(--body-text);
  font-size: 13px;
  padding: 0 0.75rem;
  min-width: 200px;
  height: 32px;
  transition: border-color 0.2s ease;

  &::placeholder {
    color: var(--muted);
  }

  &:focus {
    border-color: var(--primary);
    outline: none;
  }
}

.search-btn {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  padding: 0;
  cursor: pointer;
  color: var(--body-text);
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  min-height: 32px;

  &:hover:not(:disabled) {
    background: var(--primary);
    border-color: var(--primary);
    color: var(--primary-text);
  }

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: -2px;
  }

  .icon {
    font-size: 12px;
  }
}

.tab-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

:deep(.container-logs-component) {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>
