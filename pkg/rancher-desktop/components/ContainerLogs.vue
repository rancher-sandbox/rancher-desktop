<template>
  <div class="container-logs-component">
    <loading-indicator
      v-if="isLoading || waitingForInitialLogs"
      class="content-state"
      data-testid="loading-indicator"
    >
      Loading logs...
    </loading-indicator>

    <banner
      v-if="error && !waitingForInitialLogs"
      class="content-state"
      color="error"
      data-testid="error-message"
    >
      <span class="icon icon-info-circle icon-lg" />
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
import { Banner } from '@rancher/components';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { shell } from 'electron';
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
            cursor:        '#1a1a1a', // same as the background to effectively hide the cursor.
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
          shell.openExternal(uri);
        }));

        this.terminal.open(this.$refs.terminalContainer);

        // Expose terminal instance for e2e testing
        this.$refs.terminalContainer.__xtermTerminal = this.terminal;

        await this.$nextTick();
        this.fitAddon.fit();

        this.resizeHandler = () => {
          this.fitAddon?.fit();
        };
        window.addEventListener('resize', this.resizeHandler);

        if (window.ResizeObserver) {
          this.resizeObserver = new ResizeObserver(() => {
            this.fitAddon?.fit();
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
                      this.fitAddon?.fit();
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
      this.searchAddon?.clearDecorations();
    },
    performSearch(searchTerm) {
      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
      }

      this.searchDebounceTimer = setTimeout(() => {
        if (!this.searchAddon) return;

        this.searchAddon.clearDecorations();
        if (searchTerm) {
          try {
            this.searchAddon.findNext(searchTerm);
          } catch (error) {
            console.error('Search error:', error);
          }
        }
      }, 300);
    },
    searchNext(searchTerm) {
      if (!this.searchAddon || !searchTerm) return;
      this.executeSearch(() => this.searchAddon.findNext(searchTerm));
    },
    searchPrevious(searchTerm) {
      if (!this.searchAddon || !searchTerm) return;
      this.executeSearch(() => this.searchAddon.findPrevious(searchTerm));
    },
    executeSearch(searchFn) {
      try {
        searchFn();
      } catch (error) {
        console.error('Search error:', error);
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
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  flex: 1;
}

.content-state {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 2.5rem;
}

.terminal-container {
  background: #1a1a1a;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;

  &.terminal-hidden {
    visibility: hidden;
  }

  :deep(.xterm) {
    height: 100%;
  }

  :deep(.xterm-selection) {
    overflow: hidden;
  }
}
</style>
