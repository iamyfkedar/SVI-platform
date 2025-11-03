<template>
  <div class="container">
    <!-- 进度条显示 -->
    <div class="progress-overlay" v-if="(processing || totalCount > 0) && processedCount < totalCount">
      <div class="progress-info">
        <span v-if="processing">处理图片: {{ processedCount }} / {{ totalCount }}</span>
        <span v-else>已处理: {{ processedCount }} / {{ totalCount }}</span>
        <span class="progress-percent">{{ progress }}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: progress + '%' }"></div>
      </div>
    </div>
    <input id="file-input" type="file" webkitdirectory directory multiple @change="onFilesSelected" style="position:absolute; z-index:1; margin:8px" />
    <div id="map-container" style="width: 100vw; height: 100vh;"></div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import mapboxgl from 'mapbox-gl'
import { GeoJsonLayer } from '@deck.gl/layers'
import { MapboxOverlay } from '@deck.gl/mapbox'
import * as turf from '@turf/turf'
import { parseSVIFileList, processSVIFiles, uploadSVIFiles } from './utils/readSVI'

mapboxgl.accessToken = 'pk.eyJ1Ijoid2lubmlleiIsImEiOiJjbDEyNmMxb2MycGJuM2RtdTBrNHk5OGcyIn0.s0v5JoEeCedaL7tqMCBNLA'

const sviCoords = ref([])
const mapRef = ref(null) // 保存 map 实例，供文件选择时查询 buildings 使用
const progress = ref(0)
const processing = ref(false)
const totalCount = ref(0)
const processedCount = ref(0)
const sviBuildings = ref([]) // 所有与任意点缓冲区相交的建筑（去重）
const pendingHighlight = ref(null) // 在 map 未就绪时暂存要高亮的 geojson
const pendingPoints = ref(null) // 在 map 未就绪时暂存点要素

// 文件选择事件处理器（绑定到模板中的 input）
// 将逻辑委托给 utils/readSVI.ts，但保留 UI 状态与展示调用
async function onFilesSelected(e) {
    const files = e.target.files

    // 初始化进度状态
    totalCount.value = files?.length || 0
    processedCount.value = 0
    progress.value = 0
    processing.value = true

    try {
        // 修改这里，添加 await
        const points = await parseSVIFileList(files)
        sviCoords.value = points

        // 显示点位
        showSVIPoints(points)
        
        // 处理建筑数据
        const features = mapRef.value ? 
            (mapRef.value.querySourceFeatures('composite', { sourceLayer: 'building' }) || []) 
            : []
        
        const { coords, uniqueBuildings } = await processSVIFiles(files, {
            features,
            radiusMeters: 50,
            onProgress: (processed, total, percent) => {
                processedCount.value = processed
                totalCount.value = total
                progress.value = percent
            }
        })

        // 上传文件和经纬度数据到后端（现在包含了 rotation 值）
        const result = await uploadSVIFiles(coords, uniqueBuildings)
        console.log('上传的数据', result)

        // 显示相交建筑
        sviBuildings.value = uniqueBuildings
        showSVIBuildings(uniqueBuildings)
        console.log('uniqueBuildings', uniqueBuildings);
        

    } catch (error) {
        console.error('处理文件失败:', error)
    } finally {
        processing.value = false
    }
}

onMounted(() => {
  // 等待用户通过左上角的文件选择输入选择包含 jpg 的文件夹（支持 webkitdirectory）
  // sviCoords 会在 onFilesSelected 中被填充

  const map = new mapboxgl.Map({
    container: 'map-container',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-73.9482629, 40.8035441],
    zoom: 15,
    pitch: 40,
    antialias: true
  });

  mapRef.value = map

  map.on('load', () => {
    map.addSource('highlight-buildings', {
      'type': 'geojson',
      'data': { 'type': 'FeatureCollection', 'features': [] }
    });

    // 添加 SVI 点源与图层，用于显示上传的经纬度点
    map.addSource('svi-points', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    
    map.addLayer({
      id: 'svi-points-layer',
      type: 'circle',
      source: 'svi-points',
      paint: {
        'circle-radius': 6,
        'circle-color': '#0088ff',
        'circle-stroke-width': 1,
        'circle-stroke-color': '#fff'
      }
    });
    
    // 添加建筑图层
    map.addLayer({
      id: 'highlight-buildings-layer',
      type: 'fill-extrusion',
      source: 'highlight-buildings',
      paint: {
        'fill-extrusion-color': '#f00', // 高亮颜色
        // 'fill-extrusion-height': ['get', 'height'],
        // 'fill-extrusion-base': ['get', 'min_height'],
        'fill-extrusion-opacity': 0.3
      }
    })

    // 如果在 map 准备前已经有待高亮数据，立即应用
    if (pendingHighlight.value) {
      // 如果有缓存，优先用 showSVIBuildings 统一处理（会同时处理点与建筑）
      showSVIBuildings(pendingHighlight.value)
      pendingHighlight.value = null
    }
    // 如果有待绘制的点数据，立即应用
    if (pendingPoints.value) {
      showSVIPoints(pendingPoints.value)
      pendingPoints.value = null
    }
  })
})

// 在地图上绘制上传的 SVI 点并缩放到点范围（会在 map 未就绪时暂存）
function showSVIPoints(coords) {
  // 接受 coords 数组或完整 geojson
  const points = Array.isArray(coords)
    ? coords.map(c => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
        properties: { file: c.file }
      }))
    : (coords && coords.type === 'FeatureCollection' ? coords.features : (coords && coords.features) || [])

  const geojson = { type: 'FeatureCollection', features: points }

  if (mapRef.value && typeof mapRef.value.getSource === 'function') {
    try {
      const src = mapRef.value.getSource('svi-points')
      if (src) {
        src.setData(geojson)

        // 缩放到点范围，但保持当前观察视角（pitch 和 bearing）不变
        if (points && points.length) {
          try {
            const bbox = turf.bbox(geojson)
            // 记录当前视角
            const currPitch = typeof mapRef.value.getPitch === 'function' ? mapRef.value.getPitch() : undefined
            const currBearing = typeof mapRef.value.getBearing === 'function' ? mapRef.value.getBearing() : undefined

            // 使用 fitBounds 调整视野（只改变 center/zoom）
            mapRef.value.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, maxZoom: 18, duration: 800, pitch: currPitch, bearing: currBearing })
          } catch (err) { /* ignore */ }
        }
        pendingPoints.value = null
        return
      }
    } catch (err) {
      // fallthrough to cache
    }
  }

  // map 未就绪或 source 不存在，缓存数据，待 map load 时应用
  pendingPoints.value = geojson
}

// 在地图上展示建筑集合（会在 map 未就绪时暂存）
function showSVIBuildings(features) {
  const geojson = { type: 'FeatureCollection', features: features || sviBuildings.value || [] }

  // 如果 map 可用并且 highlight-buildings 源存在，直接更新；否则缓存到 pendingHighlight
  if (mapRef.value && typeof mapRef.value.getSource === 'function') {
    try {
      const src = mapRef.value.getSource('highlight-buildings')
      if (src) {
        src.setData(geojson)
        pendingHighlight.value = null

        return
      }
    } catch (err) {
      // 若发生异常，继续走缓存逻辑
    }
  }

  // map 未就绪或 source 不存在，缓存数据，待 map load 时应用
  pendingHighlight.value = geojson
}
</script>

<style>
.container {
  margin: 0;
  overflow: hidden;
}
/* 进度条样式 */
.progress-overlay {
  position: absolute;
  left: 8px;
  top: 8px;
  width: 320px;
  z-index: 9999;
  background: rgba(255,255,255,0.9);
  padding: 8px;
  border-radius: 6px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.2);
  font-size: 13px;
}
.progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.progress-percent {
  margin-left: 8px;
  font-weight: 600;
}
.progress-bar {
  width: 100%;
  height: 8px;
  background: #eee;
  border-radius: 4px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg,#3b82f6,#06b6d4);
  width: 0%;
  transition: width 120ms linear;
}
</style>
