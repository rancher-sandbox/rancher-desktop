<template>
  <div class="container-logs-component">
    <div class="search-widget">
      <i
        aria-hidden="true"
        class="icon icon-search search-icon"
      />
      <input
        ref="searchInput"
        v-model="searchTerm"
        aria-label="Search in logs"
        class="search-input"
        placeholder="Search logs..."
        type="search"
        @input="performSearch"
        @keydown="handleSearchKeydown"
      >
      <button
        :disabled="!searchTerm"
        aria-label="Previous match"
        class="search-btn role-tertiary"
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
        class="search-btn role-tertiary"
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
        class="search-close-btn role-tertiary"
        title="Clear search"
        @click="clearSearch"
      >
        <i
          aria-hidden="true"
          class="icon icon-x"
        />
      </button>
    </div>

    <loading-indicator
      v-if="isLoading || waitingForInitialLogs"
      class="content-state"
    >
      Loading logs...
    </loading-indicator>

    <banner
      v-if="error && !waitingForInitialLogs"
      class="content-state"
      color="error"
    >
      <span class="icon icon-info-circle icon-lg" />
      {{ error }}
    </banner>

    <div
      v-if="!isLoading"
      ref="terminalContainer"
      :class="['terminal-container', { 'terminal-hidden': waitingForInitialLogs }]"
    />
  </div>
</template>

<script>
import { Banner } from '@rancher/components';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { defineComponent } from 'vue';

import LoadingIndicator from '@pkg/components/LoadingIndicator.vue';

export default defineComponent({
  name:       'ContainerLogs',
  components: {
    Banner,
    LoadingIndicator,
  },
  props: {
    containerId: {
      type:     String,
      required: true,
    },
    isContainerRunning: {
      type:     Boolean,
      default:  false,
    },
    namespace: {
      type:    String,
      default: null,
    },
  },
  data() {
    return {
      isLoading:              true,
      error:                  null,
      terminal:               null,
      fitAddon:               null,
      searchAddon:            null,
      streamProcess:          null,
      searchTerm:             '',
      resizeHandler:          null,
      resizeObserver:         null,
      reconnectAttempts:      0,
      maxReconnectAttempts:   5,
      searchDebounceTimer:    null,
      waitingForInitialLogs:  true,
      revealTimeout:          null,
      hasReceivedLogs:        false,
    };
  },
  mounted() {
    this.initializeLogs();
    window.addEventListener('keydown', this.handleGlobalKeydown);
  },
  watch: {
    containerId: {
      handler() {
        if (this.terminal) {
          this.cleanup();
        }
        this.initializeLogs();
      },
    },
  },
  beforeUnmount() {
    this.cleanup();
    window.removeEventListener('keydown', this.handleGlobalKeydown);
  },
  methods: {
    async initializeLogs() {
      if (window.ddClient) {
        await this.startStreaming();
      }
    },
    async initializeTerminal() {
      this.isLoading = false;
      await this.$nextTick();
      if (this.$refs.terminalContainer) {
        this.terminal = new Terminal({
          theme: {
            background:    '#1a1a1a',
            foreground:    '#e0e0e0',
            cursor:        '#8be9fd',
            selection:     'rgba(139, 233, 253, 0.3)',
            black:         '#000000',
            red:           '#ff5555',
            green:         '#50fa7b',
            yellow:        '#f1fa8c',
            blue:          '#8be9fd',
            magenta:       '#ff79c6',
            cyan:          '#8be9fd',
            white:         '#f8f8f2',
            brightBlack:   '#6272a4',
            brightRed:     '#ff6e6e',
            brightGreen:   '#69ff94',
            brightYellow:  '#ffffa5',
            brightBlue:    '#d6acff',
            brightMagenta: '#ff92df',
            brightCyan:    '#a4ffff',
            brightWhite:   '#ffffff',
          },
          fontSize:     14,
          fontFamily:   '\'Courier New\', \'Monaco\', monospace',
          cursorBlink:  false,
          disableStdin: true,
          convertEol:   true,
          scrollback:   50000,
          wordWrap:     true,
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

        await this.$nextTick(() => {
          this.fitAddon.fit();
        });

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

        if (window.ResizeObserver) {
          this.resizeObserver = new ResizeObserver(() => {
            if (this.fitAddon) {
              this.fitAddon.fit();
            }
          });
          this.resizeObserver.observe(this.$refs.terminalContainer);
        }
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
          cwd:    '/',
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
                    this.waitingForInitialLogs = false;
                    this.$nextTick(() => {
                      if (this.fitAddon) {
                        this.fitAddon.fit();
                      }
                      this.terminal.scrollToBottom();
                    });
                  }, 200);
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
                this.handleStreamError(new Error(`Stream closed with code ${ code }`));
              }
            },
            splitOutputLines: false,
          },
        };

        if (this.namespace) {
          streamOptions.namespace = this.namespace;
        }

        const streamArgs = ['--follow', '--timestamps', '--tail', '10000', this.containerId];
        this.streamProcess = window.ddClient.docker.cli.exec('logs', streamArgs, streamOptions);
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
          'No such container':  'Container not found. It may have been removed.',
          'permission denied':  'Permission denied. Check Docker access permissions.',
          'connection refused': 'Cannot connect to Docker. Is Docker running?',
        };

        const errorKey = Object.keys(errorMessages).find(key => error.message.includes(key));
        this.error = errorKey ? errorMessages[errorKey] : (error.message || 'Failed to fetch logs');
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
    cleanup() {
      this.stopStreaming();
      if (this.terminal) {
        try {
          if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
          }
          if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
          }
          if (this.searchAddon) {
            this.searchAddon.clearDecorations();
            this.searchAddon = null;
          }
          if (this.fitAddon) {
            this.fitAddon = null;
          }
          this.terminal.dispose();
          this.terminal = null;
        } catch (error) {
          console.error('Error disposing terminal:', error);
        }
      }
      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
      }
      if (this.revealTimeout) {
        clearTimeout(this.revealTimeout);
      }
    },
  },
});
</script>

<style lang="scss" scoped>
@import '@xterm/xterm/css/xterm.css';

.container-logs-component {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: auto 1fr;
  height: 100%;
  gap: 1rem;
  min-height: 0;
  overflow: hidden;
}

.search-widget {
  display: flex;
  align-items: center;
  background: var(--nav-bg);
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  overflow: hidden;
  padding: 0 0.25rem;
  align-self: flex-end;
  width: fit-content;
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
  min-height: auto;
  line-height: normal;

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

.content-state {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 2.5rem;
}

.terminal-container {
  border: 1px solid #444;
  border-radius: var(--border-radius);
  background: #1a1a1a;
  overflow: hidden;
  display: flex;
  flex-direction: column;

  &.terminal-hidden {
    visibility: hidden;
  }

  :deep(.xterm) {
    padding: 1rem;
    height: 100%;
  }

  :deep(.xterm-selection) {
    overflow: hidden;
  }
}
</style>
