import { get } from '@pkg/utils/object';
import { addObject, addObjects, isArray, removeAt } from '@pkg/utils/array';

export const ADV_FILTER_ALL_COLS_VALUE = 'allcols';
export const ADV_FILTER_ALL_COLS_LABEL = 'All Columns';
const LABEL_IDENTIFIER = ':::islabel';

export default {
  data() {
    return {
      searchQuery:    null,
      previousFilter: null,
      previousResult: null,
    };
  },

  computed: {
    searchFields() {
      const out = columnsToSearchField(this.columns);

      if ( this.extraSearchFields ) {
        addObjects(out, this.extraSearchFields);
      }

      return out;
    },

    /*
    subFields: computed('subHeaders.@each.{searchField,name}', 'extraSearchSubFields.[]', function() {
      let out = headersToSearchField(get(this, 'subHeaders'));

      return out.addObjects(get(this, 'extraSearchSubFields') || []);
    }),
    */
    filteredRows() {
      if (this.externalPaginationEnabled) {
        return;
      }

      // PROP hasAdvancedFiltering comes from Advanced Filtering mixin (careful changing data var there...)
      if (!this.hasAdvancedFiltering) {
        return this.handleFiltering();
      } else {
        return this.handleAdvancedFiltering();
      }
    },
  },

  methods: {
    handleAdvancedFiltering() {
      this.subMatches = null;

      if (this.searchQuery.length) {
        const out = (this.arrangedRows || []).slice();

        const res = out.filter((row) => {
          return this.searchQuery.every((f) => {
            if (f.prop === ADV_FILTER_ALL_COLS_VALUE) {
              // advFilterSelectOptions comes from Advanced Filtering mixin
              // remove the All Columns option from the list so that we don't iterate over it
              const allCols = this.advFilterSelectOptions.slice(1);
              let searchFields = [];

              allCols.forEach((col) => {
                if (col.value.includes('[') && col.value.includes(']')) {
                  searchFields = searchFields.concat(JSON.parse(col.value));
                } else {
                  // this means we are on the presence of a label, which should be dealt
                // carefully because of object path such row.metadata.labels."app.kubernetes.io/managed-by
                  const value = col.isLabel ? `${ col.label }${ LABEL_IDENTIFIER }` : col.value;

                  searchFields.push(value);
                }
              });

              return handleStringSearch(searchFields, [f.value], row);
            } else {
              if (f.prop.includes('[') && f.prop.includes(']')) {
                return handleStringSearch(JSON.parse(f.prop), [f.value], row);
              }

              let prop = f.prop;

              // this means we are on the presence of a label, which should be dealt
              // carefully because of object path such row.metadata.labels."app.kubernetes.io/managed-by"
              if (f.prop.includes('metadata.labels')) {
                prop = `${ f.label }${ LABEL_IDENTIFIER }`;
              }

              return handleStringSearch([prop], [f.value], row);
            }
          });
        });

        return res;
      }

      // return arrangedRows array if we don't have anything to search for...
      return this.arrangedRows;
    },

    handleFiltering() {
      const searchText = (this.searchQuery || '').trim().toLowerCase();
      let out;

      if ( searchText === this.previousFilter && this.previousResult ) {
        // If the search hasn't changed at all, just return the previous results
        // since otherwise we get into a loop due to Vue proxying everything.
        return this.previousResult;
      }

      if ( searchText && this.previousResult && searchText.startsWith(this.previousFilter) ) {
        // If the new search is an addition to the last one, we can start with the same set of results as last time
        // and filter those down, since adding more searchText can only reduce the number of results.
        out = this.previousResult.slice();
      } else {
        this.previousResult = null;
        out = (this.arrangedRows || []).slice();
      }

      this.previousFilter = searchText;

      if ( !searchText.length ) {
        this.subMatches = null;
        this.previousResult = null;

        return out;
      }

      const searchFields = this.searchFields;
      const searchTokens = searchText.split(/\s*[, ]\s*/);
      const subSearch = this.subSearch;
      const subFields = this.subFields;
      const subMatches = {};

      for ( let i = out.length - 1 ; i >= 0 ; i-- ) {
        const row = out[i];
        let hits = 0;
        let mainFound = true;

        mainFound = handleStringSearch(searchFields, searchTokens, row);

        if ( subFields && subSearch) {
          const subRows = row[subSearch] || [];

          for ( let k = subRows.length - 1 ; k >= 0 ; k-- ) {
            let subFound = true;

            subFound = handleStringSearch(subFields, searchTokens, row);

            if ( subFound ) {
              hits++;
            }
          }

          subMatches[get(row, this.keyField)] = hits;
        }

        if ( !mainFound && hits === 0 ) {
          removeAt(out, i);
        }
      }

      this.subMatches = subMatches;
      this.previousResult = out;

      return out;
    }
  },

  watch: {
    arrangedRows(q) {
      // The rows changed so the old filter result is no longer useful
      this.previousResult = null;
    },

    searchQuery() {
      this.debouncedPaginationChanged();
    },
  },
};

function columnsToSearchField(columns) {
  const out = [];

  (columns || []).forEach((column) => {
    const field = column.search;

    if ( field ) {
      if ( typeof field === 'string' ) {
        addObject(out, field);
      } else if ( isArray(field) ) {
        addObjects(out, field);
      }
    } else if ( field === false ) {
      // Don't add the name
    } else {
      // Use value/name as the default
      addObject(out, column.value || column.name);
    }
  });

  return out.filter((x) => !!x);
}

const ipLike = /^[0-9a-f\.:]+$/i;

function handleStringSearch(searchFields, searchTokens, row) {
  for ( let j = 0 ; j < searchTokens.length ; j++ ) {
    let expect = true;
    let token = searchTokens[j];

    if ( token.substr(0, 1) === '!' ) {
      expect = false;
      token = token.substr(1);
    }

    if ( token && matches(searchFields, token, row) !== expect ) {
      return false;
    }

    return true;
  }
}

function matches(fields, token, item) {
  for ( let field of fields ) {
    if ( !field ) {
      continue;
    }

    // some items might not even have metadata.labels or metadata.labels.something... ignore those items. Nothing to filter by
    if (typeof field !== 'function' &&
    field.includes(LABEL_IDENTIFIER) &&
    (!item.metadata.labels || !item.metadata.labels[field.replace(LABEL_IDENTIFIER, '')])) {
      continue;
    }

    let modifier;
    let val;

    if (typeof field === 'function') {
      val = field(item);
    } else if (field.includes(LABEL_IDENTIFIER)) {
      val = item.metadata.labels[field.replace(LABEL_IDENTIFIER, '')];
    } else {
      const idx = field.indexOf(':');

      if ( idx > 0 ) {
        modifier = field.substr(idx + 1);
        field = field.substr(0, idx);
      }

      if ( field.includes('.') ) {
        val = get(item, field);
      } else {
        val = item[field];
      }
    }

    if ( val === undefined ) {
      continue;
    }

    val = (`${ val }`).toLowerCase();
    if ( !val ) {
      continue;
    }

    if ( !modifier ) {
      if ( val.includes((`${ token }`).toLowerCase()) ) {
        return true;
      }
    } else if ( modifier === 'exact' ) {
      if ( val === token ) {
        return true;
      }
    } else if ( modifier === 'ip' ) {
      const tokenMayBeIp = ipLike.test(token);

      if ( tokenMayBeIp ) {
        const re = new RegExp(`(?:^|\\.)${ token }(?:\\.|$)`);

        if ( re.test(val) ) {
          return true;
        }
      }
    } else if ( modifier === 'prefix' ) {
      if ( val.indexOf(token) === 0) {
        return true;
      }
    }
  }

  return false;
}
