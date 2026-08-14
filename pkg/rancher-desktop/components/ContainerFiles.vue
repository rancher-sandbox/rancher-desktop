<template>
  <div class="container-files-component">
    <div class="files-toolbar">
      <div
        class="breadcrumbs"
        data-testid="files-breadcrumbs"
      >
        <button
          v-for="(crumb, i) in breadcrumbs"
          :key="crumb.path"
          class="crumb"
          :class="{ 'crumb-current': i === breadcrumbs.length - 1 }"
          type="button"
          @click="revealPath(crumb.path)"
        >
          {{ crumb.label }}<span
            v-if="i < breadcrumbs.length - 1"
            class="crumb-sep"
          >/</span>
        </button>
      </div>
      <button
        class="btn role-tertiary btn-sm"
        data-testid="files-refresh"
        :title="t('containerFiles.refresh')"
        type="button"
        @click="refresh"
      >
        <i
          aria-hidden="true"
          class="icon icon-refresh"
        />
      </button>
    </div>

    <div class="files-body">
      <div
        class="tree-pane"
        data-testid="files-tree"
      >
        <banner
          v-if="rootError"
          class="content-state"
          color="error"
          data-testid="files-error"
        >
          <span class="icon icon-info-circle icon-lg" />
          {{ rootError }}
        </banner>
        <div
          v-else-if="rootLoading"
          class="content-state muted"
        >
          {{ t('containerFiles.loading') }}
        </div>
        <ul
          v-else
          class="tree"
        >
          <li
            v-for="node in visibleNodes"
            :key="node.path"
            class="tree-row"
            :class="{ selected: node.path === selectedPath }"
            :style="{ paddingLeft: `${node.depth * 14 + 4}px` }"
            :data-testid="`files-node-${node.path}`"
            @click="onNodeClick(node)"
          >
            <span
              class="twisty"
              :class="{ invisible: node.type !== 'directory' }"
            >
              <i
                aria-hidden="true"
                class="icon"
                :class="node.loading ? 'icon-spinner icon-spin' : (node.expanded ? 'icon-chevron-down' : 'icon-chevron-right')"
              />
            </span>
            <i
              aria-hidden="true"
              class="icon type-icon"
              :class="iconFor(node)"
            />
            <span class="node-name">{{ node.name }}</span>
            <span
              v-if="node.type === 'symlink' && node.linkTarget"
              class="link-target"
            >→ {{ node.linkTarget }}</span>
            <span
              v-if="node.type === 'file'"
              class="node-size"
            >{{ formatBytes(node.size) }}</span>
          </li>
        </ul>
      </div>

      <div
        class="preview-pane"
        data-testid="files-preview"
      >
        <template v-if="selectedPath">
          <div class="preview-header">
            <span class="preview-path">{{ selectedPath }}</span>
            <button
              class="btn role-secondary btn-sm"
              data-testid="files-download"
              :disabled="downloading"
              type="button"
              @click="download"
            >
              {{ t('containerFiles.download') }}
            </button>
          </div>
          <div
            v-if="preview.loading"
            class="content-state muted"
          >
            {{ t('containerFiles.loading') }}
          </div>
          <banner
            v-else-if="preview.error"
            class="content-state"
            color="error"
          >
            <span class="icon icon-info-circle icon-lg" />
            {{ preview.error }}
          </banner>
          <div
            v-else-if="preview.encoding === 'base64'"
            class="content-state muted"
            data-testid="files-binary"
          >
            {{ t('containerFiles.binary') }}
          </div>
          <template v-else>
            <banner
              v-if="preview.truncated"
              class="truncation-note"
              color="info"
            >
              {{ t('containerFiles.truncated') }}
            </banner>
            <pre
              class="preview-content"
              data-testid="files-content"
            >{{ preview.content }}</pre>
          </template>
        </template>
        <div
          v-else
          class="content-state muted"
        >
          {{ t('containerFiles.selectPrompt') }}
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { Banner } from '@rancher/components';
import { ref, computed, onMounted, watch } from 'vue';
import { useStore } from 'vuex';

import type { ContainerFileEntry } from '@pkg/main/containerFiles';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

defineOptions({ name: 'ContainerFiles' });

const props = defineProps<{
  containerId:         string;
  isContainerRunning?: boolean;
  namespace?:          string;
}>();

const store = useStore();
const t = (key: string, args?: Record<string, unknown>) => store.getters['i18n/t'](key, args);

interface TreeNode extends ContainerFileEntry {
  path:      string;
  depth:     number;
  expanded:  boolean;
  loaded:    boolean;
  loading:   boolean;
  children?: TreeNode[];
}

const rootChildren = ref<TreeNode[]>([]);
const rootLoading = ref(true);
const rootError = ref<string | null>(null);
const selectedPath = ref<string | null>(null);

const preview = ref<{
  loading:   boolean;
  error:     string | null;
  content:   string;
  encoding:  'utf-8' | 'base64';
  truncated: boolean;
}>({
  loading: false, error: null, content: '', encoding: 'utf-8', truncated: false,
});
const downloading = ref(false);

function ipcOptions() {
  return { namespace: props.namespace, running: !!props.isContainerRunning };
}

function makeNode(entry: ContainerFileEntry, parentPath: string, depth: number): TreeNode {
  const path = parentPath === '/' ? `/${ entry.name }` : `${ parentPath }/${ entry.name }`;

  return {
    ...entry, path, depth, expanded: false, loaded: false, loading: false,
  };
}

function sortEntries(entries: ContainerFileEntry[]): ContainerFileEntry[] {
  // Directories first, then alphabetical (case-insensitive).
  return [...entries].sort((a, b) => {
    const aDir = a.type === 'directory' ? 0 : 1;
    const bDir = b.type === 'directory' ? 0 : 1;

    if (aDir !== bDir) {
      return aDir - bDir;
    }

    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

async function loadChildren(parentPath: string): Promise<TreeNode[]> {
  const result = await ipcRenderer.invoke('container-files/list', props.containerId, parentPath, ipcOptions());
  const depth = parentPath === '/' ? 0 : parentPath.split('/').length - 1;

  return sortEntries(result.entries).map(entry => makeNode(entry, parentPath, depth));
}

async function loadRoot() {
  rootLoading.value = true;
  rootError.value = null;
  rootChildren.value = [];
  selectedPath.value = null;
  try {
    rootChildren.value = await loadChildren('/');
  } catch (ex: any) {
    rootError.value = ex?.message ? String(ex.message) : t('containerFiles.errors.list');
  } finally {
    rootLoading.value = false;
  }
}

async function toggle(node: TreeNode) {
  if (node.type !== 'directory') {
    return;
  }
  if (node.expanded) {
    node.expanded = false;

    return;
  }
  if (!node.loaded) {
    node.loading = true;
    try {
      node.children = await loadChildren(node.path);
      node.loaded = true;
    } catch (ex: any) {
      node.children = [];
      node.loaded = true;
      console.error(`Failed to list ${ node.path }:`, ex);
    } finally {
      node.loading = false;
    }
  }
  node.expanded = true;
}

async function onNodeClick(node: TreeNode) {
  if (node.type === 'directory') {
    await toggle(node);

    return;
  }
  // v1 limitation: symlinks (including directory symlinks such as the usrmerge
  // /bin -> /usr/bin) are treated as previewable leaves rather than being
  // followed/expanded. Making dir-symlinks browsable is tracked as a follow-up.
  selectedPath.value = node.path;
  await loadPreview(node.path);
}

async function loadPreview(filePath: string) {
  preview.value = {
    loading: true, error: null, content: '', encoding: 'utf-8', truncated: false,
  };
  try {
    const result = await ipcRenderer.invoke('container-files/read', props.containerId, filePath, ipcOptions());

    preview.value = {
      loading:   false,
      error:     null,
      content:   result.content,
      encoding:  result.encoding,
      truncated: result.truncated,
    };
  } catch (ex: any) {
    preview.value = {
      loading:   false,
      error:     ex?.message ? String(ex.message) : t('containerFiles.errors.read'),
      content:   '',
      encoding:  'utf-8',
      truncated: false,
    };
  }
}

async function download() {
  if (!selectedPath.value) {
    return;
  }
  downloading.value = true;
  try {
    await ipcRenderer.invoke('container-files/download', props.containerId, selectedPath.value, false, ipcOptions());
  } catch (ex) {
    console.error('Download failed:', ex);
  } finally {
    downloading.value = false;
  }
}

/**
 * Expand the tree down to (and including) the given directory path, loading
 * intermediate levels as needed.
 */
async function revealPath(target: string) {
  if (target === '/') {
    return;
  }
  const segments = target.split('/').filter(Boolean);
  let list = rootChildren.value;
  let current = '';

  for (const segment of segments) {
    current += `/${ segment }`;
    const node = list.find(n => n.name === segment);

    if (node?.type !== 'directory') {
      break;
    }
    if (!node.loaded) {
      await toggle(node);
    } else {
      node.expanded = true;
    }
    list = node.children ?? [];
  }
}

const visibleNodes = computed<TreeNode[]>(() => {
  const out: TreeNode[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      out.push(node);
      if (node.type === 'directory' && node.expanded && node.children) {
        walk(node.children);
      }
    }
  };

  walk(rootChildren.value);

  return out;
});

const breadcrumbs = computed(() => {
  const crumbs = [{ label: '/', path: '/' }];

  if (selectedPath.value) {
    const segments = selectedPath.value.split('/').filter(Boolean);
    let current = '';

    for (const segment of segments) {
      current += `/${ segment }`;
      crumbs.push({ label: segment, path: current });
    }
  }

  return crumbs;
});

function iconFor(node: TreeNode): string {
  switch (node.type) {
  case 'directory':
    return node.expanded ? 'icon-folder-open' : 'icon-folder';
  case 'symlink':
    return 'icon-external-link';
  default:
    return 'icon-file';
  }
}

function formatBytes(b: number): string {
  if (b >= 1024 ** 3) {
    return `${ (b / 1024 ** 3).toFixed(1) } GiB`;
  }
  if (b >= 1024 ** 2) {
    return `${ (b / 1024 ** 2).toFixed(1) } MiB`;
  }
  if (b >= 1024) {
    return `${ (b / 1024).toFixed(1) } KiB`;
  }

  return `${ b } B`;
}

function refresh() {
  loadRoot();
}

onMounted(loadRoot);

watch(() => props.containerId, loadRoot);
</script>

<style lang="scss" scoped>
.container-files-component {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  flex: 1;
}

.files-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.breadcrumbs {
  flex: 1;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  font-size: 13px;
  overflow: hidden;
}

.crumb {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--link);
  font-size: 13px;

  &.crumb-current {
    color: var(--body-text);
    cursor: default;
  }
}

.crumb-sep {
  color: var(--muted);
  margin: 0 0.25rem;
}

.btn-sm {
  padding: 0.15rem 0.5rem;
  min-height: 28px;
}

.files-body {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

.tree-pane {
  width: 45%;
  min-width: 240px;
  overflow: auto;
  border-right: 1px solid var(--border);
}

.tree {
  list-style: none;
  margin: 0;
  padding: 0.25rem 0;
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 2px 8px 2px 0;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  color: var(--body-text);

  &:hover {
    background: var(--nav-hover, var(--dropdown-hover-bg, rgba(0, 0, 0, 0.05)));
  }

  &.selected {
    background: var(--primary-hover-bg, rgba(0, 0, 0, 0.08));
  }
}

.twisty {
  width: 14px;
  display: inline-flex;
  justify-content: center;
  color: var(--muted);
  flex-shrink: 0;

  &.invisible {
    visibility: hidden;
  }

  .icon {
    font-size: 10px;
  }
}

.type-icon {
  color: var(--muted);
  flex-shrink: 0;
}

.node-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.link-target {
  color: var(--muted);
  font-style: italic;
}

.node-size {
  margin-left: auto;
  padding-left: 1rem;
  color: var(--muted);
  font-size: 12px;
  flex-shrink: 0;
}

.preview-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.preview-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.preview-path {
  flex: 1;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--body-text);
}

.truncation-note {
  margin: 0.5rem;
  flex-shrink: 0;
}

.preview-content {
  flex: 1;
  margin: 0;
  padding: 0.75rem;
  overflow: auto;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre;
  color: var(--body-text);
}

.content-state {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 2rem;
  gap: 0.5rem;

  &.muted {
    color: var(--muted);
    font-size: 13px;
  }
}
</style>
