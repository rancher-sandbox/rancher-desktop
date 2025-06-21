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
        <button
          class="btn role-secondary"
          @click="refreshLogs"
          :disabled="isLoading"
        >
          <i class="icon icon-refresh" />
          {{ t('containers.console.refresh') }}
        </button>
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
        <textarea
          ref="consoleOutput"
          v-model="logs"
          class="console-output"
          readonly
          :placeholder="t('containers.console.noLogs')"
          @scroll="onUserScroll"
        />
      </div>
    </div>
  </div>
</template>

<script>
import { BadgeState, Banner } from '@rancher/components';
import Vue from 'vue';
import { mapGetters } from 'vuex';

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
      logs: '',
      isLoading: true,
      error: null,
      containerName: '',
      containerState: '',
      isContainerRunning: false,
      autoScroll: true,
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

        console.log('Fetching logs for container:', this.containerId);

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
        
        if (!follow) {
          args.push('--tail', '100');
        }
        
        args.push('-t');
        
        args.push(this.containerId);

        console.log('Docker logs command args:', args);
        console.log('Options:', options);

        const { stderr, stdout } = await this.ddClient.docker.cli.exec(
          'logs',
          args,
          options
        );

        console.log('Docker logs stdout:', stdout);
        console.log('Docker logs stderr:', stderr);

        if (stderr && !stdout) {
          throw new Error(stderr);
        }

        if (follow) {
          this.logs += stdout || '';
          if (this.autoScroll) {
            this.scrollToBottom();
          }
        } else {
          this.logs = stdout || '';
          this.scrollToBottom();
        }
      } catch (error) {
        console.error('Error fetching logs:', error);
        this.error = error.message || this.t('containers.console.fetchError');
      } finally {
        this.isLoading = false;
      }
    },
    async refreshLogs() {
      await this.fetchLogs(false);
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

          const args = ['--since', '1s', '-t', this.containerId];

          const { stdout } = await this.ddClient.docker.cli.exec(
            'logs',
            args,
            options
          );

          if (stdout) {
            this.logs += stdout;
            if (this.autoScroll) {
              this.scrollToBottom();
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
    scrollToBottom() {
      this.$nextTick(() => {
        if (this.$refs.consoleOutput) {
          this.$refs.consoleOutput.scrollTop = this.$refs.consoleOutput.scrollHeight;
        }
      });
    },
    onUserScroll() {
      if (this.$refs.consoleOutput) {
        const element = this.$refs.consoleOutput;
        const isAtBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 10;

        this.autoScroll = isAtBottom;
      }
    },
    goBack() {
      this.$router.push('/Containers');
    },
  },
});
</script>

<style lang="scss" scoped>
.container-console {
  height: 100%;
  display: flex;
  flex-direction: column;
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

.console-output {
  flex: 1;
  width: 100%;
  min-height: 400px;
  font-family: 'Courier New', 'Monaco', monospace;
  font-size: 12px;
  line-height: 1.4;
  background: var(--body-bg);
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  padding: 15px;
  resize: none;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;

  &:focus {
    outline: none;
    border-color: var(--primary);
  }

  &::placeholder {
    color: var(--muted);
    font-style: italic;
  }
}

// Dark theme adjustments
.theme-dark {
  .console-output {
    background: #1a1a1a;
    color: #e0e0e0;
    border-color: #444;
  }
}
</style>