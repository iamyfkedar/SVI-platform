<template>
  <div ref="viewerContainer" style="width: 2000px; height: 1000px;"></div>
  <button @click="rotatePanorama"></button>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { Viewer } from '@photo-sphere-viewer/core';

const viewerContainer = ref(null);
let viewer = null;

onMounted(() => {
  viewer = new Viewer({
    container: viewerContainer.value,
    panorama: '/image/0,40.80637146,-73.94810491.jpg',
    sphereCorrection: {pan: 0, tilt: 0, roll: 0},
  });
})

const rotatePanorama = () => {
  viewer.animate({
    yaw: Math.PI / 2,
    pitch: '20deg',
    zoom: 50,
    speed: '2rpm',
})
}
</script>

<style>
body {
  margin: 0;
  overflow: hidden;
}
</style>
