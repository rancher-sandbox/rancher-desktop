<!--
  - This is the Images table in the K8s page.
  -->
<template>
  <div>
    <div
      v-if="state === 'READY'"
      ref="fullWindow"
    >
      <SortableTable
        ref="imagesTable"
        class="imagesTable"
        data-test="imagesTableRows"
        key-field="_key"
        default-sort-by="imageName"
        :headers="headers"
        :rows="rows"
        no-rows-key="images.sortableTables.noRows"
        :table-actions="true"
        :paging="true"
        @selection="updateSelection"
      >
        <template #header-middle>
          <div class="header-middle">
            <Checkbox
              class="all-images"
              :value="showAll"
              :label="t('images.manager.table.label')"
              :disabled="!supportsShowAll"
              @update:value="handleShowAllCheckbox"
            />
            <div v-if="supportsNamespaces">
              <label>Namespace</label>
              <select
                class="select-namespace"
                :value="selectedNamespace"
                @change="handleChangeNamespace($event)"
              >
                <option
                  v-for="item in imageNamespaces"
                  :key="item"
                  :value="item"
                  :selected="item === selectedNamespace"
                >
                  {{ item }}
                </option>
              </select>
            </div>
          </div>
        </template>
        <!-- The SortableTable component puts the Filter box goes in the #header-right slot
             Too bad, because it means we can't use a css grid to manage the relative
             positions of these three widgets
        -->
      </SortableTable>

      <Card
        v-if="showImageManagerOutput"
        :show-highlight-border="false"
        :show-actions="false"
      >
        <template #title>
          <div class="type-title">
            <h3>{{ t('images.manager.title') }}</h3>
          </div>
        </template>
        <template #body>
          <images-output-window
            id="imageManagerOutput"
            ref="image-output-window"
            :current-command="currentCommand"
            :image-output-culler="imageOutputCuller"
            :show-status="false"
            :image-to-pull="imageToPull"
            @ok:process-end="resetCurrentCommand"
            @ok:show="toggleOutput"
          />
        </template>
      </Card>
    </div>
    <div v-else>
      <h3 v-if="state === 'IMAGE_MANAGER_UNREADY'">
        {{ t('images.state.imagesUnready') }}
      </h3>
      <h3 v-else>
        {{ t('images.state.unknown') }}
      </h3>
    </div>
  </div>
</template>

<script lang="ts">
import { Card, Checkbox } from '@rancher/components';
import _ from 'lodash';
import { PropType } from 'vue';
import { mapMutations } from 'vuex';

import ImagesOutputWindow from '@pkg/components/ImagesOutputWindow.vue';
import SortableTable from '@pkg/components/SortableTable';
import { mapTypedState } from '@pkg/entry/store';
import type { IpcRendererEvents } from '@pkg/typings/electron-ipc';
import getImageOutputCuller from '@pkg/utils/imageOutputCuller';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';
import { parseSi } from '@pkg/utils/units';

type Image = Parameters<IpcRendererEvents['images-changed']>[0][number];

type RowItem = Image & {
  availableActions: {
    label:       string;
    action:      string;
    enabled:     boolean;
    icon:        string;
    bulkable?:   boolean;
    bulkAction?: string;
  }[];
  doPush:       () => void;
  deleteImage:  () => Promise<void>;
  deleteImages: () => Promise<void>;
  scanImage:    () => void;
};

export default {
  components: {
    Card,
    Checkbox,
    SortableTable,
    ImagesOutputWindow,
  },
  props: {
    images: {
      type:     Array as PropType<Image[]>,
      required: true,
    },
    protectedImages: {
      type:    Array as PropType<string[]>,
      default: () => [],
    },
    imageNamespaces: {
      type:     Array as PropType<string[]>,
      required: true,
    },
    selectedNamespace: {
      type:    String,
      default: 'default',
    },
    supportsNamespaces: {
      type:    Boolean,
      default: false,
    },
    state: {
      type:      String as PropType<'IMAGE_MANAGER_UNREADY' | 'READY'>,
      default:   'IMAGE_MANAGER_UNREADY',
      validator: (value: string) => ['IMAGE_MANAGER_UNREADY', 'READY'].includes(value),
    },
    showAll: {
      type:    Boolean,
      default: false,
    },
  },

  data() {
    return {
      currentCommand: null as string | null,
      headers:
      [
        {
          name:  'imageName',
          label: this.t('images.manager.table.header.imageName'),
          sort:  ['imageName', 'tag', 'imageID'],
        },
        {
          name:  'tag',
          label: this.t('images.manager.table.header.tag'),
          sort:  ['tag', 'imageName', 'imageID'],
        },
        {
          name:  'imageID',
          label: this.t('images.manager.table.header.imageId'),
          sort:  ['imageID', 'imageName', 'tag'],
        },
        {
          name:  'size',
          label: this.t('images.manager.table.header.size'),
          sort:  ['si', 'imageName', 'tag'],
        },
      ],
      keepImageManagerOutputWindowOpen: false,
      imageOutputCuller:                null as ReturnType<typeof getImageOutputCuller> | null,
      mainWindowScroll:                 -1,
      selected:                         [] as RowItem[],
      imageToPull:                      null,
    };
  },
  computed: {
    ...mapTypedState('action-menu', { menuImages: state => state.resources?.map((i: RowItem) => i.imageName) ?? [] }),
    main() {
      return document.getElementsByTagName('main')[0];
    },
    keyedImages() {
      return this.images
        .map((image, index) => {
          return {
            ...image,
            si:   parseSi(image.size),
            _key: `${ index }-${ image.imageID }-${ this.imageTag(image.tag) }`,
          };
        });
    },
    filteredImages() {
      // Images with '<none>' or empty name are not allowed at the moment.
      const filteredImages = this.keyedImages.filter(this.isNotNoneImage);

      if (!this.supportsShowAll || this.showAll) {
        return filteredImages;
      }

      return filteredImages
        .filter(this.isDeletable);
    },
    imagesToDelete() {
      return this.selected.filter(image => this.isDeletable(image));
    },
    imageIdsToDelete() {
      return this.imagesToDelete
        .map(this.getTaggedImage);
    },
    rows(): RowItem[] {
      const filteredImages = _.cloneDeep(this.filteredImages);

      return filteredImages
        .map<RowItem>((image: Image & Partial<RowItem>) => ({
          ...image,
          // The `availableActions` property is used by the ActionMenu to fill
          // out the menu entries.  Note that we need to modify the items
          // in-place, as SortableTable depends on object identity to manage its
          // selection state.
          availableActions: [
            {
              label:   this.t('images.manager.table.action.push'),
              action:  'doPush',
              enabled: this.isPushable(image),
              icon:    'icon icon-upload',
            },
            {
              label:      this.t('images.manager.table.action.delete'),
              action:     'deleteImage',
              enabled:    this.isDeletable(image),
              icon:       'icon icon-delete',
              bulkable:   true,
              bulkAction: 'deleteImages',
            },
            {
              label:   this.t('images.manager.table.action.scan'),
              action:  'scanImage',
              enabled: true,
              icon:    'icon icon-info-circle',
            },
          ].filter(x => x.enabled),
          // ActionMenu callbacks - SortableTable assumes that these methods live
          // on the rows directly.
          doPush:       image.doPush ?? this.doPush.bind(this, image),
          deleteImage:  image.deleteImage ?? this.deleteImage.bind(this, image),
          deleteImages: image.deleteImages ?? this.deleteImages.bind(this),
          scanImage:    image.scanImage ?? this.scanImage.bind(this, image),
        }));
    },
    showImageManagerOutput() {
      return this.keepImageManagerOutputWindowOpen;
    },
    supportsShowAll() {
      return this.selectedNamespace === 'k8s.io';
    },
  },

  watch: {
    rows: {
      handler(newRows: RowItem[]) {
        if (this.menuImages.some(name => newRows.map(r => r.imageName).includes(name))) {
          this.hideMenu();
        }
      },
      deep: true,
    },
  },

  methods: {
    ...mapMutations('action-menu', { hideMenu: 'hide' }),
    updateSelection(val: RowItem[]) {
      this.selected = val;
    },
    startImageManagerOutput() {
      this.keepImageManagerOutputWindowOpen = true;
      this.scrollToOutputWindow();
    },
    scrollToOutputWindow() {
      this.$nextTick(() => {
        if (this.main) {
          // move to the bottom
          this.main.scrollTop = this.main.scrollHeight;
        }
      });
    },
    scrollToTop() {
      this.$nextTick(() => {
        if (this.main) {
          try {
            this.main.scrollTop = this.mainWindowScroll;
          } catch (e) {
            console.log(`Trying to reset scroll to ${ this.mainWindowScroll }, got error:`, e);
          }
        }

        this.mainWindowScroll = -1;
      });
    },
    startRunningCommand(command: Parameters<typeof getImageOutputCuller>[0]) {
      this.imageOutputCuller = getImageOutputCuller(command);
    },
    async deleteImages() {
      const message = `Delete ${ this.imagesToDelete.length } ${ this.imagesToDelete.length > 1 ? 'images' : 'image' }?`;
      const detail = this.imageIdsToDelete.join('\n');

      const options: Electron.MessageBoxOptions = {
        message,
        detail,
        type:      'question',
        buttons:   ['Yes', 'No'],
        defaultId: 1,
        title:     'Confirming image deletion',
        cancelId:  1,
      };

      const result = await ipcRenderer.invoke('show-message-box', options);

      if (result.response === 1) {
        return;
      }

      this.currentCommand = `delete ${ this.imageIdsToDelete }`;
      this.mainWindowScroll = this.main.scrollTop;
      this.startRunningCommand('delete');
      ipcRenderer.send('do-image-deletion-batch', this.imageIdsToDelete);
      this.startImageManagerOutput();
    },
    async deleteImage(obj: Image) {
      const options: Electron.MessageBoxOptions = {
        message:   `Delete image ${ obj.imageName }:${ obj.tag }?`,
        type:      'question',
        buttons:   ['Yes', 'No'],
        defaultId: 1,
        title:     'Confirming image deletion',
        cancelId:  1,
      };
      const result = await ipcRenderer.invoke('show-message-box', options);

      if (result.response === 1) {
        return;
      }
      this.currentCommand = `delete ${ obj.imageName }:${ obj.tag }`;
      this.mainWindowScroll = this.main.scrollTop;
      this.startRunningCommand('delete');

      ipcRenderer.send('do-image-deletion', obj.imageName.trim(), this.getTaggedImage(obj));

      this.startImageManagerOutput();
    },
    doPush(obj: Image) {
      this.currentCommand = `push ${ obj.imageName }:${ obj.tag }`;
      this.mainWindowScroll = this.main.scrollTop;
      this.startRunningCommand('push');
      ipcRenderer.send('do-image-push', obj.imageName.trim(), obj.imageID.trim(), obj.tag.trim());
    },
    scanImage(obj: Image) {
      const taggedImageName = `${ obj.imageName.trim() }:${ this.imageTag(obj.tag) }`;

      this.$router.push({ name: 'images-scans-image-name', params: { image: taggedImageName, namespace: this.selectedNamespace } });
    },
    imageTag(tag: string) {
      return tag === '<none>' ? 'latest' : `${ tag.trim() }`;
    },
    isNotNoneImage(row: Image) {
      return row.imageName && row.imageName !== '<none>';
    },
    isDeletable(row: Image) {
      return !this.protectedImages.includes(row.imageName);
    },
    isPushable(row: Image) {
      // If it doesn't contain a '/', it's certainly not pushable,
      // but having a '/' isn't sufficient, but it's all we have to go on.
      return this.isDeletable(row) && row.imageName.includes('/');
    },
    hasDropdownActions(row: Image) {
      return this.isDeletable(row);
    },
    handleShowAllCheckbox(value: boolean) {
      this.$emit('toggledShowAll', value);
    },
    handleChangeNamespace(event: Event) {
      this.$emit('switchNamespace', (event.target as HTMLSelectElement).value);
    },
    resetCurrentCommand() {
      this.currentCommand = null;
    },
    toggleOutput(val: boolean) {
      this.keepImageManagerOutputWindowOpen = val;

      if (!val && this.mainWindowScroll >= 0) {
        this.scrollToTop();
      }
    },
    getTaggedImage(image: Image) {
      return image.tag !== '<none>' ? `${ image.imageName }:${ image.tag }` : `${ image.imageName }@${ image.digest }`;
    },
  },
};
</script>

<style lang="scss" scoped>
  .labeled-input > .btn {
    position: absolute;
    bottom: -1px;
    right: -1px;
    border-start-start-radius: var(--border-radius);
    border-radius: var(--border-radius) 0 0 0;
  }

  @keyframes highlightFade {
    from {
      background: var(--accent-btn);
    } to {
      background: transparent;
    }
  }

  .select-namespace {
    max-width: 24rem;
    min-width: 8rem;
  }

  .header-middle {
    display: flex;
    align-items: flex-end;
    gap: 1rem;
    height: 100%;
  }

  .all-images {
    margin-bottom: 12px;
  }

  .imagesTable :deep(.search-box) {
    align-self: flex-end;
  }
  .imagesTable :deep(.bulk) {
    align-self: flex-end;
  }
</style>
