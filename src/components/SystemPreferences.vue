<script>
  import VueSlider from 'vue-slider-component';
  import 'vue-slider-component/theme/default.css';
  export default {
    components: {
      VueSlider
    },
    props: {
      memoryInGB: {
        type: Number,
        default: 2
      },
      numberCPUs: {
        type: Number,
        default: 2
      },
      availMemoryInGB: {
          type: Number,
          default: 0
      },
      availNumCPUs: {
          type: Number,
          default: 0
      }
    },
    methods: {
      updatedMemory(value) {
        this.$emit('updateMemory', value);
      },
      updatedCPU(value) {
        this.$emit('updateCPU', value);
      },
      makeArray(min, max) {
        let size = max - min + 1;
        return [...Array(size).keys()].map(i => i + min);
      }
    },
    computed: {
      memoryMarks: function() {
        return this.makeArray(2, this.availMemoryInGB);
      },
      CPUMarks: function() {
        return this.makeArray(1, this.availNumCPUs);
      },
      disableMemory: function() {
        return this.availMemoryInGB <= 2
      },
      disableCPUs: function() {
        return this.availNumCPUs <= 1
      }
    }
  }
</script>

<template>
  <div class="system-preferences">
    <p>System Preferences:</p>
    <div id="memoryInGBWrapper" class="labeled-slider">
      <div class="slider-label">Memory (GB):</div>
      <vue-slider :value="memoryInGB"
                  :min="2"
                  :max="availMemoryInGB"
                  :interval="1"
                  :marks="memoryMarks"
                  :disabled="disableMemory"
                  @change="updatedMemory"
                  />
    </div>

    <div id="numCPUWrapper" class="labeled-slider">
      <div class="slider-label"># CPUs:</div>
      <vue-slider :value="numberCPUs"
                  :min="1"
                  :max="availNumCPUs"
                  :interval="1"
                  :marks="CPUMarks"
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
