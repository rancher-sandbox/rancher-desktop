<template>
  <div class="container-logs">

    <div class="container-info" data-testid="container-info">
      <span class="container-name" data-testid="container-name">{{ containerName }}</span>
      <badge-state
          :color="isContainerRunning ? 'bg-success' : 'bg-darker'"
          :label="containerState"
          data-testid="container-state"
      />
    </div>

    <div class="search-widget" data-testid="search-widget">
      <i aria-hidden="true" class="icon icon-search search-icon"/>
      <input
          ref="searchInput"
          v-model="searchTerm"
          aria-label="Search in logs"
          class="search-input"
          data-testid="search-input"
          placeholder="Search logs..."
          type="search"
          @input="performSearch"
          @keydown="handleSearchKeydown"
      />
      <button
          :disabled="!searchTerm"
          aria-label="Previous match"
          class="search-btn role-tertiary"
          data-testid="search-prev-btn"
          title="Previous match"
          @click="searchPrevious"
      >
        <i aria-hidden="true" class="icon icon-chevron-up"/>
      </button>
      <button
          :disabled="!searchTerm"
          aria-label="Next match"
          class="search-btn role-tertiary"
          data-testid="search-next-btn"
          title="Next match"
          @click="searchNext"
      >
        <i aria-hidden="true" class="icon icon-chevron-down"/>
      </button>
      <button
          :disabled="!searchTerm"
          aria-label="Clear search"
          class="search-close-btn role-tertiary"
          data-testid="search-clear-btn"
          title="Clear search"
          @click="clearSearch"
      >
        <i aria-hidden="true" class="icon icon-x"/>
      </button>
    </div>

    <loading-indicator
        v-if="isLoading || waitingForInitialLogs"
        class="content-state"
        data-testid="loading-indicator"
    >
      {{ t('containers.logs.loading') }}
    </loading-indicator>

    <banner
        v-if="error && !waitingForInitialLogs"
        class="content-state"
        color="error"
        data-testid="error-message"
    >
      <span class="icon icon-info-circle icon-lg"/>
      {{ error }}
    </banner>

    <div
        v-if="!isLoading"
        ref="terminalContainer"
        :class="['terminal-container', { 'terminal-hidden': waitingForInitialLogs }]"
        data-testid="terminal"
    />
  </div>
</template>

<script>
import {BadgeState, Banner} from '@rancher/components';
import {defineComponent} from 'vue';
import {mapGetters} from 'vuex';
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import {WebLinksAddon} from '@xterm/addon-web-links';
import {SearchAddon} from '@xterm/addon-search';

import LoadingIndicator from '@pkg/components/LoadingIndicator.vue';
import {ContainerEngine} from '@pkg/config/settings';
import {ipcRenderer} from '@pkg/utils/ipcRenderer';

export default defineComponent({
  name: 'ContainerLogs',
  title: 'Container Logs',
  components: {
    BadgeState,
    Banner,
    LoadingIndicator,
  },
  data() {
    return {
      settings: undefined,
      ddClient: null,
      isLoading: true,
      error: null,
      containerName: '',
      containerState: '',
      isContainerRunning: false,
      terminal: null,
      fitAddon: null,
      searchAddon: null,
      streamProcess: null,
      searchTerm: '',
      resizeHandler: null,
      reconnectAttempts: 0,
      maxReconnectAttempts: 5,
      searchDebounceTimer: null,
      containerCheckInterval: null,
      waitingForInitialLogs: true,
      revealTimeout: null,
      hasReceivedLogs: false,
    };
  },
  computed: {
    ...mapGetters('k8sManager', {isK8sReady: 'isReady'}),
    containerId() {
      const id = this.$route.params.id;
      // Validate container ID format (alphanumeric + hyphens/underscores only)
      if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
        throw new Error('Invalid container ID format');
      }
      return id;
    },
    hasNamespaceSelected() {
      return this.settings?.containerEngine?.name === ContainerEngine.CONTAINERD && this.settings?.containers?.namespace;
    },
  },
  mounted() {
    this.$store.dispatch('page/setHeader', {
      title: this.t('containers.logs.title'),
      description: '',
    });

    ipcRenderer.on('settings-read', this.onSettingsRead);

    ipcRenderer.send('settings-read');
    // Don't call initializeLogs here - wait for settings to load

    window.addEventListener('keydown', this.handleGlobalKeydown);
  },
  beforeDestroy() {
    this.stopStreaming();
    this.stopContainerChecking();
    this.terminal?.dispose();
    ipcRenderer.off('settings-read', this.onSettingsRead);
    window.removeEventListener('keydown', this.handleGlobalKeydown);
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
    }
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    if (this.revealTimeout) {
      clearTimeout(this.revealTimeout);
    }
  },
  methods: {
    async onSettingsRead(event, settings) {
      this.settings = settings;
      await this.initializeLogs();
    },
    async initializeLogs() {
      if (window.ddClient && this.isK8sReady && this.settings) {
        this.ddClient = window.ddClient;
        await this.getContainerInfo();
        await this.startStreaming();
        this.startContainerChecking();
      }
    },
    async getContainerInfo() {
      try {
        const listOptions = {
          all: true,
          filters: `id=${this.containerId}`,
        };

        if (this.hasNamespaceSelected) {
          listOptions.namespace = this.hasNamespaceSelected;
        }

        const containers = await this.ddClient?.docker.listContainers(listOptions);
        const container = containers?.[0];

        if (container) {
          const name = Array.isArray(container.Names) ? container.Names[0] : container.Names.split(/\s+/)?.[0];
          this.containerName = name?.replace(/_[a-z0-9-]{36}_[0-9]+/, '') || container.Id.substring(0, 12);
          this.containerState = container.State || container.Status;
          this.isContainerRunning = container.State === 'running' || container.Status === 'Up';
        } else {
          this.containerName = this.containerId.substring(0, 12);
          this.containerState = 'unknown';
          this.isContainerRunning = false;
        }
      } catch (error) {
        console.error('Error getting container info:', error);
        this.containerName = this.containerId.substring(0, 12);
        this.containerState = 'unknown';
        this.isContainerRunning = false;
      }
    },
    async startStreaming() {
      try {
        this.error = null;
        this.waitingForInitialLogs = true;
        this.hasReceivedLogs = false;

        if (!this.terminal) {
          await this.initializeTerminal();
        }

        const streamOptions = {
          cwd: '/',
          stream: {
            onOutput: (data) => {
              if (this.terminal && (data.stdout || data.stderr)) {
                const output = data.stdout || data.stderr;

                this.hasReceivedLogs = true;

                this.terminal.write(output);

                if (this.waitingForInitialLogs) {
                  if (this.revealTimeout) {
                    clearTimeout(this.revealTimeout);
                  }

                  this.revealTimeout = setTimeout(() => {
                    this.terminal.scrollToBottom();
                    this.waitingForInitialLogs = false;
                  }, 200);
                } else {
                  const buffer = this.terminal.buffer.active;
                  const viewport = this.terminal.rows;
                  const isAtBottom = buffer.viewportY >= buffer.length - viewport;

                  if (isAtBottom) {
                    this.terminal.scrollToBottom();
                  }
                }
              }
            },
            onError: (error) => {
              console.error('Stream error:', error);
              this.handleStreamError(error);
            },
            onClose: (code) => {
              this.streamProcess = null;
              if (code !== 0 && this.isContainerRunning) {
                this.handleStreamError(new Error(`Stream closed with code ${code}`));
              }
            },
            splitOutputLines: false,
          },
        };

        if (this.hasNamespaceSelected) {
          streamOptions.namespace = this.hasNamespaceSelected;
        }

        const streamArgs = ['--follow', '--timestamps', '--tail', '10000', this.containerId];

        this.streamProcess = this.ddClient.docker.cli.exec('logs', streamArgs, streamOptions);

        this.reconnectAttempts = 0;

        setTimeout(() => {
          if (this.waitingForInitialLogs && !this.hasReceivedLogs) {
            this.waitingForInitialLogs = false;
          }
        }, 500);


      } catch (error) {
        console.error('Error starting log stream:', error);

        this.waitingForInitialLogs = false;

        const errorMessages = {
          'No such container': 'Container not found. It may have been removed.',
          'permission denied': 'Permission denied. Check Docker access permissions.',
          'connection refused': 'Cannot connect to Docker. Is Docker running?'
        };

        const errorKey = Object.keys(errorMessages).find(key => error.message.includes(key));
        this.error = errorKey ? errorMessages[errorKey] : (error.message || this.t('containers.logs.fetchError'));

      }
    },
    stopStreaming() {
      if (this.streamProcess) {
        try {
          this.streamProcess.close();
        } catch (error) {
          console.error('Error stopping log stream:', error);
        }
        this.streamProcess = null;
      }
    },
    handleStreamError(error) {
      if (this.reconnectAttempts < this.maxReconnectAttempts && this.isContainerRunning) {
        this.reconnectAttempts++;
        const delay = Math.pow(2, this.reconnectAttempts - 1) * 1000;
        setTimeout(() => {
          this.startStreaming();
        }, delay);
      } else {
        this.error = 'Streaming error: ' + error.message + (this.reconnectAttempts >= this.maxReconnectAttempts ? ' (max retries exceeded)' : '');
      }
    },
    startContainerChecking() {
      this.containerCheckInterval = setInterval(() => {
        this.getContainerInfo();
      }, 30000);
    },
    stopContainerChecking() {
      if (this.containerCheckInterval) {
        clearInterval(this.containerCheckInterval);
        this.containerCheckInterval = null;
      }
    },
    async initializeTerminal() {
      this.isLoading = false;
      await this.$nextTick();
      if (this.$refs.terminalContainer) {
        this.terminal = new Terminal({
          theme: {
            background: '#1a1a1a',
            foreground: '#e0e0e0',
            cursor: '#8be9fd',
            selection: 'rgba(139, 233, 253, 0.3)',
            black: '#000000',
            red: '#ff5555',
            green: '#50fa7b',
            yellow: '#f1fa8c',
            blue: '#8be9fd',
            magenta: '#ff79c6',
            cyan: '#8be9fd',
            white: '#f8f8f2',
            brightBlack: '#6272a4',
            brightRed: '#ff6e6e',
            brightGreen: '#69ff94',
            brightYellow: '#ffffa5',
            brightBlue: '#d6acff',
            brightMagenta: '#ff92df',
            brightCyan: '#a4ffff',
            brightWhite: '#ffffff'
          },
          fontSize: 14,
          fontFamily: '\'Courier New\', \'Monaco\', monospace',
          cursorBlink: false,
          disableStdin: true,
          convertEol: true,
          scrollback: 50000,
          wordWrap: true
        });

        this.fitAddon = new FitAddon();
        this.terminal.loadAddon(this.fitAddon);

        this.searchAddon = new SearchAddon();
        this.terminal.loadAddon(this.searchAddon);

        this.terminal.loadAddon(new WebLinksAddon((event, uri) => {
          event.preventDefault();
          window.open(uri, '_blank');
        }));

        this.terminal.open(this.$refs.terminalContainer);
        this.fitAddon.fit();

        this.terminal.write('\x1b[?25l');

        this.terminal.attachCustomKeyEventHandler((event) => {
          if (event.key === '/') {
            event.preventDefault();
            if (this.$refs.searchInput) {
              this.$refs.searchInput.focus();
              this.$refs.searchInput.select();
            }
            return false;
          }
          return true;
        });

        this.resizeHandler = () => {
          if (this.fitAddon) {
            this.fitAddon.fit();
          }
        };
        window.addEventListener('resize', this.resizeHandler);
      }
    },
    clearSearch() {
      this.searchTerm = '';
      if (this.searchAddon) {
        this.searchAddon.clearDecorations();
      }
      this.$nextTick(() => {
        if (this.$refs.searchInput) {
          this.$refs.searchInput.focus();
        }
      });
    },
    performSearch() {
      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
      }

      this.searchDebounceTimer = setTimeout(() => {
        if (!this.searchAddon) return;

        this.searchAddon.clearDecorations();
        if (this.searchTerm) {
          try {
            this.searchAddon.findNext(this.searchTerm);
          } catch (error) {
            console.error('Search error:', error);
          }
        }
      }, 300);
    },
    searchNext() {
      if (!this.searchAddon || !this.searchTerm) return;
      this.executeSearch(() => this.searchAddon.findNext(this.searchTerm));
    },
    searchPrevious() {
      if (!this.searchAddon || !this.searchTerm) return;
      this.executeSearch(() => this.searchAddon.findPrevious(this.searchTerm));
    },
    executeSearch(searchFn) {
      try {
        searchFn();
      } catch (error) {
        console.error('Search error:', error);
      }
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
@import '@xterm/xterm/css/xterm.css';

.container-logs {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto 1fr;
  grid-template-areas:
    "info search"
    "content content";
  gap: 1rem;
  padding: 1.25rem;
  overflow: hidden;
  min-height: 0;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto 1fr;
    grid-template-areas:
      "info"
      "search"
      "content";
  }
}


.container-info {
  grid-area: info;
  display: flex;
  align-items: center;
  gap: 0.625rem;
  justify-self: start;
  padding-left: 0.625rem;

  .container-name {
    font-family: monospace;
    font-weight: bold;
    color: var(--primary);
  }
}

.content-state {
  grid-area: content;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 2.5rem;
}

.terminal-container {
  grid-area: content;
  border: 1px solid #444;
  border-radius: var(--border-radius);
  background: #1a1a1a;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  opacity: 1;

  &.terminal-hidden {
    opacity: 0;
  }

  :deep(.xterm) {
    padding: 1rem;
    height: 100%;
  }

  :deep(.xterm-selection) {
    overflow: hidden;
  }
}


.search-widget {
  grid-area: search;
  display: flex;
  align-items: center;
  background: var(--nav-bg);
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  overflow: hidden;
  padding: 0 0.25rem;
  justify-self: end;

  button {
    &:focus-visible {
      outline: 1px solid var(--primary);
      outline-offset: -1px;
    }
  }
}

.search-icon {
  color: var(--muted);
  font-size: 14px;
  margin: 0 0.5rem;
}

.search-input {
  border: none;
  background: transparent;
  color: var(--body-text);
  font-size: 13px;
  padding: 0.375rem 0.625rem;
  min-width: 200px;
  font-family: var(--font-family-mono), monospace;
  height: 32px;
  outline: none;

  &::placeholder {
    color: var(--muted);
  }

  &:focus {
    background: var(--body-bg);
  }
}


.search-btn,
.search-close-btn {
  background: transparent;
  border: none;
  padding: 0.375rem 0.5rem;
  cursor: pointer;
  color: var(--muted);
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 32px;

  &:hover:not(:disabled) {
    background: var(--primary-hover-bg);
    color: var(--primary-text);
  }

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  &:focus,
  &:active,
  &:focus-visible {
    box-shadow: none !important;
  }

  .icon {
    font-size: 12px;
  }
}

.search-btn {
  &:first-child {
    border-left: 1px solid var(--border);
  }
}
</style>
