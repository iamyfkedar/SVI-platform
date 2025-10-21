<template>
  <div id="map-container" style="width: 100vw; height: 100vh;"></div>
</template>

<script setup>
import { onMounted } from 'vue'
import mapboxgl from 'mapbox-gl'
import { GeoJsonLayer } from '@deck.gl/layers'
import { MapboxOverlay } from '@deck.gl/mapbox'

mapboxgl.accessToken = 'pk.eyJ1Ijoid2lubmlleiIsImEiOiJjbDEyNmMxb2MycGJuM2RtdTBrNHk5OGcyIn0.s0v5JoEeCedaL7tqMCBNLA'

onMounted(() => {
  const map = new mapboxgl.Map({
    container: 'map-container',
    style: 'mapbox://styles/mapbox/light-v9',
    center: [-73.9482629, 40.8035441],
    zoom: 15,
    pitch: 40,
    antialias: true
  });
  map.on('load', () => {
    fetch('/buildings3.geojson')
      .then(res => res.json())
      .then(data => {
        map.addSource('my-buildings', {
          type: 'geojson',
          data
        })
        map.addLayer({
          'id': '3d-buildings',
          'source': 'my-buildings',
          'type': 'fill-extrusion',
          paint: {
            'fill-extrusion-color': '#aaa',
            'fill-extrusion-height': [
              'coalesce', 
              ['to-number', ['get', 'height']], 
              10
            ],
            'fill-extrusion-opacity': 0.7,
          }
        });
      })
  })
  
})

</script>

<style>
body {
  margin: 0;
  overflow: hidden;
}
</style>
