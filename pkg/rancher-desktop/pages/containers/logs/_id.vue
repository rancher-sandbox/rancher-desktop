<template>
  <div class="container-logs">
    <div class="logs-header">
      <div class="header-left">
        <button
          class="btn role-secondary"
          @click="goBack"
        >
          <i class="icon icon-chevron-left" />
          {{ t('containers.logs.back') }}
        </button>
      </div>
      <div class="header-center">
        <h1>{{ t('containers.logs.title') }}</h1>
        <div class="container-info">
          <span class="container-name">{{ containerName }}</span>
          <badge-state
            :color="isContainerRunning ? 'bg-success' : 'bg-darker'"
            :label="containerState"
          />
        </div>
      </div>
      <div class="header-right">
      </div>
    </div>

    <div class="logs-content">
      <div
        v-if="isLoading"
        class="loading-container"
      >
        <loading-indicator>
          {{ t('containers.logs.loading') }}
        </loading-indicator>
      </div>

      <div
        v-else-if="error"
        class="error-container"
      >
        <banner color="error">
          <span class="icon icon-info-circle icon-lg" />
          {{ error }}
        </banner>
      </div>

      <div
        v-else
        class="logs-container"
      >
        <div class="terminal-wrapper">
          <div
            ref="terminalContainer"
            class="terminal-container"
          />
          <div class="search-toolbar">
            <div class="search-widget" :class="{ 'expanded': isSearchExpanded }">
              <button
                class="search-toggle-btn"
                :class="{ 'active': isSearchExpanded, 'role-tertiary': isSearchExpanded }"
                @click="toggleSearch"
                :aria-label="isSearchExpanded ? 'Close search' : 'Open search'"
                :aria-expanded="isSearchExpanded"
                title="Search"
              >
                <i class="icon icon-search" aria-hidden="true" />
              </button>
              <div class="search-bar" v-if="isSearchExpanded">
                <input
                  ref="searchInput"
                  v-model="searchTerm"
                  type="text"
                  class="search-input"
                  placeholder="Search..."
                  aria-label="Search in logs"
                  @input="performSearch"
                  @keydown="handleSearchKeydown"
                />
                <div class="search-controls">
                  <button
                    class="search-btn role-tertiary"
                    @click="searchPrevious"
                    :disabled="!searchTerm"
                    aria-label="Previous match"
                    title="Previous match"
                  >
                    <i class="icon icon-chevron-up" aria-hidden="true" />
                  </button>
                  <button
                    class="search-btn role-tertiary"
                    @click="searchNext"
                    :disabled="!searchTerm"
                    aria-label="Next match"
                    title="Next match"
                  >
                    <i class="icon icon-chevron-down" aria-hidden="true" />
                  </button>
                  <button
                    class="search-close-btn role-tertiary"
                    @click="toggleSearch"
                    aria-label="Close search"
                    title="Close search"
                  >
                    <i class="icon icon-x" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { BadgeState, Banner } from '@rancher/components';
import Vue from 'vue';
import { mapGetters } from 'vuex';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';

import LoadingIndicator from '@pkg/components/LoadingIndicator.vue';
import { ContainerEngine } from '@pkg/config/settings';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

let logInterval = null;

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
      lastLogTimestamp: null,
      pendingLogs: '',
      isSearchExpanded: false,
      searchTerm: '',
    };
  },
  computed: {
    ...mapGetters('k8sManager', { isK8sReady: 'isReady' }),
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

    // Add global keyboard shortcut for search
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
          this.startStreaming();
        }
      }
    },
    async getContainerInfo() {
      try {
        const listOptions = { all: true };

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
    async fetchLogs(follow = false) {
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

        const args = [];

        if (follow) {
          args.push('-f');
        }


        args.push('-t');

        args.push(this.containerId);

        const { stderr, stdout } = await this.ddClient.docker.cli.exec(
          'logs',
          args,
          options
        );

        if (stderr && !stdout) {
          throw new Error(stderr);
        }

        if (follow) {
          if (stdout && this.terminal) {
            this.terminal.write(stdout);
          }
        } else {
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

            const lines = truncatedLogs.trim().split('\n');
            if (lines.length > 0) {
              const lastLine = lines[lines.length - 1];
              const timestampMatch = lastLine.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)/);
              if (timestampMatch) {
                this.lastLogTimestamp = timestampMatch[1];
              }
            }
          } else {
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
    startStreaming() {
      if (!this.isContainerRunning) {
        return;
      }

      logInterval = setInterval(async () => {
        try {
          const options = {
            cwd: '/',
          };

          if (this.isNerdCtl && this.selectedNamespace) {
            options.namespace = this.selectedNamespace;
          }

          const args = [];
          if (this.lastLogTimestamp) {
            args.push('--since', this.lastLogTimestamp);
          } else {
            args.push('--since', '5s'); // Fallback to recent logs
          }
          args.push('-t', this.containerId);

          const { stdout } = await this.ddClient.docker.cli.exec(
            'logs',
            args,
            options
          );

          if (stdout && this.terminal) {
            this.terminal.write(stdout);

            const lines = stdout.trim().split('\n');
            if (lines.length > 0) {
              const lastLine = lines[lines.length - 1];
              const timestampMatch = lastLine.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)/);
              if (timestampMatch) {
                this.lastLogTimestamp = timestampMatch[1];
              }
            }
          }
        } catch (error) {
          console.error('Error streaming logs:', error);
        }
      }, 500);
    },
    stopStreaming() {
      if (logInterval) {
        clearInterval(logInterval);
        logInterval = null;
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

          window.addEventListener('resize', () => {
            if (this.fitAddon) {
              this.fitAddon.fit();
            }
          });
        }
      });
    },
    toggleSearch() {
      this.isSearchExpanded = !this.isSearchExpanded;
      if (this.isSearchExpanded) {
        this.$nextTick(() => {
          if (this.$refs.searchInput) {
            this.$refs.searchInput.focus();
          }
        });
      } else {
        this.searchTerm = '';
        if (this.searchAddon) {
          this.searchAddon.clearDecorations();
        }
      }
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
        this.toggleSearch();
        event.preventDefault();
      }
    },
    handleGlobalKeydown(event) {
      // Ctrl+F or Cmd+F to open search
      if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
        event.preventDefault();
        if (!this.isSearchExpanded) {
          this.toggleSearch();
        }
      }
    },
    goBack() {
      this.$router.push('/Containers');
    },
  },
});
</script>

<style lang="scss" scoped>
@import '@xterm/xterm/css/xterm.css';
.container-logs {
  height: 87vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.logs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 15px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--nav-bg);

  .header-left,
  .header-right {
    flex: 1;
    display: flex;
    gap: 10px;
  }

  .header-right {
    justify-content: flex-end;
  }

  .header-center {
    flex: 2;
    text-align: center;

    h1 {
      margin: 0 0 5px 0;
      font-size: 1.5em;
    }

    .container-info {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;

      .container-name {
        font-family: monospace;
        font-weight: bold;
        color: var(--primary);
      }
    }
  }

  .btn {
    display: flex;
    align-items: center;
    gap: 5px;
  }
}

.logs-content {
  flex: 1;
  padding: 20px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.loading-container,
.error-container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
}

.logs-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.terminal-wrapper {
  flex: 1;
  display: flex;
  min-height: 0;
  gap: 10px;
}

.terminal-container {
  flex: 1;
  border: 1px solid #444;
  border-radius: var(--border-radius);
  background: #1a1a1a;
  overflow: hidden;

  :deep(.xterm) {
    padding: 15px;
  }

  :deep(.xterm-viewport) {
    background: transparent !important;
  }

  :deep(.xterm-screen) {
    background: transparent !important;
  }
}

.search-toolbar {
  display: flex;
  align-items: flex-start;
  padding-top: 15px;

  button {
    &:focus-visible {
      outline: 1px solid var(--primary);
      outline-offset: -1px;
    }
  }
}

.search-widget {
  display: flex;
  align-items: center;
  background: var(--nav-bg);
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);

  &.expanded {
    background: var(--nav-bg);
    border-color: var(--primary);
  }
}

.search-bar {
  display: flex;
  align-items: center;
  background: transparent;
  padding: 0;
}

.search-toggle-btn {
  background: transparent;
  border: none;
  padding: 12px;
  cursor: pointer;
  color: var(--muted);
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;

  .search-widget:not(.expanded) & {
    border-right: none;
  }

  .search-widget.expanded & {
    border-right: 1px solid var(--border);
    padding: 8px 10px;
    min-width: auto;
    min-height: auto;
  }

  &:hover {
    background: var(--primary-hover-bg);
    color: var(--primary-text);
  }

  &.active {
    color: var(--primary);
    background: var(--primary-bg);
  }


  .icon {
    font-size: 16px;

    .search-widget.expanded & {
      font-size: 14px;
    }
  }
}

.search-input {
  border: 1px solid var(--border);
  background: var(--body-bg);
  color: var(--body-text);
  font-size: 13px;
  padding: 8px 12px;
  min-width: 120px;
  font-family: var(--font-family-mono);
  border-radius: 4px;
  margin: 2px;

  &::placeholder {
    color: var(--muted);
  }

  &:focus {
    border-color: var(--primary);
    background: var(--body-bg);
    color: var(--body-text);
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
  border-left: 1px solid var(--border);
  padding: 8px 8px;
  cursor: pointer;
  color: var(--muted);
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  outline: none !important;

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
  border-left: 1px solid var(--border);
  padding: 8px 10px;
  cursor: pointer;
  color: var(--muted);
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background: var(--primary-hover-bg);
    color: var(--primary-text);
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
