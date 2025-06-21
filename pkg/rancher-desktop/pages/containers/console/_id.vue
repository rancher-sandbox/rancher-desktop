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
  watch: {
    formattedLogs() {
      if (this.autoScroll) {
        this.scrollToBottom();
      }
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

        const { stderr, stdout } = await this.ddClient.docker.cli.exec(
          'logs',
          args,
          options
        );

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
        this.$nextTick(() => {
          if (this.$refs.consoleOutput) {
            this.$refs.consoleOutput.scrollTop = this.$refs.consoleOutput.scrollHeight;
          }
        });
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
        '31': '#ff5555', // red
        '32': '#50fa7b', // green
        '33': '#f1fa8c', // yellow
        '34': '#8be9fd', // blue
        '35': '#ff79c6', // magenta
        '36': '#8be9fd', // cyan
        '37': '#f8f8f2', // white
        '90': '#6272a4', // bright black
        '91': '#ff6e6e', // bright red
        '92': '#69ff94', // bright green
        '93': '#ffffa5', // bright yellow
        '94': '#d6acff', // bright blue
        '95': '#ff92df', // bright magenta
        '96': '#a4ffff', // bright cyan
        '97': '#ffffff', // bright white
      };

      const ansiBgColors = {
        '40': '#282a36', '41': '#ff5555', '42': '#50fa7b', '43': '#f1fa8c',
        '44': '#8be9fd', '45': '#ff79c6', '46': '#8be9fd', '47': '#f8f8f2',
        '100': '#6272a4', '101': '#ff6e6e', '102': '#69ff94', '103': '#ffffa5',
        '104': '#d6acff', '105': '#ff92df', '106': '#a4ffff', '107': '#ffffff'
      };

      let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

      const spans = [];
      let currentState = {
        color: '',
        background: '',
        bold: false,
        dim: false,
        italic: false,
        underline: false,
        strikethrough: false
      };

      html = html.replace(/\x1b\[([0-9;]*)([a-zA-Z])/g, (match, codes, command) => {
        if (command !== 'm') return match;

        const codeList = codes ? codes.split(';').map(c => c || '0') : ['0'];
        let result = '';

        if (spans.length > 0) {
          result += '</span>';
          spans.pop();
        }

        for (let i = 0; i < codeList.length; i++) {
          const code = codeList[i];

          switch (code) {
            case '0': // reset
              currentState = { color: '', background: '', bold: false, dim: false, italic: false, underline: false, strikethrough: false };
              break;
            case '1': currentState.bold = true; break;
            case '2': currentState.dim = true; break;
            case '3': currentState.italic = true; break;
            case '4': currentState.underline = true; break;
            case '9': currentState.strikethrough = true; break;
            case '22': currentState.bold = false; currentState.dim = false; break;
            case '23': currentState.italic = false; break;
            case '24': currentState.underline = false; break;
            case '29': currentState.strikethrough = false; break;
            case '38': // Extended foreground
              if (codeList[i + 1] === '5' && codeList[i + 2]) {
                currentState.color = this.get256Color(parseInt(codeList[i + 2]));
                i += 2;
              } else if (codeList[i + 1] === '2' && codeList[i + 4]) {
                const r = parseInt(codeList[i + 2]) || 0;
                const g = parseInt(codeList[i + 3]) || 0;
                const b = parseInt(codeList[i + 4]) || 0;
                currentState.color = `rgb(${r}, ${g}, ${b})`;
                i += 4;
              }
              break;
            case '48':
              if (codeList[i + 1] === '5' && codeList[i + 2]) {
                currentState.background = this.get256Color(parseInt(codeList[i + 2]));
                i += 2;
              } else if (codeList[i + 1] === '2' && codeList[i + 4]) {
                const r = parseInt(codeList[i + 2]) || 0;
                const g = parseInt(codeList[i + 3]) || 0;
                const b = parseInt(codeList[i + 4]) || 0;
                currentState.background = `rgb(${r}, ${g}, ${b})`;
                i += 4;
              }
              break;
            default:
              if (ansiColors[code]) {
                currentState.color = ansiColors[code];
              } else if (ansiBgColors[code]) {
                currentState.background = ansiBgColors[code];
              }
          }
        }

        const styles = [];
        if (currentState.color) styles.push(`color: ${currentState.color}`);
        if (currentState.background) styles.push(`background-color: ${currentState.background}`);
        if (currentState.bold) styles.push('font-weight: bold');
        if (currentState.dim) styles.push('opacity: 0.6');
        if (currentState.italic) styles.push('font-style: italic');
        if (currentState.underline && currentState.strikethrough) {
          styles.push('text-decoration: underline line-through');
        } else if (currentState.underline) {
          styles.push('text-decoration: underline');
        } else if (currentState.strikethrough) {
          styles.push('text-decoration: line-through');
        }

        if (styles.length > 0) {
          result += `<span style="${styles.join('; ')}">`;
          spans.push(true);
        }

        return result;
      });

      while (spans.length > 0) {
        html += '</span>';
        spans.pop();
      }

      return html;
    },
    get256Color(index) {
      if (index < 16) {
        const colors = ['#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#c0c0c0',
                       '#808080', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff'];
        return colors[index] || '#ffffff';
      } else if (index < 232) {
        const n = index - 16;
        const r = Math.floor(n / 36);
        const g = Math.floor((n % 36) / 6);
        const b = n % 6;
        const toRgb = (c) => c === 0 ? 0 : 55 + c * 40;
        return `rgb(${toRgb(r)}, ${toRgb(g)}, ${toRgb(b)})`;
      } else {
        const gray = 8 + (index - 232) * 10;
        return `rgb(${gray}, ${gray}, ${gray})`;
      }
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
  background: #1a1a1a !important;
  color: #e0e0e0 !important;
  border: 1px solid #444 !important;
  border-radius: var(--border-radius);
  padding: 15px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
  cursor: text;

  &:focus {
    outline: none;
    border-color: #8be9fd !important;
  }

  &.console-placeholder {
    color: #6272a4 !important;
    font-style: italic;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 200px;
  }
}
</style>
