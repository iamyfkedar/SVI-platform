<template>
  <div class="app-layout">
    <!-- 左侧：地图区域（包含上传控件，绝对定位于地图上方） -->
    <div id="map-area">
      <div id="map-container"></div>

      <!-- 上传控件（保留原有结构与样式，但移动到地图容器内） -->
      <div class="upload-controls">
        <label style="font-size:14px;">上传街景图片：</label>
        <input type="file" accept="image/*" @change="onFileChange" />
        <br />
        <label style="font-size:14px;">上传元数据(.metadata.json)：</label>
        <input type="file" accept=".json" @change="onMetaChange" />
      </div>

      <div class="img-container" ref="imgContainerRef">
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref, onUnmounted, watch, nextTick } from "vue";
import mapboxgl from 'mapbox-gl'
import * as turf from '@turf/turf';
import { Viewer } from '@photo-sphere-viewer/core';

mapboxgl.accessToken = 'pk.eyJ1Ijoid2lubmlleiIsImEiOiJjbDEyNmMxb2MycGJuM2RtdTBrNHk5OGcyIn0.s0v5JoEeCedaL7tqMCBNLA'
const imgUrl = ref('/image/0,40.80637146,-73.94810491.jpg');
let currentObjectUrl = null; // 用于释放之前的 objectURL
let map = null;
let marker = null;
let mapLoaded = false;
const maskList = ref([]); // [{points: [{x, y}, ...], color: 'rgba(...)'}, ...]
const displayWidth = ref(0);
const displayHeight = ref(0);
const highlightMaskIdx = ref(-1); // 当前高亮的掩膜索引
const mapRef = ref(null); // 保存 map 实例，供文件选择时查询 buildings 使用
const intersected = ref([]); // 保存与点缓冲区相交的建筑
const point = ref(null); // 当前点坐标
const rotation = ref(0); // 当前图片方向角
const recentIntersectedBuilding = ref(null); // 最近的相交建筑
const imgContainerRef = ref(null);
let minLineId = null;
let maxLineId = null;


function addMarkerAndFly(lat, lng) {
  if (!mapLoaded) return;
  if (marker) { marker.remove(); marker = null; }
  marker = new mapboxgl.Marker({ color: 'red', scale: 0.5 })
    .setLngLat([lng, lat])
    .addTo(map);
  map.flyTo({ center: [lng, lat], zoom: 17 });
}


function onFileChange(e){
  const file = e.target.files && e.target.files[0];
  if(!file) return;
  const url = URL.createObjectURL(file);
  // 释放上一个 objectURL
  if(currentObjectUrl && imgUrl.value === currentObjectUrl){
    try{ URL.revokeObjectURL(currentObjectUrl); } catch(e){}
  }
  currentObjectUrl = url;
  imgUrl.value = url;
  maskList.value = []; // 切换图片时清空掩码
}

function onMetaChange(e){
  const file = e.target.files && e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = function(evt){
    try {
      const meta = JSON.parse(evt.target.result);
      if((typeof meta.lat === 'number' || typeof meta.lat === 'string') && (typeof meta.lng === 'number' || typeof meta.lng === 'string')){
        // 保存经纬度到 point
        point.value = { lat: Number(meta.lat), lng: Number(meta.lng) };
        rotation.value = typeof meta.rotation === 'number' ? meta.rotation : Number(meta.rotation) || 0;
        if(mapLoaded) {
          addMarkerAndFly(Number(meta.lat), Number(meta.lng));
          intersectBuildingsWithPoints(Number(meta.lng), Number(meta.lat), 50)
        } else {
          map.once('load', () => {
            addMarkerAndFly(Number(meta.lat), Number(meta.lng));
            intersectBuildingsWithPoints(Number(meta.lng), Number(meta.lat), 50)
          });
        }
      } else {
        alert('元数据缺少 lat/lng 字段');
      }
    } catch(err) {
      alert('元数据文件格式错误');
    }
  }
  reader.readAsText(file);
}

function findNearestIntersectedBuilding(directionLine, buildings, pointCoord) {
  let minDist = Infinity;
  let nearest = null;
  for (const b of buildings) {
    // 只处理 Polygon
    if (b.geometry.type === 'Polygon') {
      // 判断方向线与建筑是否相交
      const intersects = turf.lineIntersect(directionLine, b);
      if (intersects.features.length > 0) {
        // 计算点到建筑边界的距离
        const line = turf.lineString(b.geometry.coordinates[0]);
        const dist = turf.pointToLineDistance(pointCoord, line, { units: 'meters' });
        if (dist < minDist) {
          minDist = dist;
          nearest = b;
        }
      }
    }
  }
  return nearest;
}

function highlightBuilding(centerLng, centerLat, middleDeg, minDeg, maxDeg) {
  // 移除旧方向线
  if (minLineId && map.getLayer(minLineId)) map.removeLayer(minLineId);
  if (minLineId && map.getSource(minLineId)) map.removeSource(minLineId);
  if (maxLineId && map.getLayer(maxLineId)) map.removeLayer(maxLineId);
  if (maxLineId && map.getSource(maxLineId)) map.removeSource(maxLineId);
  minLineId = 'min-direction-line';
  maxLineId = 'max-direction-line';
  // 计算终点坐标（50米，rotation角度，正北为0，顺时针）
  const start = turf.point([centerLng, centerLat]);
  const end = turf.destination(start, 0.05, middleDeg, { units: 'kilometers' });
  const minEnd = turf.destination(start, 0.05, minDeg, { units: 'kilometers' });
  const maxEnd = turf.destination(start, 0.05, maxDeg, { units: 'kilometers' });
  const line = turf.lineString([
    [centerLng, centerLat],
    end.geometry.coordinates
  ]);
  const minLine = turf.lineString([
    [centerLng, centerLat],
    minEnd.geometry.coordinates
  ]);
  const maxLine = turf.lineString([
    [centerLng, centerLat],
    maxEnd.geometry.coordinates
  ]);
  map.addSource(minLineId, {
    type: 'geojson',
    data: minLine
  });
  map.addLayer({
    id: minLineId,
    type: 'line',
    source: minLineId,
    paint: {
      'line-color': '#008000',
      'line-width': 1
    }
  });
  map.addSource(maxLineId, {
    type: 'geojson',
    data: maxLine
  });
  map.addLayer({
    id: maxLineId,
    type: 'line',
    source: maxLineId,
    paint: {
      'line-color': '#008000',
      'line-width': 1
    }
  });
  // 计算最近相交建筑
  if (intersected.value && intersected.value.length && point.value) {
    const pt = turf.point([point.value.lng, point.value.lat]);
    const nearest = findNearestIntersectedBuilding(line, intersected.value, pt);
    recentIntersectedBuilding.value = nearest;
    // 高亮该建筑足迹
    if (map.getLayer('nearest-building')) map.removeLayer('nearest-building');
    if (map.getSource('nearest-building')) map.removeSource('nearest-building');
    if (nearest) {
      map.addSource('nearest-building', {
        type: 'geojson',
        data: nearest
      });
      map.addLayer({
        id: 'nearest-building',
        type: 'fill',
        source: 'nearest-building',
        paint: {
          'fill-color': maskList.value[highlightMaskIdx.value].color,
          'fill-opacity': 0.7,
          'fill-outline-color': maskList.value[highlightMaskIdx.value].color
        }
      });
    }
  }
}

function intersectBuildingsWithPoints(lon, lat, radiusMeters) {
  if (!mapRef.value) return [];
  const map = mapRef.value;
  const center = [lon, lat]
  const radius = typeof radiusMeters === 'number' ? radiusMeters : 50
  const circle = turf.circle(center, radius / 1000, { units: 'kilometers' })
  try {
    const features = mapRef.value ? 
      (mapRef.value.querySourceFeatures('composite', { sourceLayer: 'building' }) || []) 
      : [];
    const intersectedBuilding = features.filter(f => {
        try { return turf.booleanIntersects(f, circle) } catch (err) { return false }
    })
    intersected.value = intersectedBuilding;
  } catch (err) {
    return [];
  }
}


onMounted(() => {
  map = new mapboxgl.Map({
    container: 'map-container',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-73.9482629, 40.8035441],
    zoom: 15,
    pitch: 40,
    antialias: true
  });
  map.on('load', async () => { 
    mapLoaded = true;
  });
  mapRef.value = map
    const viewer = new Viewer({
        container: imgContainerRef.value,
        panorama: imgUrl.value,
        caption: 'Parc national du Mercantour <b>&copy; Damien Sorel</b>',
        touchmoveTwoFingers: true,
        mousewheelCtrlKey: true,
    });
})

onUnmounted(() => {
  if(currentObjectUrl && imgUrl.value === currentObjectUrl){
    try{ URL.revokeObjectURL(currentObjectUrl); } catch(e){}
    currentObjectUrl = null;
  }
  if(marker){ marker.remove(); marker = null; }
  map = null;
  mapLoaded = false;
  if (minLineId && map.getLayer(minLineId)) map.removeLayer(minLineId);
  if (minLineId && map.getSource(minLineId)) map.removeSource(minLineId);
  if (maxLineId && map.getLayer(maxLineId)) map.removeLayer(maxLineId);
  if (maxLineId && map.getSource(maxLineId)) map.removeSource(maxLineId);
  // 清理 streetviews 点图层和数据源
  if (map && map.getLayer && map.getLayer('streetviews-points-layer')) map.removeLayer('streetviews-points-layer');
  if (map && map.getSource && map.getSource('streetviews-points')) map.removeSource('streetviews-points');
});
</script>

<style>
body {
  margin: 0;
  overflow: hidden;
}

/* 布局：左右分布 */
.app-layout {
  display: flex;
  height: 100vh;
  width: 100vw;
}

/* 地图区域 */
#map-area {
  height: 100%;
  width: 100%;
}

/* 地图容器占满区域 */
#map-container {
  width: 100%;
  height: 100%;
}

/* 上传控件，位于地图左上角 */
.upload-controls {
  position: absolute;
  left: 8px;
  top: 8px;
  z-index: 10;
  padding: 8px;
  background-color: rgba(255, 255, 255, 0.6);
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.15);
}

/* 街景容器，位于地图右下角 */
.img-container {
  position: absolute;
  overflow: hidden;
  height: 40%;
  aspect-ratio: 2 / 1;
  right: 8px;
  bottom: 8px;
  z-index: 10;
  padding: 8px;
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.15);
}

.img-preview {
  max-height: 100%;
  max-width: 100%;
  object-fit: contain;
  display: block;
}

</style>
