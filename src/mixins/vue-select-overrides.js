
export default {
  methods: {
    mappedKeys(map, vm) {
      // Defaults found at - https://github.com/sagalbot/vue-select/blob/master/src/components/Select.vue#L947
      const out = { ...map };

      // tab
      (out[9] = (e) => {
        // user esc'd
        if (!vm.open) {
          return;
        }

        e.preventDefault();

        const optsLen = vm.filteredOptions.length;
        const typeAheadPointer = vm.typeAheadPointer;

        if (e.shiftKey) {
          if (typeAheadPointer === 0) {
            return vm.onEscape();
          }

          return vm.typeAheadUp();
        }
        if (typeAheadPointer + 1 === optsLen) {
          return vm.onEscape();
        }

        return vm.typeAheadDown();
      });

      (out[27] = (e) => {
        vm.open = false;
        vm.search = '';

        return false;
      });

      (out[13] = (e, opt) => {
        if (!vm.open) {
          vm.open = true;

          return;
        }

        let option = vm.filteredOptions[vm.typeAheadPointer];

        vm.$emit('option:selecting', option);

        if (!vm.isOptionSelected(option)) {
          if (vm.taggable && !vm.optionExists(option)) {
            vm.$emit('option:created', option);
          }
          if (vm.multiple) {
            option = vm.selectedValue.concat(option);
          }
          vm.updateValue(option);
          vm.$emit('option:selected', option);

          if (vm.closeOnSelect) {
            vm.open = false;
            vm.typeAheadPointer = -1;
          }

          if (vm.clearSearchOnSelect) {
            vm.search = '';
          }
        }
      });

      //  up.prevent
      (out[38] = (e) => {
        e.preventDefault();

        if (!vm.open) {
          vm.open = true;
        }

        return vm.typeAheadUp();
      });

      //  down.prevent
      (out[40] = (e) => {
        e.preventDefault();

        if (!vm.open) {
          vm.open = true;
        }

        return vm.typeAheadDown();
      });

      return out;
    },
  }
};
