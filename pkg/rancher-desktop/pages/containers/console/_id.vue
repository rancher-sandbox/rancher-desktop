<template>
  <div class="container-console">
    <div class="console-header">
      <div class="header-left">
        <button
          class="btn role-secondary"
          @click="goBack"
        >
          <i class="icon icon-chevron-left" />
          {{ t('containers.console.back') }}
        </button>
      </div>
      <div class="header-center">
        <h1>{{ t('containers.console.title') }}</h1>
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

    <div class="console-content">
      <div
        v-if="isLoading"
        class="loading-container"
      >
        <loading-indicator>
          {{ t('containers.console.loading') }}
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
        <div
          ref="terminalContainer"
          class="terminal-container"
        />
      </div>
    </div>
  </div>
</template>

<script>
import { BadgeState, Banner } from '@rancher/components';
import Vue from 'vue';
import { mapGetters } from 'vuex';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';

import LoadingIndicator from '@pkg/components/LoadingIndicator.vue';
import { ContainerEngine } from '@pkg/config/settings';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

let logInterval = null;

export default Vue.extend({
  name: 'ContainerConsole',
  title: 'Container Console',
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
      lastLogTimestamp: null,
      pendingLogs: '',
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
      title: this.t('containers.console.title'),
      description: '',
    });

    ipcRenderer.on('settings-read', (event, settings) => {
      this.settings = settings;
      this.initializeConsole();
    });

    ipcRenderer.send('settings-read');
    this.initializeConsole();
  },
  beforeDestroy() {
    this.stopStreaming();
    if (this.terminal) {
      this.terminal.dispose();
    }
    ipcRenderer.removeAllListeners('settings-read');
  },
  methods: {
    async initializeConsole() {
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
        this.error = error.message || this.t('containers.console.fetchError');
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
    goBack() {
      this.$router.push('/Containers');
    },
  },
});
</script>

<style lang="scss" scoped>
@import 'xterm/css/xterm.css';
.container-console {
  height: auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.console-header {
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

.console-content {
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

.terminal-container {
  flex: 1;
  width: 100%;
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
</style>
