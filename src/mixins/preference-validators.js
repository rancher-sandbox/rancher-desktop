export default {
  computed: {
    invalidMemoryValueReason: function() {
      let value = this.memoryInGB;
      let numericValue;
      if (typeof(value) !== "number") {
        if (value === "") {
          return "No value provided";
        }
        if (!/^-?\d+(?:\.\d*)?$/.test(value)) {
          return "Contains non-numeric characters";
        }
        numericValue = parseFloat(value);
        if (isNaN(numericValue)) {
          return "Contains non-numeric characters";
        }
      } else {
        numericValue = value;
      }
      if (numericValue < 2) {
        return "Specified value is too low, must be at least 2 (GB)";
      }
      if (numericValue > this.availMemoryInGB && this.availMemoryInGB) {
        let verb = this.availMemoryInGB == 1 ? "is" : "are";
        return `Specified value is too high, only ${this.availMemoryInGB} GB ${verb} available`;
      }
      return '';
    },

    memoryValueIsValid: function() {
      return !this.invalidMemoryValueReason;
    },
    memoryValueIsntValid: function() {
      return !this.memoryValueIsValid;
    },

    invalidNumCPUsValueReason: function() {
      let value = this.numberCPUs;
      let numericValue;
      if (typeof (value) !== "number") {
        if (!/^-?\d+(?:\.\d*)?$/.test(value)) {
          return "Contains non-numeric characters";
        }
        numericValue = parseFloat(value);
        if (isNaN(numericValue)) {
          return "Contains non-numeric characters";
        }
      } else {
        numericValue = value;
      }
      if (numericValue < 2) {
        return "Specified value is too low, must be at least 2 (GB)";
      }
      if (numericValue > this.availNumCPUs && this.availNumCPUs) {
        let verb = this.availNumCPUs == 1 ? "is" : "are";
        let suffix = this.availNumCPUs == 1 ? "" : "s";
        return `Specified value is too high, only ${this.availNumCPUs} CPU${suffix} ${verb} available`;
      }
      return '';
    },

    numCPUsValueIsValid: function() {
      return !this.invalidNumCPUsValueReason;
    },
    numCPUsValueIsntValid: function() {
      return !this.numCPUsValueIsValid;
    },
  }
};
