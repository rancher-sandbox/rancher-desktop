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
        {
          name:  'mute',
          label: 'Mute',
        },
      ],
      rows: [
        {
          name:          'The ~/.rd/bin directory has not been added to the PATH, so commandline utilities are not configured in your back shell',
          documentation: 'Some link',
          category:      'kubernetes',
          mute:          false,
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
        6 failed (0 muted) Hide muted
      </div>
      <div class="diagnostics-status-history">
        Last run: 52 minutes ago
      </div>
    </div>
    <sortable-table
      :headers="headers"
      :rows="rows"
      :search="false"
      :table-actions="false"
      :row-actions="false"
      :sub-rows="true"
      :sub-expandable="true"
      :sub-expand-column="true"
    >
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
        flex: 1;
      }
    }
  }
</style>
