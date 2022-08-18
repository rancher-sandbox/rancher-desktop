<script lang="ts">
// TODO: #2753 [diagnostics] Remove @ts-ignore for BadgeState import
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore: No exported member
import { BadgeState } from '@rancher/components';
import Vue from 'vue';

import SortableTable from '@/components/SortableTable/index.vue';

export default Vue.extend({
  name:       'DiagnosticsBody',
  components: {
    SortableTable,
    BadgeState,
  },
  data() {
    return {
      headers: [
        {
          name:  'description',
          label: 'Name',
        },
        {
          name:  'documentation',
          label: 'Documentation',
        },
        {
          name:  'category',
          label: 'Category',
        },
      ],
      rows: [
        {
          id:            0,
          description:   'The ~/.rd/bin directory has not been added to the PATH, so commandline utilities are not configured in your back shell',
          documentation: 'https://docs.rancherdesktop.io/',
          category:      'Kubernetes',
          mute:          false,
          fixes:         { description: 'You have selected manual PATH configuration, you can let Rancher Desktop automatically configure it.' },
        },
        {
          id:            1,
          description:   'Are the files under ~/.docker/cli-plugins symlinks to ~/.rd/bin?',
          documentation: 'https://docs.rancherdesktop.io/',
          category:      'Kubernetes',
          mute:          false,
          fixes:         { description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Proin sit amet iaculis diam. Nullam ut dolor nec dolor vestibulum viverra id a arcu.' },
        },
      ],
    };
  },
});
</script>

<template>
  <div class="diagnostics">
    <div class="status">
      <div class="item-results">
        <span class="icon icon-dot text-error" />6 failed (0 muted)
      </div>
      <div class="diagnostics-status-history">
        Last run: 52 minutes ago
      </div>
    </div>
    <sortable-table
      key-field="id"
      :headers="headers"
      :rows="rows"
      :search="false"
      :table-actions="false"
      :row-actions="false"
      :sub-rows="true"
      :sub-expandable="true"
      :sub-expand-column="true"
    >
      <template #col:description="{row}">
        <td>
          <span class="font-semibold">{{ row.description }}</span>
        </td>
      </template>
      <template #col:documentation="{row}">
        <td>
          <a :href="row.documentation"><span class="icon icon-external-link" /></a>
        </td>
      </template>
      <template #col:category="{row}">
        <td>
          <badge-state
            :label="row.category"
            color="bg-warning"
          />
        </td>
      </template>
      <template #sub-row="{row}">
        <tr>
          <!--We want an empty data cell so description will align with name-->
          <td></td>
          <td class="sub-row">
            {{ row.fixes.description }}
          </td>
          <!--Empty data cells for remaining columns for row highlight-->
          <td v-for="header in headers.length - 1" :key="header.name" />
        </tr>
      </template>
    </sortable-table>
  </div>
</template>

<style lang="scss" scoped>
  .diagnostics {
    display: flex;
    flex-direction: column;
    gap: 2rem;

    .status {
      display: flex;

      .item-results {
        display: flex;
        flex: 1;
        gap: 0.5rem;
      }
    }

    .font-semibold {
      font-weight: 600;
    }
  }
</style>
