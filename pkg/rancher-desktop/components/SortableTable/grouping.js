import { get } from '@pkg/utils/object';

export default {
  computed: {
    /**
     * The group config associated with the selected group
     */
    selectedGroupOption() {
      return this.groupOptions?.find((go) => go.value === this.group);
    },

    /**
     * Group counts based on all filtered rows (before collapse filtering)
     */
    groupCounts() {
      const groupKey = this.groupBy;
      if (!groupKey) {
        return {};
      }

      const counts = {};
      for (const obj of this.filteredRows) {
        const key = get(obj, groupKey) || '';
        counts[key] = (counts[key] || 0) + 1;
      }
      return counts;
    },

    groupedRows() {
      const groupKey = this.groupBy;
      const refKey = this.groupRef || this.selectedGroupOption?.groupLabelKey || groupKey;

      if ( !groupKey) {
        return [{
          key:  'default',
          ref:  'default',
          rows: this.pagedRows,
        }];
      }

      const out = [];
      const map = {};

      for ( const obj of this.pagedRows ) {
        const key = get(obj, groupKey) || '';
        const ref = get(obj, refKey);
        let entry = map[key];

        if ( entry ) {
          entry.rows.push(obj);
        } else {
          entry = {
            key,
            ref,
            rows: [obj],
          };
          map[key] = entry;
          out.push(entry);
        }
      }

      return out;
    },
  },
};
