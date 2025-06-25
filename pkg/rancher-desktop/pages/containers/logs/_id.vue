<template>
  <div class="container-logs">
    <h1 class="title">{{ t('containers.logs.title') }}</h1>

    <div class="container-info">
      <span class="container-name">{{ containerName }}</span>
      <badge-state
        :color="isContainerRunning ? 'bg-success' : 'bg-darker'"
        :label="containerState"
      />
    </div>

    <div class="search-widget">
      <i aria-hidden="true" class="icon icon-search search-icon"/>
      <input
        ref="searchInput"
        v-model="searchTerm"
        aria-label="Search in logs"
        class="search-input"
        placeholder="Search logs..."
        type="text"
        @input="performSearch"
        @keydown="handleSearchKeydown"
      />
      <button
        :disabled="!searchTerm"
        aria-label="Previous match"
        class="search-btn role-tertiary"
        title="Previous match"
        @click="searchPrevious"
      >
        <i aria-hidden="true" class="icon icon-chevron-up"/>
      </button>
      <button
        :disabled="!searchTerm"
        aria-label="Next match"
        class="search-btn role-tertiary"
        title="Next match"
        @click="searchNext"
      >
        <i aria-hidden="true" class="icon icon-chevron-down"/>
      </button>
      <button
        :disabled="!searchTerm"
        aria-label="Clear search"
        class="search-close-btn role-tertiary"
        title="Clear search"
        @click="clearSearch"
      >
        <i aria-hidden="true" class="icon icon-x"/>
      </button>
    </div>

    <loading-indicator
      v-if="isLoading"
      class="content-state"
    >
      {{ t('containers.logs.loading') }}
    </loading-indicator>

    <banner
      v-else-if="error"
      class="content-state"
      color="error"
    >
      <span class="icon icon-info-circle icon-lg"/>
      {{ error }}
    </banner>

    <div
      v-else
      ref="terminalContainer"
      class="terminal-container"
    />
  </div>
</template>

<script>
import {BadgeState, Banner} from '@rancher/components';
import Vue from 'vue';
import {mapGetters} from 'vuex';
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import {WebLinksAddon} from '@xterm/addon-web-links';
import {SearchAddon} from '@xterm/addon-search';

import LoadingIndicator from '@pkg/components/LoadingIndicator.vue';
import {ContainerEngine} from '@pkg/config/settings';
import {ipcRenderer} from '@pkg/utils/ipcRenderer';

export default Vue.extend({
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
      pendingLogs: '',
      searchTerm: '',
    };
  },
  computed: {
    ...mapGetters('k8sManager', {isK8sReady: 'isReady'}),
    containerId() {
      return this.$route.params.id;
    },
    isNerdCtl() {
      return this.settings?.containerEngine?.name === ContainerEngine.CONTAINERD;
    },
    selectedNamespace() {
      return this.settings?.containers?.namespace;
    },
  },
  async mounted() {
    this.$store.dispatch('page/setHeader', {
      title: this.t('containers.logs.title'),
      description: '',
    });

    ipcRenderer.on('settings-read', (event, settings) => {
      this.settings = settings;
      this.initializeLogs();
    });

    ipcRenderer.send('settings-read');
    this.initializeLogs();

    window.addEventListener('keydown', this.handleGlobalKeydown);
  },
  beforeDestroy() {
    this.stopStreaming();
    if (this.terminal) {
      this.terminal.dispose();
    }
    ipcRenderer.removeAllListeners('settings-read');
    window.removeEventListener('keydown', this.handleGlobalKeydown);
  },
  methods: {
    async initializeLogs() {
      if (window.ddClient && this.isK8sReady && this.settings) {
        this.ddClient = window.ddClient;
        await this.getContainerInfo();
        await this.fetchLogs();

        if (this.isContainerRunning) {
          await this.startStreaming();
        }
      }
    },
    async getContainerInfo() {
      try {
        const listOptions = {all: true};

        if (this.isNerdCtl && this.selectedNamespace) {
          listOptions.namespace = this.selectedNamespace;
        }

        const containers = await this.ddClient?.docker.listContainers(listOptions);

        const container = containers.find(c => c.Id === this.containerId || c.Id.startsWith(this.containerId));

        if (container) {
          const names = Array.isArray(container.Names) ? container.Names : container.Names.split(/\s+/);
          this.containerName = names[0]?.replace(/_[a-z0-9-]{36}_[0-9]+/, '') || container.Id.substring(0, 12);
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
    async fetchLogs() {
      try {
        this.isLoading = true;
        this.error = null;

        const options = {
          cwd: '/',
        };

        // Only add namespace for containerd/nerdctl, not Docker
        if (this.isNerdCtl && this.selectedNamespace) {
          options.namespace = this.selectedNamespace;
        }

        const args = ['--timestamps', this.containerId];

        const {stderr, stdout} = await this.ddClient.docker.cli.exec(
          'logs',
          args,
          options
        );

        if (stderr && !stdout) {
          throw new Error(stderr);
        }

        if (stdout) {
          let truncatedLogs = stdout;
          if (stdout.length > 1000000) {
            const truncatePoint = stdout.length - 1000000;
            const newlineIndex = stdout.indexOf('\n', truncatePoint);
            if (newlineIndex !== -1) {
              truncatedLogs = stdout.substring(newlineIndex + 1);
            }
          }

          if (this.terminal) {
            this.terminal.write(truncatedLogs);
          } else {
            this.pendingLogs = truncatedLogs;
          }
        }
      } catch (error) {
        console.error('Error fetching logs:', error);
        this.error = error.message || this.t('containers.logs.fetchError');
      } finally {
        this.isLoading = false;
        if (!this.terminal) {
          this.initializeTerminal();
        }
      }
    },
    async startStreaming() {
      if (!this.isContainerRunning) {
        return;
      }

      try {
        const options = {
          cwd: '/',
          stream: {
            onOutput: (data) => {
              if (this.terminal && (data.stdout || data.stderr)) {
                const output = data.stdout || data.stderr;
                this.terminal.write(output);
              }
            },
            onError: (error) => {
              console.error('Stream error:', error);
              this.error = 'Streaming error: ' + error.message;
            },
            onClose: (code) => {
              console.log('Stream closed with code:', code);
              this.streamProcess = null;
            },
            splitOutputLines: false,
          },
        };

        if (this.isNerdCtl && this.selectedNamespace) {
          options.namespace = this.selectedNamespace;
        }

        const args = ['--follow', '--timestamps', this.containerId];

        // Start true streaming with docker logs --follow
        this.streamProcess = this.ddClient.docker.cli.exec('logs', args, options);

        console.log('Started streaming logs for container:', this.containerId);

      } catch (error) {
        console.error('Error starting log stream:', error);
        this.error = 'Failed to start log streaming: ' + error.message;
      }
    },
    stopStreaming() {
      if (this.streamProcess) {
        try {
          console.log('Stopping log stream...');
          this.streamProcess.close();
        } catch (error) {
          console.error('Error stopping log stream:', error);
        }
        this.streamProcess = null;
      }
    },
    initializeTerminal() {
      this.$nextTick(() => {
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
            fontSize: 12,
            fontFamily: '\'Courier New\', \'Monaco\', monospace',
            cursorBlink: false,
            disableStdin: true,
            convertEol: true,
            scrollback: 10000,
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

          if (this.pendingLogs) {
            this.terminal.write(this.pendingLogs);
            this.pendingLogs = '';
          }
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

          window.addEventListener('resize', () => {
            if (this.fitAddon) {
              this.fitAddon.fit();
            }
          });
        }
      });
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
      if (!this.searchAddon || !this.searchTerm) {
        if (this.searchAddon) {
          this.searchAddon.clearDecorations();
        }
        return;
      }

      try {
        this.searchAddon.clearDecorations();

        this.searchAddon.findNext(this.searchTerm);
      } catch (error) {
        console.error('Search error:', error);
      }
    },
    searchNext() {
      if (!this.searchAddon || !this.searchTerm) return;
      try {
        this.searchAddon.findNext(this.searchTerm);
      } catch (error) {
        console.error('Search next error:', error);
      }
    },
    searchPrevious() {
      if (!this.searchAddon || !this.searchTerm) return;
      try {
        this.searchAddon.findPrevious(this.searchTerm);
      } catch (error) {
        console.error('Search previous error:', error);
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

:global(.body) {
  display: flex !important;
  flex-direction: column !important;

  > div {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
}

.container-logs {
  flex: 1;
  display: grid;
  grid-template-columns: auto 1fr auto;
  grid-template-rows: auto 1fr;
  grid-template-areas:
    "title info search"
    "content content content";
  gap: 15px;
  padding: 20px;
  overflow: hidden;
  min-height: 0;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto 1fr;
    grid-template-areas:
      "title"
      "info"
      "search"
      "content";
  }
}

.title {
  grid-area: title;
  align-self: center;
  margin: 0;
  font-size: 1.5em;
  white-space: nowrap;
}

.container-info {
  grid-area: info;
  display: flex;
  align-items: center;
  gap: 10px;
  justify-self: center;

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
  padding: 40px;
}

.terminal-container {
  grid-area: content;
  border: 1px solid #444;
  border-radius: var(--border-radius);
  background: #1a1a1a;
  overflow: hidden;
  display: flex;
  flex-direction: column;

  :deep(.xterm) {
    padding: 15px;
    height: 100%;
  }

  :deep(.xterm-viewport) {
    background: transparent !important;
  }

  :deep(.xterm-screen) {
    background: transparent !important;
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
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  padding: 0 4px;
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
  margin: 0 8px;
}

.search-input {
  border: none;
  background: transparent;
  color: var(--body-text);
  font-size: 13px;
  padding: 6px 10px;
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


.search-controls {
  display: flex;
  align-items: center;
  gap: 0;
}

.search-btn {
  background: transparent;
  border: none;
  padding: 6px 8px;
  cursor: pointer;
  color: var(--muted);
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  outline: none !important;
  height: 32px;

  &:first-child {
    border-left: 1px solid var(--border);
  }

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

.search-close-btn {
  background: transparent;
  border: none;
  padding: 6px 8px;
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
</style>
