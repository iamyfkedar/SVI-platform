<template>
  <div class="container">
    <div id="map-container1" style="width: 47.5vw; height: 100vh; margin-right: 5vw;"></div>
    <div id="map-container2" style="width: 47.5vw; height: 100vh;"></div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import mapboxgl from 'mapbox-gl'
import { GeoJsonLayer } from '@deck.gl/layers'
import { MapboxOverlay } from '@deck.gl/mapbox'
import * as turf from '@turf/turf'

mapboxgl.accessToken = 'pk.eyJ1Ijoid2lubmlleiIsImEiOiJjbDEyNmMxb2MycGJuM2RtdTBrNHk5OGcyIn0.s0v5JoEeCedaL7tqMCBNLA'

onMounted(() => {
  const map1 = new mapboxgl.Map({
    container: 'map-container1',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-73.9482629, 40.8035441],
    zoom: 15,
    pitch: 40,
    antialias: true
  });
  const map2 = new mapboxgl.Map({
    container: 'map-container2',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-73.9482629, 40.8035441],
    zoom: 15,
    pitch: 40,
    antialias: true
  });

  map1.on('load', () => {
    fetch('/cal_height_check4.geojson')
    .then(response => response.json())
    .then(data => {
      map1.addSource('highlight-buildings', {
        'type': 'geojson',
        'data': data
      });

      // 2. 添加建筑高亮图层
      map1.addLayer({
        id: 'buildings-height-cal-layer',
        type: 'fill-extrusion',
        source: 'highlight-buildings',
        paint: {
          'fill-extrusion-color': '#f00', // 高亮颜色
          'fill-extrusion-height': [
            'to-number', ['get', 'height_cal']
          ],
          'fill-extrusion-opacity': 0.6
        }
      })
    })
  })

  map2.on('load', () => {
    fetch('/cal_height_check4.geojson')
    .then(response => response.json())
    .then(data => {
      map2.addSource('highlight-buildings', {
        'type': 'geojson',
        'data': data
      });

      // 2. 添加建筑高亮图层
      map2.addLayer({
        id: 'buildings-height-layer',
        type: 'fill-extrusion',
        source: 'highlight-buildings',
        paint: {
          'fill-extrusion-color': '#aaa', // 高亮颜色
          'fill-extrusion-height': [
            'to-number', ['get', 'height']
          ],
          'fill-extrusion-opacity': 0.6
        }
      })
    })
  })
})


</script>

<style>
.container {
  margin: 0;
  overflow: hidden;
  display: flex;

}
</style>
