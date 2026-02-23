<template>
  <div class="container-shell-component">
    <banner
      v-if="!isContainerRunning"
      class="content-state"
      color="warning"
      data-testid="shell-not-running"
    >
      <span class="icon icon-info-circle icon-lg" />
      Shell is only available for running containers.
    </banner>

    <banner
      v-if="error"
      class="content-state"
      color="error"
      data-testid="error-message"
    >
      <span class="icon icon-info-circle icon-lg" />
      {{ error }}
    </banner>

    <div
      v-if="isContainerRunning && !isLoading"
      ref="terminalContainer"
      class="terminal-container"
      data-testid="terminal"
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
  containerId:          string;
  isContainerRunning?:  boolean;
  namespace?:           string | null;
}>();

const isLoading = ref(true);
const error = ref<string | null>(null);
const terminalContainer = ref<HTMLElement | null>(null);

let terminal: Terminal | undefined;
let fitAddon: FitAddon | undefined;
let resizeObserver: ResizeObserver | undefined;
let execId = '';
let hasPty = false;

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
  // In non-PTY mode (sh -i fallback, e.g. Alpine without `script`) there is
  // no TTY line discipline to echo characters, so we mirror printable input
  // locally so the user can see what they are typing.
  terminal.onData((data) => {
    if (execId) {
      if (!hasPty) {
        if (data === '\r') {
          terminal?.write('\r\n');
        } else if (data === '\x7f') {
          terminal?.write('\b \b');
        } else if (data.length === 1 && data >= ' ') {
          terminal?.write(data);
        }
      }
      // Without a PTY the TTY line discipline is absent, so the shell never
      // sees a newline to terminate the command line.  Convert \r → \n.
      const shellData = !hasPty ? data.replace(/\r/g, '\n') : data;
      ipcRenderer.send('container-exec/input', execId, shellData);
    }
  });
}

function handlePty(_event: any, id: string, isPty: boolean) {
  if (id === execId) {
    hasPty = isPty;
  }
}

function handleReady(_event: any, id: string, history: string, ptyKnown: boolean) {
  execId = id;
  hasPty = ptyKnown;
  if (history) {
    // Apply the same \n → \r\n conversion as handleOutput: the ring buffer
    // stores raw stdout bytes (bare \n in non-PTY mode).
    const out = !ptyKnown ? history.replace(/(?<!\r)\n/g, '\r\n') : history;
    terminal?.write(out);
  }
}

function handleOutput(_event: any, id: string, data: string) {
  if (id !== execId) {
    return;
  }
  // In non-PTY mode the shell emits bare \n.  xterm.js with convertEol:false
  // only moves the cursor down on \n (not back to column 0), producing
  // stairstepped output.  Add the missing \r, skipping \n already preceded
  // by \r so we don't double-convert any \r\n from stderr processing.
  const out = !hasPty ? data.replace(/(?<!\r)\n/g, '\r\n') : data;
  terminal?.write(out);
}

function handleExit(_event: any, id: string, code: number) {
  if (id !== execId) {
    return;
  }
  const msg = code === 0
    ? '\r\n\x1b[33mShell session ended.\x1b[0m\r\n'
    : `\r\n\x1b[31mShell session ended (exit code: ${ code }).\x1b[0m\r\n`;

  terminal?.write(msg);
  execId = '';
}

async function startShell() {
  if (!props.isContainerRunning || !props.containerId) {
    return;
  }

  error.value = null;
  execId = '';   // will be assigned by handleReady
  hasPty = false;

  ipcRenderer.on('container-exec/ready',  handleReady);
  ipcRenderer.on('container-exec/output', handleOutput);
  ipcRenderer.on('container-exec/exit',   handleExit);
  ipcRenderer.on('container-exec/pty',    handlePty);

  if (!terminal) {
    await initializeTerminal();
  } else {
    terminal.clear();
    await nextTick();
    fitAddon?.fit();
  }

  ipcRenderer.send('container-exec/start', props.containerId, props.namespace ?? undefined);
}

function stopShell() {
  if (execId) {
    ipcRenderer.send('container-exec/detach', execId);
    execId = '';
  }
  ipcRenderer.removeListener('container-exec/ready',  handleReady);
  ipcRenderer.removeListener('container-exec/output', handleOutput);
  ipcRenderer.removeListener('container-exec/exit',   handleExit);
  ipcRenderer.removeListener('container-exec/pty',    handlePty);
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

watch(() => props.isContainerRunning, (running) => {
  if (running) {
    startShell();
  } else {
    stopShell();
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
