<!--
  - This is the Images table in the K8s page.
  -->
<template>
  <div>
    <div v-if="state === 'READY'" ref="fullWindow">
      <SortableTable
        ref="imagesTable"
        class="imagesTable"
        :headers="headers"
        :rows="rows"
        key-field="_key"
        default-sort-by="imageName"
        :table-actions="false"
        :paging="true"
      >
        <template #header-left>
          <div v-if="supportsNamespaces">
            <label>Image Namespace:</label>
            <select class="select-namespace" :value="selectedNamespace" @change="handleChangeNamespace($event)">
              <option v-for="item in imageNamespaces" :key="item" :value="item" :selected="item === selectedNamespace">
                {{ item }}
              </option>
            </select>
          </div>
        </template>
        <template #header-middle>
          <Checkbox
            :value="showAll"
            :label="t('images.manager.table.label')"
            :disabled="!supportsShowAll"
            @input="handleShowAllCheckbox"
          />
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

<script>
import { ipcRenderer } from 'electron';

import Card from '@/components/Card.vue';
import SortableTable from '@/components/SortableTable';
import Checkbox from '@/components/form/Checkbox';
import getImageOutputCuller from '@/utils/imageOutputCuller';
import ImagesOutputWindow from '@/components/ImagesOutputWindow.vue';

export default {
  components: {
    Card,
    Checkbox,
    SortableTable,
    ImagesOutputWindow
  },
  props:      {
    images: {
      type:     Array,
      required: true,
    },
    imageNamespaces: {
      type:     Array,
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
      type:      String,
      default:   'IMAGE_MANAGER_UNREADY',
      validator: value => ['IMAGE_MANAGER_UNREADY', 'READY'].includes(value),
    },
    showAll: {
      type:    Boolean,
      default: false,
    },
  },

  data() {
    return {
      currentCommand:   null,
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
          sort:  ['size', 'imageName', 'tag'],
        },
      ],
      keepImageManagerOutputWindowOpen: false,
      imageOutputCuller:                null,
      mainWindowScroll:                 -1,
    };
  },
  computed: {
    keyedImages() {
      return this.images
        .map((image) => {
          return {
            ...image,
            _key: `${ image.imageID }-${ this.imageTag(image.tag) }`
          };
        });
    },
    filteredImages() {
      if (!this.supportsShowAll || this.showAll) {
        return this.keyedImages;
      }

      return this.keyedImages
        .filter(this.isDeletable);
    },
    rows() {
      return this.filteredImages
        .map((image) => {
          if (!image.availableActions) {
          // The `availableActions` property is used by the ActionMenu to fill
          // out the menu entries.  Note that we need to modify the items
          // in-place, as SortableTable depends on object identity to manage its
          // selection state.
            image.availableActions = [
              {
                label:   this.t('images.manager.table.action.push'),
                action:  'doPush',
                enabled: this.isPushable(image),
                icon:    'icon icon-upload',
              },
              {
                label:   this.t('images.manager.table.action.delete'),
                action:  'deleteImage',
                enabled: this.isDeletable(image),
                icon:    'icon icon-delete',
              },
              {
                label:   this.t('images.manager.table.action.scan'),
                action:  'scanImage',
                enabled: true,
                icon:    'icon icon-info',
              },
            ].filter(x => x.enabled);
          }
          // ActionMenu callbacks - SortableTable assumes that these methods live
          // on the rows directly.
          if (!image.doPush) {
            image.doPush = this.doPush.bind(this, image);
          }
          if (!image.deleteImage) {
            image.deleteImage = this.deleteImage.bind(this, image);
          }
          if (!image.scanImage) {
            image.scanImage = this.scanImage.bind(this, image);
          }

          return image;
        });
    },
    showImageManagerOutput() {
      return this.keepImageManagerOutputWindowOpen;
    },
    supportsShowAll() {
      return this.selectedNamespace === 'k8s.io';
    },
  },

  mounted() {
    this.main = document.getElementsByTagName('main')[0];
  },

  methods: {
    startImageManagerOutput() {
      this.keepImageManagerOutputWindowOpen = true;
      this.scrollToOutputWindow();
    },
    scrollToOutputWindow() {
      if (this.main) {
        // move to the bottom
        this.$nextTick(() => {
          this.main.scrollTop = this.main.scrollHeight;
        });
      }
    },
    scrollToTop() {
      this.$nextTick(() => {
        try {
          this.main.scrollTop = this.mainWindowScroll;
        } catch (e) {
          console.log(`Trying to reset scroll to ${ this.mainWindowScroll }, got error:`, e);
        }

        this.mainWindowScroll = -1;
      });
    },
    startRunningCommand(command) {
      this.imageOutputCuller = getImageOutputCuller(command);
    },
    async deleteImage(obj) {
      const options = {
        message:   `Delete image ${ obj.imageName }:${ obj.tag }?`,
        type:      'question',
        buttons:   ['Yes', 'No'],
        defaultId: 1,
        title:     'Confirming image deletion',
        cancelId:  1
      };
      const result = await ipcRenderer.invoke('show-message-box', options);

      if (result.response === 1) {
        return;
      }
      this.currentCommand = `delete ${ obj.imageName }:${ obj.tag }`;
      this.mainWindowScroll = this.main.scrollTop;
      this.startRunningCommand('delete');
      ipcRenderer.send('do-image-deletion', obj.imageName.trim(), obj.imageID.trim());
      this.startImageManagerOutput();
    },
    doPush(obj) {
      this.currentCommand = `push ${ obj.imageName }:${ obj.tag }`;
      this.mainWindowScroll = this.main.scrollTop;
      this.startRunningCommand('push');
      ipcRenderer.send('do-image-push', obj.imageName.trim(), obj.imageID.trim(), obj.tag.trim());
    },
    scanImage(obj) {
      const taggedImageName = `${ obj.imageName.trim() }:${ this.imageTag(obj.tag) }`;

      this.$router.push({ name: 'images-scans-image-name', params: { image: taggedImageName } });
    },
    imageTag(tag) {
      return tag === '<none>' ? 'latest' : `${ tag.trim() }`;
    },
    isDeletable(row) {
      return row.imageName !== 'moby/buildkit' && !row.imageName.startsWith('rancher/');
    },
    isPushable(row) {
      // If it doesn't contain a '/', it's certainly not pushable,
      // but having a '/' isn't sufficient, but it's all we have to go on.
      return this.isDeletable(row) && row.imageName.includes('/');
    },
    hasDropdownActions(row) {
      return this.isDeletable(row);
    },
    handleShowAllCheckbox(value) {
      this.$emit('toggledShowAll', value);
    },
    handleChangeNamespace(event) {
      this.$emit('switchNamespace', event.target.value);
    },
    resetCurrentCommand() {
      this.currentCommand = null;
    },
    toggleOutput(val) {
      this.keepImageManagerOutputWindowOpen = val;

      if (!val && this.mainWindowScroll >= 0) {
        this.scrollToTop();
      }
    }
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

  .imagesTable::v-deep tr.highlightFade {
    animation: highlightFade 1s;
  }

  .imagesTable::v-deep div.search {
    margin-top: 12px;
  }

  .imagesTable::v-deep .sortable-table-header .fixed-header-actions {
    align-items: end;
  }

  .imagesTable::v-deep .sortable-table-header .fixed-header-actions .middle {
    align-self: start;
    margin-top: 17px;
    padding-top: 11px;
  }

  .select-namespace {
    max-width: 24rem;
  }
</style>
