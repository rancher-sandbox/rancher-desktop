import { get } from '@/utils/object';
import { addObject, addObjects, isArray, removeAt } from '@/utils/array';

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
      const searchText = (this.searchQuery || '').trim().toLowerCase();
      let out;

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

        for ( let j = 0 ; j < searchTokens.length ; j++ ) {
          let expect = true;
          let token = searchTokens[j];

          if ( token.substr(0, 1) === '!' ) {
            expect = false;
            token = token.substr(1);
          }

          if ( token && matches(searchFields, token, row) !== expect ) {
            mainFound = false;
            break;
          }
        }

        if ( subFields && subSearch) {
          const subRows = row[subSearch] || [];

          for ( let k = subRows.length - 1 ; k >= 0 ; k-- ) {
            let subFound = true;

            for ( let l = 0 ; l < searchTokens.length ; l++ ) {
              let expect = true;
              let token = searchTokens[l];

              if ( token.substr(0, 1) === '!' ) {
                expect = false;
                token = token.substr(1);
              }

              if ( matches(subFields, token, subRows[k]) !== expect ) {
                subFound = false;
                break;
              }
            }

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
    },
  },

  watch: {
    arrangedRows(q) {
      // The rows changed so the old filter result is no longer useful
      this.previousResult = null;
    }
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

  return out.filter(x => !!x);
}

const ipLike = /^[0-9a-f\.:]+$/i;

function matches(fields, token, item) {
  for ( let field of fields ) {
    if ( !field ) {
      continue;
    }

    let modifier;
    let val;

    if (typeof field === 'function') {
      val = field(item);
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
      if ( val.includes(token) ) {
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
