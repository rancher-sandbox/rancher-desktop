<template>
  <div class="file-editor">
    <div class="editor-header">
      <div class="file-info">
        <span class="volume-name">{{ volumeName }}</span>
        <span class="separator">/</span>
        <span class="file-path">{{ filePath }}</span>
      </div>
      <div class="editor-actions">
        <transition name="fade">
          <span v-if="saveMessage" :class="saveMessageType === 'success' ? 'save-success' : 'save-error'">
            {{ saveMessage }}
          </span>
          <span v-else-if="isModified" class="modified-indicator">
            {{ t('volumes.editor.modified') }}
          </span>
        </transition>
        <button
          :disabled="!isModified || isSaving"
          class="btn role-primary"
          @click="saveFile"
        >
          {{ isSaving ? t('volumes.editor.saving') : t('volumes.editor.save') }}
        </button>
      </div>
    </div>

    <loading-indicator
      v-if="isLoading"
      class="content-state"
    >
      {{ t('volumes.editor.loading') }}
    </loading-indicator>

    <banner
      v-else-if="error"
      class="content-state"
      color="error"
    >
      <span class="icon icon-info-circle icon-lg"/>
      {{ error }}
    </banner>

    <div v-else class="editor-container">
      <div class="editor-toolbar">
        <span class="file-size">{{ formatSize(fileSize) }}</span>
      </div>
      <textarea
        ref="editor"
        v-model="content"
        class="code-editor"
        spellcheck="false"
        @input="onContentChange"
      ></textarea>
    </div>
  </div>
</template>

<script>
import {Banner} from '@rancher/components';
import Vue from 'vue';
import {mapGetters} from 'vuex';

import LoadingIndicator from '@pkg/components/LoadingIndicator.vue';
import {ContainerEngine} from '@pkg/config/settings';
import {ipcRenderer} from '@pkg/utils/ipcRenderer';

export default Vue.extend({
  name: 'VolumeFileEditor',
  title: 'File Editor',
  components: {
    Banner,
    LoadingIndicator,
  },
  data() {
    return {
      settings: undefined,
      ddClient: null,
      isLoading: true,
      isSaving: false,
      error: null,
      content: '',
      originalContent: '',
      fileSize: 0,
      saveMessage: '',
      saveMessageType: 'success',
      saveMessageTimer: null,
    };
  },
  computed: {
    ...mapGetters('k8sManager', {isK8sReady: 'isReady'}),
    volumeName() {
      const name = this.$route.query.volume;
      if (!name || !/^[a-zA-Z0-9._-]+$/.test(name)) {
        throw new Error('Invalid volume name format');
      }
      return name;
    },
    filePath() {
      const path = this.$route.query.path;
      if (!path || !path.startsWith('/')) {
        throw new Error('Invalid file path format');
      }
      return path;
    },
    hasNamespaceSelected() {
      return this.settings?.containerEngine?.name === ContainerEngine.CONTAINERD && this.settings?.containers?.namespace;
    },
    isModified() {
      return this.content !== this.originalContent;
    },
  },
  mounted() {
    this.$store.dispatch('page/setHeader', {
      title: this.t('volumes.editor.title'),
      description: this.filePath.split('/').pop(),
    });

    ipcRenderer.on('settings-read', this.onSettingsRead);
    ipcRenderer.send('settings-read');

    window.addEventListener('beforeunload', this.handleBeforeUnload);
  },
  beforeDestroy() {
    ipcRenderer.off('settings-read', this.onSettingsRead);
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    if (this.saveMessageTimer) {
      clearTimeout(this.saveMessageTimer);
    }
  },
  methods: {
    async onSettingsRead(event, settings) {
      this.settings = settings;
      await this.loadFile();
    },
    async loadFile() {
      if (window.ddClient && this.isK8sReady && this.settings) {
        this.ddClient = window.ddClient;
        await this.readFileContent();
      }
    },
    async readFileContent() {
      try {
        this.error = null;

        const containerFilePath = `/volume${this.filePath}`;
        const catCommand = [
          'run', '--rm',
          '-v', `${this.volumeName}:/volume:ro`,
          'busybox',
          'cat', containerFilePath
        ];

        const execOptions = {cwd: '/'};
        if (this.hasNamespaceSelected) {
          execOptions.namespace = this.hasNamespaceSelected;
        }

        const {stderr, stdout} = await this.ddClient.docker.cli.exec(
          catCommand[0],
          catCommand.slice(1),
          execOptions
        );

        if (stderr) {
          throw new Error(stderr);
        }

        this.content = stdout;
        this.originalContent = stdout;
        this.fileSize = new TextEncoder().encode(stdout).length;
        this.isLoading = false;
      } catch (error) {
        console.error('Error reading file:', error);
        this.error = this.t('volumes.editor.readError', {error: error.message});
        this.isLoading = false;
      }
    },
    async saveFile() {
      if (!this.isModified || this.isSaving) return;

      try {
        this.isSaving = true;
        this.error = null;

        const containerFilePath = `/volume${this.filePath}`;

        // Create a temporary file with the new content
        const tempFileName = `temp_${Date.now()}.txt`;
        const echoCommand = [
          'run', '--rm',
          '-v', `${this.volumeName}:/volume`,
          'busybox',
          'sh', '-c',
          `cat > /volume/${tempFileName} << 'EOF'
${this.content}
EOF
mv /volume/${tempFileName} ${containerFilePath}`
        ];

        const execOptions = {cwd: '/'};
        if (this.hasNamespaceSelected) {
          execOptions.namespace = this.hasNamespaceSelected;
        }

        const {stderr, stdout} = await this.ddClient.docker.cli.exec(
          echoCommand[0],
          echoCommand.slice(1),
          execOptions
        );

        if (stderr) {
          throw new Error(stderr);
        }

        this.originalContent = this.content;
        this.fileSize = new TextEncoder().encode(this.content).length;
        this.showSaveMessage('Saved', 'success');
      } catch (error) {
        console.error('Error saving file:', error);
        this.showSaveMessage('Failed to save', 'error');
      } finally {
        this.isSaving = false;
      }
    },
    onContentChange() {
      // Update file size as content changes
      this.fileSize = new TextEncoder().encode(this.content).length;
    },
    handleBeforeUnload(event) {
      if (this.isModified) {
        event.preventDefault();
        event.returnValue = '';
      }
    },
    showSaveMessage(message, type) {
      this.saveMessage = message;
      this.saveMessageType = type;

      if (this.saveMessageTimer) {
        clearTimeout(this.saveMessageTimer);
      }

      this.saveMessageTimer = setTimeout(() => {
        this.saveMessage = '';
      }, 3000);
    },
    formatSize(bytes) {
      if (bytes === 0) return '0 B';
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(1024));
      return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    },
  },
});
</script>

<style lang="scss" scoped>
.file-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border);
  background: var(--nav-bg);
}

.file-info {
  display: flex;
  align-items: center;
  font-family: monospace;
  font-size: 0.875rem;

  .volume-name {
    color: var(--primary);
    font-weight: bold;
  }

  .separator {
    margin: 0 0.5rem;
    color: var(--muted);
  }

  .file-path {
    color: var(--body-text);
  }
}

.editor-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;

  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    height: 2.5rem;

    .icon {
      font-size: 0.875rem;
    }
  }

}

.content-state {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 2.5rem;
  flex: 1;
}

.editor-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.editor-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 1.25rem;
  background: var(--nav-bg);
  border-bottom: 1px solid var(--border);
  font-size: 0.75rem;

  .file-size {
    color: var(--muted);
  }
}

.code-editor {
  flex: 1;
  width: 100%;
  padding: 1rem;
  border: none;
  background: var(--nav-bg);
  color: var(--body-text);
  font-family: 'Courier New', Monaco, monospace;
  font-size: 13px;
  line-height: 1.5;
  resize: none;
  outline: none;
  overflow: auto;
  white-space: pre;

  &:focus {
    background: var(--nav-bg);
    outline: 1px solid var(--primary);
    outline-offset: -1px;
  }

  &::selection {
    background: var(--primary-hover-bg);
  }
}

.save-success {
  color: var(--success);
  font-size: 0.875rem;
  font-weight: 500;
  margin-right: 0.5rem;
}

.save-error {
  color: var(--error);
  font-size: 0.875rem;
  font-weight: 500;
  margin-right: 0.5rem;
}

.modified-indicator {
  color: var(--muted);
  font-size: 0.875rem;
  font-weight: 400;
  margin-right: 0.5rem;
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter, .fade-leave-to {
  opacity: 0;
}
</style>
