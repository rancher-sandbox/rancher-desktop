import { isMore, isRange, suppressContextMenu, isAlternate } from '@pkg/utils/platform';
import { get } from '@pkg/utils/object';
import { filterBy } from '@pkg/utils/array';
import { getParent } from '@pkg/utils/dom';

export const ALL = 'all';
export const SOME = 'some';
export const NONE = 'none';

export default {
  mounted() {
    const table = this.$el.querySelector('TABLE');

    this._onRowClickBound = this.onRowClick.bind(this);
    this._onRowMousedownBound = this.onRowMousedown.bind(this);
    this._onRowContextBound = this.onRowContext.bind(this);

    table.addEventListener('click', this._onRowClickBound);
    table.addEventListener('mousedown', this._onRowMousedownBound);
    table.addEventListener('contextmenu', this._onRowContextBound);
  },

  beforeDestroy() {
    const table = this.$el.querySelector('TABLE');

    table.removeEventListener('click', this._onRowClickBound);
    table.removeEventListener('mousedown', this._onRowMousedownBound);
    table.removeEventListener('contextmenu', this._onRowContextBound);
  },

  computed: {
    // Used for the table-level selection check-box to show checked (all selected)/intermediate (some selected)/unchecked (none selected)
    howMuchSelected() {
      const total = this.pagedRows.length;
      const selected = this.selectedRows.length;

      if ( selected >= total && total > 0 ) {
        return ALL;
      } else if ( selected > 0 ) {
        return SOME;
      }

      return NONE;
    },

    // NOTE: The logic here could be simplified and made more performant
    bulkActionsForSelection() {
      let disableAll = false;

      // pagedRows is all rows in the current page
      const all = this.pagedRows;
      const allRows = this.arrangedRows || all;
      let selected = this.selectedRows;

      // Nothing is selected
      if ( !this.selectedRows.length ) {
        // and there are no rows
        if ( !allRows ) {
          return [];
        }

        const firstNode = allRows[0];

        selected = firstNode ? [firstNode] : [];
        disableAll = true;
      }

      const map = {};

      // Find and add all the actions for all the nodes so that we know
      // what all the possible actions are
      for ( const node of all ) {
        if (node.availableActions) {
          for ( const act of node.availableActions ) {
            if ( act.bulkable ) {
              _add(map, act, false);
            }
          }
        }
      }

      // Go through all the selected items and add the actions (which were already identified above)
      // as available for some (or all) of the selected nodes
      for ( const node of selected ) {
        if (node.availableActions) {
          for ( const act of node.availableActions ) {
            if ( act.bulkable && act.enabled ) {
              _add(map, act, false);
            }
          }
        }
      }

      // If there's no items actually selected, we want to see all the actions
      // so you know what exists, but have them all be disabled since there's nothing to do them on.
      const out = _filter(map, disableAll);

      // Enable a bulkaction if some of the selected items can perform the action
      out.forEach((bulkAction) => {
        const actionEnabledForSomeSelected = this.selectedRows.some((node) => {
          const availableActions = node.availableActions || [];

          return availableActions.some((action) => action.action === bulkAction.action && action.enabled);
        });

        bulkAction.enabled = this.selectedRows.length > 0 && actionEnabledForSomeSelected;
      });

      return out.sort((a, b) => (b.weight || 0) - (a.weight || 0));
    }
  },

  data() {
    return {
      // List of selected items in the table
      selectedRows: [],
      prevNode:     null,
    };
  },

  watch: {
    // On page change
    pagedRows() {
      // When the table contents changes:
      // - Remove items that are in the selection but no longer in the table.

      const content = this.pagedRows;
      const toRemove = [];

      for (const node of this.selectedRows) {
        if (!content.includes(node) ) {
          toRemove.push(node);
        }
      }

      this.update([], toRemove);
    }
  },

  methods: {
    onToggleAll(value) {
      if ( value ) {
        this.update(this.pagedRows, []);

        return true;
      } else {
        this.update([], this.pagedRows);

        return false;
      }
    },

    onRowMousedown(e) {
      if ( isRange(e) || this.isSelectionCheckbox(e.target) ) {
        e.preventDefault();
      }
    },

    onRowMouseEnter(e) {
      const tr = e.target.closest('TR');

      if (tr.classList.contains('sub-row')) {
        const trMainRow = tr.previousElementSibling;

        trMainRow.classList.add('sub-row-hovered');
      }
    },

    onRowMouseLeave(e) {
      const tr = e.target.closest('TR');

      if (tr.classList.contains('sub-row')) {
        const trMainRow = tr.previousElementSibling;

        trMainRow.classList.remove('sub-row-hovered');
      }
    },

    nodeForEvent(e) {
      const tagName = e.target.tagName;
      const tgt = e.target;
      const actionElement = tgt.closest('.actions');

      if ( tgt.classList.contains('select-all-check') ) {
        return;
      }

      if ( !actionElement ) {
        if (
          tagName === 'A' ||
          tagName === 'BUTTON' ||
          getParent(tgt, '.btn')
        ) {
          return;
        }
      }

      const tgtRow = e.target.closest('TR');

      return this.nodeForRow(tgtRow);
    },

    nodeForRow(tgtRow) {
      if ( tgtRow?.classList.contains('separator-row') ) {
        return;
      }

      while ( tgtRow && !tgtRow.classList.contains('main-row') ) {
        tgtRow = tgtRow.previousElementSibling;
      }

      if ( !tgtRow ) {
        return;
      }

      const nodeId = tgtRow.dataset.nodeId;

      if ( !nodeId ) {
        return;
      }

      const node = this.pagedRows.find( (x) => get(x, this.keyField) === nodeId );

      return node;
    },

    async onRowClick(e) {
      const node = this.nodeForEvent(e);
      const td = e.target.closest('TD');
      const skipSelect = td?.classList.contains('skip-select');

      if (skipSelect) {
        return;
      }
      const selection = this.selectedRows;
      const isCheckbox = this.isSelectionCheckbox(e.target) || td?.classList.contains('row-check');
      const isExpand = td?.classList.contains('row-expand');
      const content = this.pagedRows;

      this.$emit('rowClick', e);

      if ( !node ) {
        return;
      }

      if ( isExpand ) {
        this.toggleExpand(node);

        return;
      }

      const actionElement = e.target.closest('.actions');

      if ( actionElement ) {
        let resources = [node];

        if ( this.mangleActionResources ) {
          const i = actionElement.querySelector('i');

          i.classList.remove('icon-actions');
          i.classList.add('icon-spinner');
          i.classList.add('icon-spin');

          try {
            resources = await this.mangleActionResources(resources);
          } finally {
            i.classList.remove('icon-spinner');
            i.classList.remove('icon-spin');
            i.classList.add('icon-actions');
          }
        }

        this.$store.commit(`action-menu/show`, {
          resources,
          event: e,
          elem:  actionElement
        });

        return;
      }

      const isSelected = selection.includes(node);
      let prevNode = this.prevNode;

      // PrevNode is only valid if it's in the current content
      if ( !prevNode || !content.includes(prevNode) ) {
        prevNode = node;
      }

      if ( isMore(e) ) {
        this.toggle(node);
      } else if ( isRange(e) ) {
        const toToggle = this.nodesBetween(prevNode, node);

        if ( isSelected ) {
          this.update([], toToggle);
        } else {
          this.update(toToggle, []);
        }
      } else if ( isCheckbox ) {
        this.toggle(node);
      } else {
        this.update([node], content);
      }

      this.prevNode = node;
    },

    async onRowContext(e) {
      const node = this.nodeForEvent(e);

      if ( suppressContextMenu(e) ) {
        return;
      }

      if ( !node ) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      this.prevNode = node;
      const isSelected = this.selectedRows.includes(node);

      if ( !isSelected ) {
        this.update([node], this.selectedRows.slice());
      }

      let resources = this.selectedRows;

      if ( this.mangleActionResources ) {
        resources = await this.mangleActionResources(resources);
      }

      this.$store.commit(`action-menu/show`, {
        resources,
        event: e,
      });
    },

    keySelectRow(row, more = false) {
      const node = this.nodeForRow(row);
      const content = this.pagedRows;

      if ( !node ) {
        return;
      }

      if ( more ) {
        this.update([node], []);
      } else {
        this.update([node], content);
      }

      this.prevNode = node;
    },

    isSelectionCheckbox(element) {
      return element.tagName === 'INPUT' &&
        element.type === 'checkbox' &&
        element.closest('.selection-checkbox') !== null;
    },

    nodesBetween(a, b) {
      let toToggle = [];
      const key = this.groupBy;

      if ( key ) {
        // Grouped has 2 levels to look through
        const grouped = this.groupedRows;

        let from = this.groupIdx(a);
        let to = this.groupIdx(b);

        if ( !from || !to ) {
          return [];
        }

        // From has to come before To
        if ( (from.group > to.group) || ((from.group === to.group) && (from.item > to.item)) ) {
          [from, to] = [to, from];
        }

        for ( let i = from.group ; i <= to.group ; i++ ) {
          const items = grouped[i].rows;
          let j = (from.group === i ? from.item : 0);

          while ( items[j] && ( i < to.group || j <= to.item )) {
            toToggle.push(items[j]);
            j++;
          }
        }
      } else {
        // Ungrouped is much simpler
        const content = this.pagedRows;
        let from = content.indexOf(a);
        let to = content.indexOf(b);

        [from, to] = [Math.min(from, to), Math.max(from, to)];
        toToggle = content.slice(from, to + 1);
      }

      // check if there is already duplicate content selected (selectedRows) on the list to toggle...
      toToggle = toToggle.filter((item) => !this.selectedRows.includes(item));

      return toToggle;
    },

    groupIdx(node) {
      const grouped = this.groupedRows;

      for ( let i = 0 ; i < grouped.length ; i++ ) {
        const rows = grouped[i].rows;

        for ( let j = 0 ; j < rows.length ; j++ ) {
          if ( rows[j] === node ) {
            return {
              group: i,
              item:  j
            };
          }
        }
      }

      return null;
    },

    toggle(node) {
      const add = [];
      const remove = [];

      if (this.selectedRows.includes(node)) {
        remove.push(node);
      } else {
        add.push(node);
      }

      this.update(add, remove);
    },

    update(toAdd, toRemove) {
      toRemove.forEach((row) => {
        const index = this.selectedRows.findIndex((r) => r === row);

        if (index !== -1) {
          this.selectedRows.splice(index, 1);
        }
      });

      if ( toAdd ) {
        this.selectedRows.push(...toAdd);
      }

      // Uncheck and check the checkboxes of nodes that have been added/removed
      if (toRemove.length) {
        this.$nextTick(() => {
          for ( let i = 0 ; i < toRemove.length ; i++ ) {
            this.updateInput(toRemove[i], false, this.keyField);
          }
        });
      }

      if (toAdd.length) {
        this.$nextTick(() => {
          for ( let i = 0 ; i < toAdd.length ; i++ ) {
            this.updateInput(toAdd[i], true, this.keyField);
          }
        });
      }

      this.$nextTick(() => {
        this.$emit('selection', this.selectedRows);
      });
    },

    updateInput(node, on, keyField) {
      const id = get(node, keyField);

      if ( id ) {
        // Note: This is looking for the checkbox control for the row
        const input = this.$el.querySelector(`div[data-checkbox-ctrl][data-node-id="${ id }"]`);

        if ( input && !input.disabled ) {
          const label = input.querySelector('label');

          if (label) {
            label.value = on;
          }
          let tr = input.closest('tr');
          let first = true;

          while ( tr && (first || tr.classList.contains('sub-row') ) ) {
            if (on) {
              tr.classList.add('row-selected');
            } else {
              tr.classList.remove('row-selected');
            }
            tr = tr.nextElementSibling;
            first = false;
          }
        }
      }
    },

    select(nodes) {
      nodes.forEach((node) => {
        const id = get(node, this.keyField);
        const input = this.$el.querySelector(`label[data-node-id="${ id }"]`);

        input.dispatchEvent(new Event('click'));
      });
    },

    applyTableAction(action, args, event) {
      const opts = { alt: event && isAlternate(event), event };

      // Go through the table selection and filter out those actions that can't run the chosen action
      const executableSelection = this.selectedRows.filter((row) => {
        const matchingResourceAction = row.availableActions.find((a) => a.action === action.action);

        return matchingResourceAction?.enabled;
      });

      _execute(executableSelection, action, args, opts, this);

      this.actionOfInterest = null;
    },

    clearSelection() {
      this.update([], this.selectedRows);
    },

  }
};

// ---------------------------------------------------------------------
// --- Helpers that were in selectionStore.js --------------------------
// ---------------------------------------------------------------------

let anon = 0;

function _add(map, act, incrementCounts = true) {
  let id = act.action;

  if ( !id ) {
    id = `anon${ anon }`;
    anon++;
  }

  let obj = map[id];

  if ( !obj ) {
    obj = Object.assign({}, act);
    map[id] = obj;
    obj.allEnabled = false;
  }

  if ( !act.enabled ) {
    obj.allEnabled = false;
  } else {
    obj.anyEnabled = true;
  }

  if ( incrementCounts ) {
    obj.available = (obj.available || 0) + (!act.enabled ? 0 : 1 );
    obj.total = (obj.total || 0) + 1;
  }

  return obj;
}

function _filter(map, disableAll = false) {
  const out = filterBy(Object.values(map), 'anyEnabled', true);

  for ( const act of out ) {
    if ( disableAll ) {
      act.enabled = false;
    } else {
      act.enabled = ( act.available >= act.total );
    }
  }

  return out;
}

function _execute(resources, action, args, opts = {}, ctx) {
  args = args || [];

  // New pattern for extensions - always call invoke
  if (action.invoke) {
    const actionOpts = {
      action,
      event: opts.event,
      isAlt: !!opts.alt,
    };

    return action.invoke.apply(ctx, [actionOpts, resources || [], args]);
  }

  if ( resources.length > 1 && action.bulkAction && !opts.alt ) {
    const fn = resources[0][action.bulkAction];

    if ( fn ) {
      return fn.call(resources[0], resources, ...args);
    }
  }

  const promises = [];

  for ( const resource of resources ) {
    let fn;

    if (opts.alt && action.altAction) {
      fn = resource[action.altAction];
    } else {
      fn = resource[action.action];
    }

    if ( fn ) {
      promises.push(fn.apply(resource, args));
    }
  }

  return Promise.all(promises);
}
