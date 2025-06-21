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
        <div
          v-if="logs"
          ref="consoleOutput"
          class="console-output"
          @scroll="onUserScroll"
          v-html="formattedLogs"
        />
        <div
          v-else
          class="console-output console-placeholder"
        >
          {{ t('containers.console.noLogs') }}
        </div>
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
    formattedLogs() {
      return this.convertAnsiToHtml(this.logs);
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
    convertAnsiToHtml(text) {
      if (!text) return '';
      
      const ansiColors = {
        '30': '#000000', // black
        '31': '#e74c3c', // red
        '32': '#2ecc71', // green
        '33': '#f39c12', // yellow
        '34': '#3498db', // blue
        '35': '#9b59b6', // magenta
        '36': '#1abc9c', // cyan
        '37': '#ecf0f1', // white
        '90': '#7f8c8d', // bright black (gray)
        '91': '#ff6b6b', // bright red
        '92': '#51c785', // bright green
        '93': '#ffd93d', // bright yellow
        '94': '#74b9ff', // bright blue
        '95': '#a29bfe', // bright magenta
        '96': '#00cec9', // bright cyan
        '97': '#ffffff', // bright white
      };
      
      const ansiBgColors = {
        '40': '#000000', '41': '#e74c3c', '42': '#2ecc71', '43': '#f39c12',
        '44': '#3498db', '45': '#9b59b6', '46': '#1abc9c', '47': '#ecf0f1',
        '100': '#7f8c8d', '101': '#ff6b6b', '102': '#51c785', '103': '#ffd93d',
        '104': '#74b9ff', '105': '#a29bfe', '106': '#00cec9', '107': '#ffffff'
      };
      
      let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
      
      const styleStack = [];
      let currentStyles = { color: '', background: '', bold: false, dim: false, italic: false, underline: false };
      
      html = html.replace(/\x1b\[([0-9;]*)m/g, (match, codes) => {
        if (!codes) codes = '0';
        const codeList = codes.split(';').map(c => c || '0');
        
        let result = '';
        
        for (const code of codeList) {
          switch (code) {
            case '0': // reset
              if (styleStack.length > 0) {
                result += '</span>';
                styleStack.pop();
              }
              currentStyles = { color: '', background: '', bold: false, dim: false, italic: false, underline: false };
              break;
            case '1':
              currentStyles.bold = true;
              break;
            case '2':
              currentStyles.dim = true;
              break;
            case '3':
              currentStyles.italic = true;
              break;
            case '4':
              currentStyles.underline = true;
              break;
            case '22':
              currentStyles.bold = false;
              currentStyles.dim = false;
              break;
            case '23':
              currentStyles.italic = false;
              break;
            case '24':
              currentStyles.underline = false;
              break;
            default:
              if (ansiColors[code]) {
                currentStyles.color = ansiColors[code];
              } else if (ansiBgColors[code]) {
                currentStyles.background = ansiBgColors[code];
              }
          }
        }
        
        if (styleStack.length > 0) {
          result += '</span>';
          styleStack.pop();
        }
        
        const styles = [];
        if (currentStyles.color) styles.push(`color: ${currentStyles.color}`);
        if (currentStyles.background) styles.push(`background-color: ${currentStyles.background}`);
        if (currentStyles.bold) styles.push('font-weight: bold');
        if (currentStyles.dim) styles.push('opacity: 0.6');
        if (currentStyles.italic) styles.push('font-style: italic');
        if (currentStyles.underline) styles.push('text-decoration: underline');
        
        if (styles.length > 0) {
          result += `<span style="${styles.join('; ')}">`;
          styleStack.push(true);
        }
        
        return result;
      });
      
      while (styleStack.length > 0) {
        html += '</span>';
        styleStack.pop();
      }
      
      return html;
    },
  },
});
</script>

<style lang="scss" scoped>
.container-console {
  height: 100%;
  max-height: 100%;
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

.console-output {
  flex: 1;
  width: 100%;
  font-family: 'Courier New', 'Monaco', monospace;
  font-size: 12px;
  line-height: 1.4;
  background: var(--body-bg);
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  padding: 15px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
  cursor: text;

  &:focus {
    outline: none;
    border-color: var(--primary);
  }

  &.console-placeholder {
    color: var(--muted);
    font-style: italic;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 200px;
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