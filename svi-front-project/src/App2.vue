<template>
  <div class="container">
    <div id="map-container" style="width: 100vw; height: 100vh;"></div>
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
  const map = new mapboxgl.Map({
    container: 'map-container',
    style: 'mapbox://styles/mapbox/light-v11',
    center: [-73.9482629, 40.8035441],
    zoom: 15,
    pitch: 40,
    antialias: true
  });

  map.on('load', () => {
    map.addSource('highlight-buildings', {
      'type': 'geojson',
      'data': { 'type': 'FeatureCollection', 'features': [] }
    });

    // 2. 添加建筑高亮图层
    map.addLayer({
      id: 'highlight-buildings-layer',
      type: 'fill-extrusion',
      source: 'highlight-buildings',
      paint: {
        'fill-extrusion-color': '#f00', // 高亮颜色
        'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-base': ['get', 'min_height'],
        'fill-extrusion-opacity': 0.6
      }
    })

    // 3. 点击地图事件
    map.on('click', (e) => {
      const radius = 50 // 缓冲半径，单位米
      const center = [e.lngLat.lng, e.lngLat.lat]

      // 创建圆形缓冲区
      const circle = turf.circle(center, radius / 1000, { units: 'kilometers' })

      // 查询原始建筑数据源
      const features = map.querySourceFeatures('composite', {
        sourceLayer: 'building'
      })
      
      // 筛选与圆形相交的建筑
      const intersected = features.filter(f => turf.booleanIntersects(f, circle))
      console.log('111', intersected);

      // 更新高亮图层数据
      const geojson = {
        type: 'FeatureCollection',
        features: intersected
      }
      map.getSource('highlight-buildings').setData(geojson)

      // 可选：在地图上绘制圆形缓冲区
      if (map.getSource('buffer-circle')) {
        map.getSource('buffer-circle').setData(circle)
      } else {
        map.addSource('buffer-circle', {
          type: 'geojson',
          data: circle
        })
        map.addLayer({
          id: 'buffer-circle-layer',
          type: 'line',
          source: 'buffer-circle',
          paint: {
            'line-color': '#00f',
            'line-width': 2
          }
        })
      }
    })
  })
})


</script>

<style>
.container {
  margin: 0;
  overflow: hidden;
}
</style>
