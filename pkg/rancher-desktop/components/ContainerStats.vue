<template>
  <div class="container-stats-component">
    <banner
      v-if="!isContainerRunning"
      class="content-state"
      color="warning"
      data-testid="stats-not-running"
    >
      <span class="icon icon-info-circle icon-lg" />
      Stats are only available for running containers.
    </banner>

    <banner
      v-else-if="!isMoby"
      class="content-state"
      color="info"
      data-testid="stats-unsupported-engine"
    >
      <span class="icon icon-info-circle icon-lg" />
      Stats are currently only available for the Docker (Moby) engine.
    </banner>

    <template v-else>
      <div class="stats-toolbar">
        <label class="refresh-label">
          Refresh
          <select
            v-model="refreshSeconds"
            class="refresh-select"
            data-testid="stats-refresh-select"
            @change="restartPolling"
          >
            <option :value="1">1 s</option>
            <option :value="5">5 s</option>
            <option :value="10">10 s</option>
            <option :value="20">20 s</option>
            <option :value="30">30 s</option>
            <option :value="60">1 min</option>
          </select>
        </label>
      </div>

      <div
        ref="statsChartsEl"
        class="stats-charts"
      >
        <div
          class="stat-card"
          data-testid="stats-cpu-chart"
        >
          <h3 class="chart-title">
            CPU %
          </h3>
          <div class="chart-wrapper">
            <Line
              :data="cpuChartData"
              :options="lineOptions"
            />
          </div>
        </div>

        <div
          class="stat-card"
          data-testid="stats-memory-chart"
        >
          <h3 class="chart-title">
            Memory
          </h3>
          <div class="chart-wrapper">
            <Line
              :data="memChartData"
              :options="memOptions"
            />
          </div>
        </div>

        <div
          class="stat-card"
          data-testid="stats-network-chart"
        >
          <h3 class="chart-title">
            Network I/O (bytes/s)
          </h3>
          <div class="chart-wrapper">
            <Line
              :data="netChartData"
              :options="bytesOptions"
            />
          </div>
        </div>

        <div
          class="stat-card"
          data-testid="stats-io-chart"
        >
          <h3 class="chart-title">
            Block I/O (bytes/s)
          </h3>
          <div class="chart-wrapper">
            <Line
              :data="ioChartData"
              :options="bytesOptions"
            />
          </div>
        </div>
      </div>

      <div
        class="processes-section"
        data-testid="stats-process-table"
      >
        <h3 class="section-title">
          Processes
        </h3>
        <div
          v-if="processes.length"
          class="process-table-wrapper"
        >
          <table class="process-table">
            <thead>
              <tr>
                <th
                  v-for="col in processHeaders"
                  :key="col"
                >
                  {{ col }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, i) in processes"
                :key="i"
              >
                <td
                  v-for="(cell, j) in row"
                  :key="j"
                  :class="{ 'cmd-cell': j === row.length - 1 }"
                >
                  {{ cell }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p
          v-else
          class="no-processes"
        >
          No processes found.
        </p>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { Banner } from '@rancher/components';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { Line } from 'vue-chartjs';
import { useStore } from 'vuex';

import { ContainerEngine } from '@pkg/config/settings';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

defineOptions({ name: 'ContainerStats' });

const props = defineProps<{
  containerId:         string;
  isContainerRunning?: boolean;
  namespace?:          string;
}>();

const store = useStore();
const isMoby = computed(() => store.getters['container-engine/backend'] === ContainerEngine.MOBY);

const MAX_POINTS = 60;
const DEFAULT_REFRESH = 1;

const refreshSeconds = ref(DEFAULT_REFRESH);

// Rolling buffers
const labels = ref<string[]>([]);
const cpuData = ref<number[]>([]);
const memData = ref<number[]>([]);
const memLimitData = ref<number[]>([]);
const netRxData = ref<number[]>([]);
const netTxData = ref<number[]>([]);
const blockReadData = ref<number[]>([]);
const blockWriteData = ref<number[]>([]);

// Previous cumulative totals for NetIO / BlockIO delta calculation
let prevNetRx = -1;
let prevNetTx = -1;
let prevBlockR = -1;
let prevBlockW = -1;

// Process list
const processHeaders = ref<string[]>([]);
const processes = ref<string[][]>([]);

// Template ref used by readColors() to read CSS custom properties
const statsChartsEl = ref<HTMLElement | null>(null);

// ── Parsing helpers ────────────────────────────────────────────────────────

const BYTE_UNITS: Record<string, number> = {
  b:   1,
  kb:  1e3,
  mb:  1e6,
  gb:  1e9,
  tb:  1e12,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
};

function parseBytes(s: string): number {
  const m = /^([\d.]+)\s*([a-z]+)?$/i.exec(s.trim());

  if (!m) return 0;
  const val = parseFloat(m[1]);
  const unit = (m[2] ?? 'b').toLowerCase();

  return val * (BYTE_UNITS[unit] ?? 1);
}

function parsePair(s: string): [number, number] {
  const sep = s.indexOf('/');

  if (sep === -1) return [parseBytes(s.trim()), 0];

  return [parseBytes(s.slice(0, sep).trim()), parseBytes(s.slice(sep + 1).trim())];
}

// ── Chart colour helpers ───────────────────────────────────────────────────

const textColor = ref('');
const gridColor = ref('');
// Fallback colours used when the CSS variables below are not available.
const chartPalette = ref({
  cpu:    '#4e9af1',
  mem:    '#f1a14e',
  memLim: '#4e9af1',
  netRx:  '#4ef185',
  netTx:  '#f14e4e',
  blockR: '#9b4ef1',
  blockW: '#f1e84e',
});

function readCssColor(el: HTMLElement, varName: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(varName).trim() || fallback;
}

function readColors() {
  const el = statsChartsEl.value;

  if (!el) return;

  textColor.value = readCssColor(el, '--body-text', '#333');
  gridColor.value = readCssColor(el, '--border', 'rgba(0,0,0,0.1)');

  chartPalette.value = {
    cpu:    readCssColor(el, '--primary', chartPalette.value.cpu),
    mem:    readCssColor(el, '--warning', chartPalette.value.mem),
    memLim: readCssColor(el, '--primary', chartPalette.value.memLim),
    netRx:  readCssColor(el, '--success', chartPalette.value.netRx),
    netTx:  readCssColor(el, '--error', chartPalette.value.netTx),
    blockR: readCssColor(el, '--info', chartPalette.value.blockR),
    blockW: readCssColor(el, '--warning-text', chartPalette.value.blockW),
  };
}

function dataset(label: string, data: number[], color: string, dashed = false) {
  return {
    label,
    data:            [...data],
    borderColor:     color,
    backgroundColor: dashed ? 'transparent' : color + '33', // 33 = 20% alpha in hex
    borderWidth:     dashed ? 1 : 2,
    borderDash:      dashed ? [4, 4] : [],
    pointRadius:     0,
    fill:            !dashed,
    tension:         0.3,
  };
}

// ── Computed chart data ────────────────────────────────────────────────────

const cpuChartData = computed(() => ({
  labels:   [...labels.value],
  datasets: [dataset('CPU %', cpuData.value, chartPalette.value.cpu)],
}));

const memChartData = computed(() => ({
  labels:   [...labels.value],
  datasets: [
    dataset('Used', memData.value, chartPalette.value.mem),
    dataset('Limit', memLimitData.value, chartPalette.value.memLim, true),
  ],
}));

const netChartData = computed(() => ({
  labels:   labels.value.slice(1),
  datasets: [
    dataset('RX', netRxData.value, chartPalette.value.netRx),
    dataset('TX', netTxData.value, chartPalette.value.netTx),
  ],
}));

const ioChartData = computed(() => ({
  labels:   labels.value.slice(1),
  datasets: [
    dataset('Read', blockReadData.value, chartPalette.value.blockR),
    dataset('Write', blockWriteData.value, chartPalette.value.blockW),
  ],
}));

// ── Chart options ──────────────────────────────────────────────────────────

const baseOptions = computed(() => ({
  animation:           false as const,
  responsive:          true,
  maintainAspectRatio: false,
  interaction:         { mode: 'index' as const, intersect: false },
  scales:              {
    x: { display: false },
    y: { beginAtZero: true, ticks: { color: textColor.value }, grid: { color: gridColor.value } },
  },
  plugins: {
    legend: { display: true, labels: { color: textColor.value, boxWidth: 12 } },
  },
}));

const lineOptions = computed(() => ({ ...baseOptions.value }));

const memOptions = computed(() => ({
  ...baseOptions.value,
  plugins: {
    ...baseOptions.value.plugins,
    tooltip: {
      callbacks: {
        label: (ctx: any) => ` ${ ctx.dataset.label }: ${ formatBytes(ctx.raw) }`,
      },
    },
  },
  scales: {
    ...baseOptions.value.scales,
    y: {
      ...baseOptions.value.scales.y,
      ticks: {
        ...baseOptions.value.scales.y.ticks,
        callback: (v: number | string) => formatBytes(Number(v)),
      },
    },
  },
}));

const bytesOptions = computed(() => ({
  ...baseOptions.value,
  plugins: {
    ...baseOptions.value.plugins,
    tooltip: {
      callbacks: {
        label: (ctx: any) => ` ${ ctx.dataset.label }: ${ formatBytes(ctx.raw) }/s`,
      },
    },
  },
  scales: {
    ...baseOptions.value.scales,
    y: {
      ...baseOptions.value.scales.y,
      ticks: {
        ...baseOptions.value.scales.y.ticks,
        callback: (v: number | string) => formatBytes(Number(v)),
      },
    },
  },
}));

function formatBytes(b: number): string {
  if (b >= 1024 ** 3) return `${ (b / 1024 ** 3).toFixed(1) } GiB`;
  if (b >= 1024 ** 2) return `${ (b / 1024 ** 2).toFixed(1) } MiB`;
  if (b >= 1024) return `${ (b / 1024).toFixed(1) } KiB`;

  return `${ b } B`;
}

// ── Data ingestion (from IPC events) ──────────────────────────────────────

function push<T>(arr: T[], val: T) {
  arr.push(val);
  if (arr.length > MAX_POINTS) arr.shift();
}

function handleStatsData(_event: any, id: string, statsJson: string) {
  if (id !== props.containerId) return;

  try {
    const line = statsJson.split('\n').find(l => l.trim().startsWith('{'));

    if (!line) {
      console.debug('container-stats/data: no JSON in output:', statsJson.slice(0, 200));
      return;
    }
    const s = JSON.parse(line);

    push(labels.value, new Date().toLocaleTimeString());
    push(cpuData.value, parseFloat((s.CPUPerc ?? '0%').replace('%', '')) || 0);

    const [memUsed, memLimit] = parsePair(s.MemUsage ?? '0B / 0B');

    push(memData.value, memUsed);
    push(memLimitData.value, memLimit);

    const [rx, tx] = parsePair(s.NetIO ?? '0B / 0B');
    const [blockR, blockW] = parsePair(s.BlockIO ?? '0B / 0B');

    // Push per-second rates; skip the very first sample (no previous value to diff against).
    if (prevNetRx >= 0) {
      push(netRxData.value, Math.max(0, rx - prevNetRx) / refreshSeconds.value);
      push(netTxData.value, Math.max(0, tx - prevNetTx) / refreshSeconds.value);
      push(blockReadData.value, Math.max(0, blockR - prevBlockR) / refreshSeconds.value);
      push(blockWriteData.value, Math.max(0, blockW - prevBlockW) / refreshSeconds.value);
    }
    prevNetRx = rx;
    prevNetTx = tx;
    prevBlockR = blockR;
    prevBlockW = blockW;
  } catch {
    // ignore parse errors for individual samples
  }
}

function handleProcesses(_event: any, id: string, topOutput: string) {
  if (id !== props.containerId) return;

  const lines = topOutput.split('\n').filter(Boolean);

  if (lines.length < 2) return;

  const headerLine = lines[0];

  // Words separated by a single space belong to the same column (e.g. "START TIME");
  // 2+ spaces mark a new column boundary.
  const matches = Array.from(headerLine.matchAll(/(?<=^|\s{2,})(\S|\s(?!\s))+/g));
  const colStarts = matches.map(m => m.index);
  const headers = matches.map(m => m[0].trimEnd());
  const colEnds = colStarts.slice(1);
  const rows = lines.slice(1).map(line =>
    colStarts.map((start, i) => line.slice(start, colEnds[i]).trim()),
  );

  processHeaders.value = headers;
  processes.value = rows;
}

function handleStopped(_event: any, id: string) {
  if (id !== props.containerId) return;
  stopPolling();
  resetBuffers();
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

function resetBuffers() {
  labels.value = [];
  cpuData.value = [];
  memData.value = [];
  memLimitData.value = [];
  netRxData.value = [];
  netTxData.value = [];
  blockReadData.value = [];
  blockWriteData.value = [];
  processHeaders.value = [];
  prevNetRx = -1;
  prevNetTx = -1;
  prevBlockR = -1;
  prevBlockW = -1;
  processes.value = [];
}

function startPolling() {
  if (!props.isContainerRunning || !props.containerId || !isMoby.value) return;
  ipcRenderer.send('container-stats/start', props.containerId, refreshSeconds.value, props.namespace);
}

function stopPolling() {
  if (props.containerId) {
    ipcRenderer.send('container-stats/stop', props.containerId);
  }
}

function restartPolling() {
  stopPolling();
  // Reset prev* so the first delta after a rate change is not a spike.
  prevNetRx = prevNetTx = prevBlockR = prevBlockW = -1;
  startPolling();
}

const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');

// readColors() needs statsChartsEl to be mounted; that element is inside v-else
// and only appears after the async isMoby store value resolves, so onMounted
// would fire too early. Watch the ref instead and call readColors() on first render.
watch(statsChartsEl, (el) => {
  if (el) readColors();
}, { once: true });

onMounted(() => {
  darkMQ.addEventListener('change', readColors);

  ipcRenderer.on('container-stats/data', handleStatsData);
  ipcRenderer.on('container-stats/processes', handleProcesses);
  ipcRenderer.on('container-stats/stopped', handleStopped);
  startPolling();
});

onBeforeUnmount(() => {
  darkMQ.removeEventListener('change', readColors);
  stopPolling();
  ipcRenderer.removeListener('container-stats/data', handleStatsData);
  ipcRenderer.removeListener('container-stats/processes', handleProcesses);
  ipcRenderer.removeListener('container-stats/stopped', handleStopped);
});

watch(() => props.containerId, () => {
  stopPolling();
  resetBuffers();
  startPolling();
});

watch(() => props.isContainerRunning, (running) => {
  resetBuffers();
  if (running) {
    startPolling();
  } else {
    stopPolling();
  }
});
</script>

<style lang="scss" scoped>
.container-stats-component {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  padding: 1rem;
  gap: 1rem;
}

.content-state {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 2.5rem;
}

.stats-toolbar {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.refresh-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 13px;
  color: var(--body-text);
}

.refresh-select {
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  background: var(--input-bg);
  color: var(--body-text);
  padding: 0.25rem 0.5rem;
  font-size: 13px;
  cursor: pointer;
}

.stats-charts {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.stat-card {
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  padding: 0.75rem 1rem 1rem;
  background: var(--body-bg);
}

.chart-title {
  margin: 0 0 0.5rem;
  font-size: 13px;
  font-weight: 600;
  color: var(--body-text);
}

.chart-wrapper {
  height: 120px;
  position: relative;
}

.processes-section {
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  padding: 0.75rem 1rem;
  background: var(--body-bg);
}

.section-title {
  margin: 0 0 0.75rem;
  font-size: 13px;
  font-weight: 600;
  color: var(--body-text);
}

.process-table-wrapper {
  overflow-x: auto;
}

.process-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-family: 'Courier New', monospace;

  th, td {
    padding: 4px 12px 4px 0;
    text-align: left;
    white-space: nowrap;
    color: var(--body-text);
    border-bottom: 1px solid var(--border);
  }

  th {
    color: var(--muted);
    font-weight: 600;
  }

  .cmd-cell {
    white-space: normal;
    word-break: break-all;
  }
}

.no-processes {
  color: var(--muted);
  font-size: 13px;
  margin: 0;
}
</style>
