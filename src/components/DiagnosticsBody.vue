<script lang="ts">
import Vue from 'vue';

import BadgeState from '@/components/BadgeState.vue';
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
          name:  'name',
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
          name:          'The ~/.rd/bin directory has not been added to the PATH, so commandline utilities are not configured in your back shell',
          documentation: 'https://docs.rancherdesktop.io/',
          category:      'Kubernetes',
          mute:          false,
          description:   'You have selected manual PATH configuration, you can let Rancher Desktop automatically configure it.',
        },
        {
          id:            1,
          name:          'Are the files under ~/.docker/cli-plugins symlinks to ~/.rd/bin?',
          documentation: 'https://docs.rancherdesktop.io/',
          category:      'Kubernetes',
          mute:          false,
          description:   'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Proin sit amet iaculis diam. Nullam ut dolor nec dolor vestibulum viverra id a arcu.',
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
      <template #col:name="{row}">
        <td>
          <span class="font-semibold">{{ row.name }}</span>
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
          <td></td>
          <td class="sub-row">
            {{ row.description }}
          </td>
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
