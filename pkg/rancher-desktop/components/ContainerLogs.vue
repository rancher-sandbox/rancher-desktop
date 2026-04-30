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

<script lang="ts" setup>
import v1 from '@docker/extension-api-client-types/dist/v1';
import { Banner } from '@rancher/components';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { shell } from 'electron';
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';

import LoadingIndicator from '@pkg/components/LoadingIndicator.vue';

interface RDXSpawnOptions extends v1.SpawnOptions {
  namespace?: string;
}

defineOptions({ name: 'ContainerLogs' });

const props = defineProps<{
  containerId:         string;
  isContainerRunning?: boolean;
  namespace?:          string | null;
}>();

defineExpose({
  clearSearch,
  performSearch,
  searchNext,
  searchPrevious,
});

const isLoading = ref(true);
const error = ref<string | null>(null);

let terminal: Terminal | undefined;
let fitAddon: FitAddon | undefined;
let searchAddon: SearchAddon | undefined;
let streamProcess: v1.ExecProcess | undefined;
let resizeObserver: ResizeObserver | undefined;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * Debounce the initial log loading to avoid showing the initial logs streaming
 * in right after loading.
 */
const waitingForInitialLogs = ref(true);

/**
 * Timer used with `waitingForInitialLogs` to reveal the terminal after a delay.
 */
let revealTimeout: ReturnType<typeof setTimeout> | undefined;

const terminalContainer = ref<HTMLElement | null>(null);

async function initializeTerminal() {
  isLoading.value = false;
  await nextTick();
  if (terminalContainer.value) {
    terminal = new Terminal({
      theme: {
        background:    '#1a1a1a',
        foreground:    '#e0e0e0',
        cursor:        '#1a1a1a', // same as the background to effectively hide the cursor.
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
      cursorBlink:  false,
      disableStdin: true,
      convertEol:   true,
      scrollback:   50_000,
    });

    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    searchAddon = new SearchAddon();
    terminal.loadAddon(searchAddon);

    terminal.loadAddon(new WebLinksAddon((event, uri) => {
      event.preventDefault();
      shell.openExternal(uri);
    }));

    // Disable key events to allow normal behaviour such as copy/paste.
    terminal.attachCustomKeyEventHandler(() => false);

    terminal.open(terminalContainer.value);

    // Expose terminal instance for e2e testing
    (terminalContainer.value as any).__xtermTerminal = terminal;

    await nextTick();
    resizeObserver = new ResizeObserver(fitAddon.fit.bind(fitAddon));
    resizeObserver.observe(terminalContainer.value);
    fitAddon.fit();
  }
}

async function startStreaming() {
  try {
    error.value = null;
    waitingForInitialLogs.value = true;

    if (!terminal) {
      await initializeTerminal();
    }

    const streamOptions: RDXSpawnOptions = {
      cwd:    '/',
      stream: {
        onOutput: (data) => {
          const output = (data.stdout || data.stderr);

          if (terminal && output) {
            terminal.write(output);

            if (waitingForInitialLogs.value) {
              // If we're still waiting for the initial logs, delay the reveal
              // until after all of the initial logs have streamed in.
              clearTimeout(revealTimeout);

              revealTimeout = setTimeout(() => {
                waitingForInitialLogs.value = false;
                nextTick(() => {
                  fitAddon?.fit();
                  terminal?.scrollToBottom();
                });
              }, 200);
            }
          }
        },
        onError: (err: Error) => {
          console.error('Stream error:', err);
          handleStreamError(err);
        },
        onClose: (code: number) => {
          streamProcess = undefined;
          if (code !== 0 && props.isContainerRunning) {
            handleStreamError(new Error(`Stream closed with code ${ code }`));
          }
        },
        splitOutputLines: false,
      },
    };

    if (props.namespace) {
      streamOptions.namespace = props.namespace;
    }

    const streamArgs = ['--follow', '--timestamps', '--tail', '10000', props.containerId];
    streamProcess = window.ddClient.docker.cli.exec('logs', streamArgs, streamOptions);
    reconnectAttempts = 0;

    // If we haven't received any logs within 500ms, reveal the terminal anyway.
    revealTimeout = setTimeout(() => {
      waitingForInitialLogs.value = false;
    }, 500);
  } catch (err: unknown) {
    console.error('Error starting log stream:', err);
    waitingForInitialLogs.value = false;

    const errorMessages: Record<string, string> = {
      'No such container':  'Container not found. It may have been removed.',
      'permission denied':  'Permission denied. Check Docker access permissions.',
      'connection refused': 'Cannot connect to Docker. Is Docker running?',
    };

    error.value = Object.entries(errorMessages)
      .find(([key]) => err instanceof Error && err.message.includes(key))?.[1] ??
      (err instanceof Error ? err.message : 'Failed to fetch logs');
  }
}

function stopStreaming() {
  try {
    streamProcess?.close();
  } catch (err) {
    console.error('Error stopping log stream:', err);
  }
  streamProcess = undefined;
}

function handleStreamError(err: Error) {
  if (reconnectAttempts < maxReconnectAttempts && props.isContainerRunning) {
    reconnectAttempts++;
    const delay = Math.pow(2, reconnectAttempts - 1) * 1000;
    setTimeout(startStreaming, delay);
  } else {
    const retryMessage = reconnectAttempts >= maxReconnectAttempts ? ' (max retries exceeded)' : '';

    error.value = `Streaming error: ${ err.message }${ retryMessage }`;
  }
}

function clearSearch() {
  searchAddon?.clearDecorations();
}

function performSearch(searchTerm: string) {
  clearTimeout(searchDebounceTimer);

  searchDebounceTimer = setTimeout(() => {
    if (!searchAddon) return;

    searchAddon.clearDecorations();
    if (searchTerm) {
      try {
        searchAddon.findNext(searchTerm);
      } catch (err) {
        console.error('Search error:', err);
      }
    }
  }, 300);
}

function searchNext(searchTerm: string) {
  if (!searchAddon || !searchTerm) return;
  executeSearch(() => searchAddon?.findNext(searchTerm));
}

function searchPrevious(searchTerm: string) {
  if (!searchAddon || !searchTerm) return;
  executeSearch(() => searchAddon?.findPrevious(searchTerm));
}

function executeSearch(searchFn: () => void) {
  try {
    searchFn();
  } catch (err) {
    console.error('Search error:', err);
  }
}

function cleanup() {
  stopStreaming();
  if (terminal) {
    try {
      resizeObserver?.disconnect();
      searchAddon?.clearDecorations();
      searchAddon?.dispose();
      searchAddon = undefined;
      fitAddon?.dispose();
      fitAddon = undefined;
      terminal.dispose();
      terminal = undefined;
    } catch (err) {
      console.error('Error disposing terminal:', err);
    }
  }
  clearTimeout(searchDebounceTimer);
  clearTimeout(revealTimeout);
}

async function initializeLogs() {
  if (window.ddClient) {
    await startStreaming();
  }
}

onMounted(() => {
  initializeLogs();
});

onBeforeUnmount(() => {
  cleanup();
});

watch(() => props.containerId, () => {
  if (terminal) {
    cleanup();
  }
  initializeLogs();
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
