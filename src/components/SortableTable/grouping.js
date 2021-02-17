import { get } from '@/utils/object';

export default {
  computed: {
    groupedRows() {
      const groupKey = this.groupBy;
      const refKey = this.groupRef || groupKey;

      if ( !groupKey) {
        return [{
          key:  'default',
          ref:  'default',
          rows: this.pagedRows,
        }];
      }

      const out = [];
      const map = {};

      for ( let i = 0 ; i < this.pagedRows.length ; i++ ) {
        const obj = this.pagedRows[i];
        const key = get(obj, groupKey) || '';
        const ref = get(obj, refKey);
        let entry = map[key];

        if ( entry ) {
          entry.rows.push(obj);
        } else {
          entry = {
            key,
            ref,
            rows: [obj]
          };
          map[key] = entry;
          out.push(entry);
        }
      }

      return out;
    }
  }
};
