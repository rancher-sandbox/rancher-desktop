/* eslint-disable no-console */

// =========================================================================================
// Debug helper
// Adds a bunch of watches to help dignose computed properties bring re-evaluated
// =========================================================================================

export default {
  watch: {
    sortFields(neu, old) {
      console.log('sortFields changed ------------------------------------------------');
      console.log(neu);
      console.log(old);
    },

    descending(neu, old) {
      console.log('descending changed ------------------------------------------------');
      console.log(neu);
      console.log(old);
    },

    rows(neu, old) {
      console.log('rows changed ------------------------------------------------');
      console.log(neu.length);
      console.log(old.length);

      // console.log('Checking rows');

      // let diff = 0;

      // for (let i=0;i<neu.length;i++) {
      //   const a = JSON.stringify(neu[i]);
      //   const b = JSON.stringify(old[i]);

      //   if (a !== b) {
      //     console.log('rows differ ' + i);
      //     diff++;
      //   }
      // }

      // console.log(diff + ' rows changed');
    },

    pagingDisplay(neu, old) {
      console.log('pagingDisplay changed ------------------------------------------------');
      console.log(neu.length);
      console.log(old.length);
    },

    totalPages(neu, old) {
      console.log('totalPages changed ------------------------------------------------');
      console.log(neu.length);
      console.log(old.length);
    },

    pagedRows(neu, old) {
      console.log('pagedRows changed ------------------------------------------------');
      console.log(neu.length);
      console.log(old.length);
    },

    arrangedRows(neu, old) {
      console.log('arrangedRows changed ------------------------------------------------');
      console.log(neu.length);
      console.log(old.length);
    },

    searchFields(neu, old) {
      console.log('searchFields changed ------------------------------------------------');
      console.log(neu.length);
      console.log(old.length);
    },

    filteredRows(neu, old) {
      console.log('filteredRows changed ------------------------------------------------');
      console.log(neu.length);
      console.log(old.length);
    },

    groupedRows(neu, old) {
      console.log('groupedRows changed ------------------------------------------------');
      console.log(neu.length);
      console.log(old.length);
    },

    headers(neu, old) {
      console.log('headers changed ------------------------------------------------');
      console.log(neu);
      console.log(old);
    },

    displayRows(neu, old) {
      console.log('displayRows changed ------------------------------------------------');
      console.log(neu);
      console.log(old);
    },

    groupBy(neu, old) {
      console.log('groupBy changed ------------------------------------------------');
      console.log(neu);
      console.log(old);
    },

    groupSort(neu, old) {
      console.log('groupSort changed ------------------------------------------------');
      console.log(neu);
      console.log(old);
    },

    columns(neu, old) {
      console.log('columns changed ------------------------------------------------');
      console.log(neu);
      console.log(old);
    },
  }
};
/* eslint-enable no-console */
