<script>
import VueSlider from 'vue-slider-component';
import 'vue-slider-component/theme/default.css';
export default {
  components: {
    VueSlider,
  },
  props: {
    memoryInGB: {
      type:    Number,
      default: 2,
    },
    numberCPUs: {
      type:    Number,
      default: 2,
    },
    availMemoryInGB: {
      type:    Number,
      default: 0,
    },
    availNumCPUs: {
      type:    Number,
      default: 0,
    },
  },
  data() {
    return {
      minMemoryInGB: 2,
      minNumberCPUs: 1,
    };
  },
  computed: {
    memoryMarks() {
      return this.makeArray(this.safeMinMemory, this.availMemoryInGB);
    },
    CPUMarks() {
      return this.makeArray(this.safeMinCPUs, this.availNumCPUs);
    },
    disableMemory() {
      return this.availMemoryInGB <= this.minMemoryInGB;
    },
    disableCPUs() {
      return this.availNumCPUs <= this.minNumberCPUs;
    },
    safeMinMemory() {
      return Math.min(this.minMemoryInGB, this.availMemoryInGB);
    },
    safeMinCPUs() {
      return Math.min(this.minNumberCPUs, this.availNumCPUs);
    },
    safeMemory() {
      if (this.memoryInGB < this.safeMinMemory) {
        return this.safeMinMemory;
      } else if (this.memoryInGB > this.availMemoryInGB) {
        return this.availMemoryInGB;
      } else {
        return this.memoryInGB;
      }
    },
    safeCPUs() {
      if (this.numberCPUs < this.safeMinCPUs) {
        return this.safeMinCPUs;
      } else if (this.numberCPUs > this.availNumCPUs) {
        return this.availNumCPUs;
      } else {
        return this.numberCPUs;
      }
    },
  },
  methods: {
    updatedMemory(value) {
      this.$emit('updateMemory', value);
    },
    updatedCPU(value) {
      this.$emit('updateCPU', value);
    },
    makeArray(min, max) {
      const size = max - min + 1;
      if (size <= 0) {
        return [max];
      }
      return [...Array(size).keys()].map(i => i + min);
    },
  },
};
</script>

<template>
  <div class="system-preferences">
    <p>System Preferences:</p>
    <div id="memoryInGBWrapper" class="labeled-slider">
      <div class="slider-label">
        Memory (GB):
      </div>
      <vue-slider
        :value="safeMemory"
        :min="safeMinMemory"
        :max="availMemoryInGB"
        :interval="1"
        :marks="memoryMarks"
        :tooltip="'none'"
        :disabled="disableMemory"
        @change="updatedMemory"
      />
    </div>

    <div id="numCPUWrapper" class="labeled-slider">
      <div class="slider-label">
        # CPUs:
      </div>
      <vue-slider
        :value="safeCPUs"
        :min="safeMinCPUs"
        :max="availNumCPUs"
        :interval="1"
        :marks="CPUMarks"
        :tooltip="'none'"
        :disabled="disableCPUs"
        @change="updatedCPU"
      />
    </div>
  </div>
</template>

<style scoped>

div.labeled-slider {
  margin: 4px 0 32px 0;
  width: 20em;
}

div.slider-label {
  margin-top: 6px;
}

</style>
