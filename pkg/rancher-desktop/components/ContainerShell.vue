<template>
  <div class="container-shell-component">
    <banner
      v-if="error"
      class="content-state"
      color="error"
      data-testid="error-message"
    >
      <span class="icon icon-info-circle icon-lg" />
      {{ error }}
    </banner>

    <banner
      v-else-if="unsupported"
      class="content-state"
      color="warning"
      data-testid="shell-unsupported"
    >
      <span class="icon icon-info-circle icon-lg" />
      Shell is not supported in this container (the <code>script</code> command is not available).
    </banner>

    <banner
      v-else-if="!isContainerRunning"
      class="content-state"
      color="warning"
      data-testid="shell-not-running"
    >
      <span class="icon icon-info-circle icon-lg" />
      Shell is only available for running containers.
    </banner>

    <div
      v-if="!isLoading && !unsupported"
      v-show="isContainerRunning"
      ref="terminalContainer"
      class="terminal-container"
      data-testid="terminal"
      :data-session-active="sessionActive ? 'true' : undefined"
    />
  </div>
</template>

<script lang="ts" setup>
import { Banner } from '@rancher/components';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';

import { ipcRenderer } from '@pkg/utils/ipcRenderer';

defineOptions({ name: 'ContainerShell' });

const props = defineProps<{
  containerId:         string;
  isContainerRunning?: boolean;
  namespace?:          string;
}>();

const isLoading = ref(true);
const error = ref<string | null>(null);
const unsupported = ref(false);
const terminalContainer = ref<HTMLElement | null>(null);

let terminal: Terminal | undefined;
let fitAddon: FitAddon | undefined;
let resizeObserver: ResizeObserver | undefined;
const sessionActive = ref(false);

async function initializeTerminal() {
  isLoading.value = false;
  await nextTick();

  if (!terminalContainer.value) {
    return;
  }

  terminal = new Terminal({
    theme: {
      background:    '#1a1a1a',
      foreground:    '#e0e0e0',
      cursor:        '#e0e0e0',
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
    fontFamily:   '"Courier New", "Monaco", monospace',
    cursorBlink:  true,
    disableStdin: false,
    convertEol:   false,
    scrollback:   10_000,
  });

  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(terminalContainer.value);

  // Expose terminal instance for e2e testing
  (terminalContainer.value as any).__xtermTerminal = terminal;

  await nextTick();
  resizeObserver = new ResizeObserver(fitAddon.fit.bind(fitAddon));
  resizeObserver.observe(terminalContainer.value);
  fitAddon.fit();

  // Forward keyboard input to the shell process.
  terminal.onData((data) => {
    if (sessionActive.value) {
      ipcRenderer.send('container-exec/input', props.containerId, data);
    }
  });
}

function handleReady(_event: any, id: string, history: string) {
  if (id !== props.containerId) {
    return;
  }
  sessionActive.value = true;
  if (history) {
    terminal?.write(history);
  }
}

function handleOutput(_event: any, id: string, data: string) {
  if (id !== props.containerId) {
    return;
  }
  terminal?.write(data);
}

function handleExit(_event: any, id: string, code: number) {
  if (id !== props.containerId) {
    return;
  }
  const msg = code === 0
    ? '\r\n\x1b[33mShell session ended.\x1b[0m\r\n'
    : `\r\n\x1b[31mShell session ended (exit code: ${ code }).\x1b[0m\r\n`;

  terminal?.write(msg);
  sessionActive.value = false;
}

function handleUnsupported() {
  unsupported.value = true;
}

async function startShell() {
  if (!props.isContainerRunning || !props.containerId) {
    return;
  }

  error.value = null;
  unsupported.value = false;
  sessionActive.value = false;

  // Remove before re-adding to prevent duplicate listeners on reconnect.
  ipcRenderer.removeListener('container-exec/ready', handleReady);
  ipcRenderer.removeListener('container-exec/output', handleOutput);
  ipcRenderer.removeListener('container-exec/exit', handleExit);
  ipcRenderer.removeListener('container-exec/unsupported', handleUnsupported);
  ipcRenderer.on('container-exec/ready', handleReady);
  ipcRenderer.on('container-exec/output', handleOutput);
  ipcRenderer.on('container-exec/exit', handleExit);
  ipcRenderer.on('container-exec/unsupported', handleUnsupported);

  if (!terminal) {
    await initializeTerminal();
  } else {
    terminal.clear();
    await nextTick();
    fitAddon?.fit();
  }

  console.log('[ContainerShell] sending container-exec/start for:', props.containerId);
  if (props.namespace) {
    ipcRenderer.send('container-exec/start', props.containerId, props.namespace);
  } else {
    ipcRenderer.send('container-exec/start', props.containerId);
  }
}

function stopShell() {
  if (sessionActive.value) {
    ipcRenderer.send('container-exec/detach', props.containerId);
    sessionActive.value = false;
  }
  ipcRenderer.removeListener('container-exec/ready', handleReady);
  ipcRenderer.removeListener('container-exec/output', handleOutput);
  ipcRenderer.removeListener('container-exec/exit', handleExit);
  ipcRenderer.removeListener('container-exec/unsupported', handleUnsupported);
}

function cleanup() {
  stopShell();
  if (terminal) {
    try {
      resizeObserver?.disconnect();
      fitAddon?.dispose();
      fitAddon = undefined;
      terminal.dispose();
      terminal = undefined;
    } catch (err) {
      console.error('Error disposing terminal:', err);
    }
  }
  isLoading.value = true;
}

onMounted(() => {
  if (props.isContainerRunning) {
    startShell();
  }
});

onBeforeUnmount(() => {
  cleanup();
});

watch(() => props.containerId, () => {
  cleanup();
  if (props.isContainerRunning) {
    startShell();
  }
});

defineExpose({ focus: () => terminal?.focus() });

watch(() => props.isContainerRunning, (running) => {
  if (running) {
    startShell();
  } else {
    // Keep IPC listeners alive so a late container-exec/ready (e.g. when
    // checkScriptAvailable completes while isContainerRunning briefly dips)
    // can still set data-session-active.  Only detach the session so the
    // background process is released from this frame.
    if (sessionActive.value) {
      ipcRenderer.send('container-exec/detach', props.containerId);
      sessionActive.value = false;
    }
  }
});
</script>

<style lang="scss" scoped>
@import '@xterm/xterm/css/xterm.css';

.container-shell-component {
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

  :deep(.xterm) {
    height: 100%;
  }

  :deep(.xterm-selection) {
    overflow: hidden;
  }
}
</style>
