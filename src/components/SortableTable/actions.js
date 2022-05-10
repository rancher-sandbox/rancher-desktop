import debounce from 'lodash/debounce';

// Use a visible display type to reduce flickering
const displayType = 'inline-block';

export default {

  data() {
    return {
      bulkActionsClass:            'bulk',
      bulkActionClass:             'bulk-action',
      bulkActionsDropdownClass:    'bulk-actions-dropdown',
      bulkActionAvailabilityClass: 'action-availability',

      hiddenActions: [],
    };
  },

  beforeDestroy() {
    window.removeEventListener('resize', this.onWindowResize);
  },

  mounted() {
    window.addEventListener('resize', this.onWindowResize);
    this.updateHiddenBulkActions();
  },

  watch: {
    selectedRows() {
      this.updateHiddenBulkActions();
    },
    keyedAvailableActions() {
      this.updateHiddenBulkActions();
    },
  },

  computed: {
    availableActions() {
      return this.bulkActionsForSelection.filter(act => !act.external);
    },

    keyedAvailableActions() {
      return this.availableActions.map(aa => aa.action);
    },

    selectedRowsText() {
      if (!this.selectedRows.length) {
        return null;
      }

      return this.t('sortableTable.actionAvailability.selected', { actionable: this.selectedRows.length });
    },

    // Shows a tooltip if the bulk action that the user is hovering over can not be applied to all selected rows
    actionTooltip() {
      if (!this.selectedRows.length || !this.actionOfInterest) {
        return null;
      }

      const runnableTotal = this.selectedRows.filter(this.canRunBulkActionOfInterest).length;

      if (runnableTotal === this.selectedRows.length) {
        return null;
      }

      return this.t('sortableTable.actionAvailability.some', {
        actionable: runnableTotal,
        total:      this.selectedRows.length,
      });
    },
  },

  methods: {
    onWindowResize() {
      this.updateHiddenBulkActions();
      this.onScroll();
    },

    /**
     * Determine if any actions wrap over to a new line, if so group them into a dropdown instead
     */
    updateHiddenBulkActions: debounce(function() {
      if (!this.$refs.container) {
        return;
      }

      const actionsContainer = this.$refs.container.querySelector(`.${ this.bulkActionsClass }`);
      const actionsDropdown = this.$refs.container.querySelector(`.${ this.bulkActionsDropdownClass }`);

      if (!actionsContainer || !actionsDropdown) {
        return;
      }

      const actionsContainerWidth = actionsContainer.offsetWidth;
      const actionsHTMLCollection = this.$refs.container.querySelectorAll(`.${ this.bulkActionClass }`);
      const actions = Array.from(actionsHTMLCollection || []);

      // Determine if the 'x selected' label should show and it's size
      const selectedRowsText = this.$refs.container.querySelector(`.${ this.bulkActionAvailabilityClass }`);
      let selectedRowsTextWidth = 0;

      if (this.selectedRowsText) {
        if (selectedRowsText) {
          selectedRowsText.style.display = displayType;
          selectedRowsTextWidth = selectedRowsText.offsetWidth;
        } else {
          selectedRowsText.style.display = 'none;';
        }
      }

      this.hiddenActions = [];

      let cumulativeWidth = 0;
      let showActionsDropdown = false;
      let totalAvailableWidth = actionsContainerWidth - selectedRowsTextWidth;

      // Loop through all actions to determine if some exceed the available space in the row, if so hide them and instead show in a dropdown
      for (let i = 0; i < actions.length; i++) {
        const ba = actions[i];

        ba.style.display = displayType;
        const actionWidth = ba.offsetWidth;

        cumulativeWidth += actionWidth + 15;
        if (cumulativeWidth >= totalAvailableWidth) {
          // There are too many actions so the drop down will be visible.
          if (!showActionsDropdown) {
            // If we haven't previously enabled the drop down...
            actionsDropdown.style.display = displayType;
            // By showing the drop down some previously visible actions may now be hidden, so start the process again
            // ... except taking into account the width of drop down width in the available space
            i = -1;
            cumulativeWidth = 0;
            showActionsDropdown = true;
            totalAvailableWidth = actionsContainerWidth - actionsDropdown.offsetWidth - selectedRowsTextWidth;
          } else {
            // Collate the actions in an array and hide in the normal row
            const id = ba.attributes.getNamedItem('id').value;

            this.hiddenActions.push(this.availableActions.find(aa => aa.action === id));
            ba.style.display = 'none';
          }
        }
      }

      if (!showActionsDropdown) {
        actionsDropdown.style.display = 'none';
      }
    }, 10)
  }
};
