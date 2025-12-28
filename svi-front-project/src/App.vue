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
        <br />
        <label style="font-size:14px;">上传掩码CSV（可多选）：</label>
        <input type="file" accept=".csv" multiple @change="onMultiMaskCsvChange" />
      </div>
    </div>

    <!-- 右侧：SVI 面板 -->
    <div class="SVI-container">
      <!-- 顶部图片区域：不随整体滚动 -->
      <div class="svi-top" ref="imgContainerRef">
        <img
          v-if="imgUrl"
          :src="imgUrl"
          alt="街景图片"
          class="svi-main-img"
          ref="imgRef"
          @load="onImgLoad"
        />
        <canvas
          v-if="imgUrl && maskList.length"
          ref="maskCanvasRef"
          :width="displayWidth"
          :height="displayHeight"
          class="svi-mask-canvas"
        ></canvas>
      </div>

      <!-- 仅此区域可滚动，显示附近的多张 SVI 图 -->
      <div class="nearby-SVI">
        <MultiSVI :imgList="nearbySVIList" @image-click="handleImageClick" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref, onUnmounted, watch, nextTick } from "vue";
import mapboxgl from 'mapbox-gl'
import * as turf from '@turf/turf'
import Papa from 'papaparse'
import { getAllStreetviews, getStreetviewById, getStreetviewMaskById, getNearbyStreetviewById } from './api/streetviews'
import MultiSVI from './components/MultiSVI.vue'

mapboxgl.accessToken = 'pk.eyJ1Ijoid2lubmlleiIsImEiOiJjbDEyNmMxb2MycGJuM2RtdTBrNHk5OGcyIn0.s0v5JoEeCedaL7tqMCBNLA'
const imgUrl = ref('/image/0,40.80637146,-73.94810491.jpg');
let currentObjectUrl = null; // 用于释放之前的 objectURL
let map = null;
let marker = null;
let mapLoaded = false;
let selectedPointId = null; // 当前选中的街景点 id，用于设置 feature state
const nearbyPointIdList = [];

const maskList = ref([]); // [{points: [{x, y}, ...], color: 'rgba(...)'}, ...]
const imgRef = ref(null);
const maskCanvasRef = ref(null);
const imgContainerRef = ref(null);
const displayWidth = ref(0);
const displayHeight = ref(0);
const highlightMaskIdx = ref(-1); // 当前高亮的掩膜索引
const mapRef = ref(null); // 保存 map 实例，供文件选择时查询 buildings 使用
const intersected = ref([]); // 保存与点缓冲区相交的建筑
const point = ref(null); // 当前点坐标
const rotation = ref(0); // 当前图片方向角
const recentIntersectedBuilding = ref(null); // 最近的相交建筑
const nearbySVIList = ref([]); // 附近街景列表

// 预设颜色列表
const maskColors = [
  'rgba(255,0,0,0.4)',    // 红
  'rgba(0,255,0,0.4)',    // 绿
  'rgba(0,0,255,0.4)',    // 蓝
  'rgba(255,255,0,0.4)',  // 黄
  'rgba(255,0,255,0.4)',  // 品红
  'rgba(0,255,255,0.4)',  // 青
  'rgba(255,128,0,0.4)',  // 橙
  'rgba(128,0,255,0.4)',  // 紫
  'rgba(0,128,255,0.4)',  // 天蓝
  'rgba(128,255,0,0.4)',  // 黄绿
];
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

// 将 API 返回的街景点数组渲染到地图上
function renderStreetviewPoints(points) {
  if (!map || !points) return;
  // 给 feature 顶层设置 id，便于 setFeatureState 操作
  const features = points.map(p => ({
    type: 'Feature',
    id: p.id,
    properties: { id: p.id },
    geometry: { type: 'Point', coordinates: [p.lng, p.lat] }
  }))
 
  const geojson = { type: 'FeatureCollection', features }

  // 如果 source 存在则更新，否则创建 source + layer
  if (map.getSource && map.getSource('streetviews-points')) {
    try { map.getSource('streetviews-points').setData(geojson) } catch (e) { console.log(e); }
  } else {
    map.addSource('streetviews-points', { type: 'geojson', data: geojson })
    map.addLayer({
      id: 'streetviews-points-layer',
      type: 'circle',
      source: 'streetviews-points',
      paint: {
        'circle-radius': 6,
        // 优先判断 selected -> 绿色；否则判断 nearby -> 蓝色；其余为橙色
        'circle-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], '#00c853',
          ['boolean', ['feature-state', 'nearby'], false], '#2196f3',
          '#ff5722'
        ],
        'circle-stroke-width': 1,
        'circle-stroke-color': '#fff'
      }
    })
    map.on('click', 'streetviews-points-layer', async (e) => {
      // 清除之前的最小/最大距离线和最近建筑
      if (minLineId && map.getLayer(minLineId)) map.removeLayer(minLineId);
      if (minLineId && map.getSource(minLineId)) map.removeSource(minLineId);
      if (maxLineId && map.getLayer(maxLineId)) map.removeLayer(maxLineId);
      if (maxLineId && map.getSource(maxLineId)) map.removeSource(maxLineId);
      if (map.getLayer('nearest-building')) map.removeLayer('nearest-building');
      if (map.getSource('nearest-building')) map.removeSource('nearest-building');
      const feat = e.features && e.features[0];
      const id = feat && (feat.id ?? (feat.properties && feat.properties.id));
      const coords = feat && feat.geometry && feat.geometry.coordinates;
      map.flyTo({ center: [coords[0], coords[1]], zoom: 17 });
      try {
        // 切换选中状态（清除之前的）
        if (selectedPointId != null && map.getSource('streetviews-points')) {
          map.setFeatureState({ source: 'streetviews-points', id: selectedPointId }, { selected: false })
        }
        if (id != null) {
          map.setFeatureState({ source: 'streetviews-points', id }, { selected: true })
          selectedPointId = id
        } else {
          selectedPointId = null
        }
        point.value = { lat: coords[1], lng: coords[0] };
        if (id) {
            await showMainImage(id);
            await showMask(id, coords[0], coords[1]);
            await showNearbySVI(id);
        }
      } catch (err) { /* ignore feature state errors */ }
    
    })
    // 改变鼠标为手型
    map.on('mouseenter', 'streetviews-points-layer', () => map.getCanvas().style.cursor = 'pointer')
    map.on('mouseleave', 'streetviews-points-layer', () => map.getCanvas().style.cursor = '')
  }
}

const handleImageClick = async(id, lat, lon) => {
  // 清除之前的最小/最大距离线和最近建筑
  if (minLineId && map.getLayer(minLineId)) map.removeLayer(minLineId);
  if (minLineId && map.getSource(minLineId)) map.removeSource(minLineId);
  if (maxLineId && map.getLayer(maxLineId)) map.removeLayer(maxLineId);
  if (maxLineId && map.getSource(maxLineId)) map.removeSource(maxLineId);
  if (map.getLayer('nearest-building')) map.removeLayer('nearest-building');
  if (map.getSource('nearest-building')) map.removeSource('nearest-building');
  map.flyTo({ center: [lon, lat], zoom: 17 });
  try {
    // 切换选中状态（清除之前的）
    if (selectedPointId != null && map.getSource('streetviews-points')) {
      map.setFeatureState({ source: 'streetviews-points', id: selectedPointId }, { selected: false })
    }
    if (id != null) {
      map.setFeatureState({ source: 'streetviews-points', id }, { selected: true })
      selectedPointId = id
    } else {
      selectedPointId = null
    }
    point.value = { lat: lat, lng: lon };
    if (id) {
        await showMainImage(id);
        await showMask(id, lon, lat);
        await showNearbySVI(id);
    }
  } catch (err) { /* ignore feature state errors */ }
}

async function showMainImage(id) {
  // 展示当前街景
  const img = await getStreetviewById(id)
  const info = img && img.data ? img.data : img
  if (info && info.image_url && info.rotation) {
    imgUrl.value = info.image_url
    rotation.value = typeof info.rotation === 'number' ? info.rotation : Number(info.rotation) || 0;
    maskList.value = []; // 切换图片时清空掩码
  }
}

async function showMask(id, lon, lat) {
  // 展示掩码
  const mask = await getStreetviewMaskById(id)
  const newMaskList = [];
  mask.forEach((item, index) => {
    const csvText = item.mask_csv;
    // 使用 PapaParse 解析
    const parsed = Papa.parse(csvText); 
    const points = parsed.data
      .filter(row => row.length >= 2 && row[0] !== "" && row[1] !== "")
      .map(row => {
        return {
          x: Number(row[0]),
          y: Number(row[1])
        };
      });
    newMaskList[index] = {
      points,
      color: maskColors[index % maskColors.length]
    };
  });
  maskList.value = newMaskList.filter(m => m && m.points.length);
  nextTick(drawMask);
  intersectBuildingsWithPoints(lon, lat, 50)
}

async function showNearbySVI(id) {
  const nearbyRes = await getNearbyStreetviewById(id)
  const nearbyData = nearbyRes && nearbyRes.data ? nearbyRes.data : nearbyRes
  nearbyData.forEach(item => {
    nearbyPointIdList.push(item.id);
  });
  if (nearbyPointIdList != null && map.getSource('streetviews-points')) {
    nearbyPointIdList.forEach(pid => {
      map.setFeatureState({ source: 'streetviews-points', id: pid }, { nearby: false })
    });
  }
  if (nearbyData != null) {
    nearbyData.forEach(item => {
      map.setFeatureState({ source: 'streetviews-points', id: item.id }, { nearby: true })
      nearbyPointIdList.push(item.id);
    });
  } else {
    nearbyPointIdList = [];
  }

  if (Array.isArray(nearbyData)) {
    nearbySVIList.value = nearbyData
  }
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

// 支持多文件上传，每个mask一个颜色
function onMultiMaskCsvChange(e) {
  const files = e.target.files;
  if (!files || !files.length) return;
  const newMaskList = [];
  let loadedCount = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const reader = new FileReader();
    reader.onload = function(evt) {
      const text = evt.target.result;
      const lines = text.split(/\r?\n/);
      const points = [];
      for (const line of lines) {
        const [x, y] = line.split(',').map(Number);
        if (!isNaN(x) && !isNaN(y)) {
          points.push({ x, y });
        }
      }
      newMaskList[i] = {
        points,
        color: maskColors[i % maskColors.length]
      };
      loadedCount++;
      if (loadedCount === files.length) {
        // 全部加载完才赋值，避免顺序错乱
        maskList.value = newMaskList.filter(m => m && m.points.length);   
        nextTick(drawMask);
      }
    }
    reader.readAsText(file);
  }
}

// 图片加载后，记录显示尺寸并绘制掩码
function onImgLoad() {
  nextTick(() => {
    const img = imgRef.value;
    const container = imgContainerRef.value;
    if (!img || !container) return;
    // 计算图片实际显示尺寸
    const containerW = container.clientWidth;
    const containerH = container.clientHeight;
    const imgW = img.naturalWidth;
    const imgH = img.naturalHeight;
    // 保持等比缩放
    let scale = Math.min(containerW / imgW, containerH / imgH);
    displayWidth.value = Math.round(imgW * scale);
    displayHeight.value = Math.round(imgH * scale);
    drawMask();
  });
}

// 监听掩码或图片尺寸变化时重绘
watch([maskList, displayWidth, displayHeight], () => {
  drawMask();
});

function isPointInPolygon(x, y, poly) {
  // 射线法判断点是否在多边形内
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-10) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function onMaskCanvasMouseMove(e) {
  const canvas = maskCanvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const img = imgRef.value;
  if (!img) return;
  const scaleX = displayWidth.value / img.naturalWidth;
  const scaleY = displayHeight.value / img.naturalHeight;
  let found = -1;
  for (let i = 0; i < maskList.value.length; i++) {
    const mask = maskList.value[i];
    // 缩放到canvas坐标
    const poly = mask.points.map(pt => ({ x: pt.x * scaleX, y: pt.y * scaleY }));
    if (isPointInPolygon(px, py, poly)) {
      found = i;
      break;
    }
  }
  if (highlightMaskIdx.value !== found) {
    highlightMaskIdx.value = found;
    drawMask();
    findBuildingsIntersectingPointBuffer(scaleX);
  }
}

function onMaskCanvasMouseLeave() {
  if (highlightMaskIdx.value !== -1) {
    highlightMaskIdx.value = -1;
    drawMask();
  }
}

function findBuildingsIntersectingPointBuffer() {
  if (!point.value) return [];
  const lon = point.value.lng;
  const lat = point.value.lat;
  const img = imgRef.value;
  if (!img) return;
  const scaleX = displayWidth.value / img.naturalWidth;
  for (let idx = 0; idx < maskList.value.length; idx++) { 
    if (idx === highlightMaskIdx.value) {
      const mask = maskList.value[idx];
      const maskArray = mask.points.map(pt => [pt.x, pt.y]);
      let maxVal = Math.max(...maskArray.map(item => item[0]));
      let minVal = Math.min(...maskArray.map(item => item[0]));
      let midDegree = (minVal + maxVal) * scaleX / 2 / displayWidth.value * 360 - 180;
      let minDegree = (minVal) * scaleX / displayWidth.value * 360 - 180;
      let maxDegree = (maxVal) * scaleX / displayWidth.value * 360 - 180;
      let heading = (540 - rotation.value) % 360; // 转为正北为0，顺时针方向
      let viewAngle = heading + midDegree; // 视角方向 
      let minViewAngle = heading + minDegree;
      let maxViewAngle = heading + maxDegree;
      highlightBuilding(lon, lat, viewAngle, minViewAngle, maxViewAngle);
      break;
    }
  }
}

function drawMask() {
  const canvas = maskCanvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!maskList.value.length) return;
  const img = imgRef.value;
  const scaleX = displayWidth.value / img.naturalWidth;
  const scaleY = displayHeight.value / img.naturalHeight;
  if (!img) return;
  for (let idx = 0; idx < maskList.value.length; idx++) {
    const mask = maskList.value[idx];
    if (!mask.points.length) continue;
    ctx.save();
    // 高亮时加深颜色和边框
    if (idx === highlightMaskIdx.value) {
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = mask.color.replace(/rgba\(([^)]+),[\d.]+\)/, 'rgba($1,1)');
      ctx.fillStyle = mask.color.replace(/rgba\(([^)]+),[\d.]+\)/, 'rgba($1,0.7)');
      ctx.lineWidth = 3;
    } else {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = mask.color.replace(/rgba\(([^)]+),[\d.]+\)/, 'rgba($1,1)');
      ctx.fillStyle = mask.color;
      ctx.lineWidth = 1;
    }
    ctx.beginPath();
    ctx.moveTo(mask.points[0].x * scaleX, mask.points[0].y * scaleY);
    for (let i = 1; i < mask.points.length; i++) {
      ctx.lineTo(mask.points[i].x * scaleX, mask.points[i].y * scaleY);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  canvas.style.pointerEvents = 'auto';
  canvas.addEventListener('mousemove', onMaskCanvasMouseMove);
  canvas.addEventListener('mouseleave', onMaskCanvasMouseLeave);
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
    // 请求后端 streetviews 列表并在地图上渲染点
    try {
      const res = await getAllStreetviews()
      const data = res && res.data ? res.data : res
      if (Array.isArray(data)) {
        renderStreetviewPoints(data)
      }
    } catch (err) {
      console.warn('getAllStreetviews error', err)
    }
  });
  mapRef.value = map
})

onUnmounted(() => {
  if(currentObjectUrl && imgUrl.value === currentObjectUrl){
    try{ URL.revokeObjectURL(currentObjectUrl); } catch(e){}
    currentObjectUrl = null;
  }
  if(marker){ marker.remove(); marker = null; }
  map = null;
  mapLoaded = false;
  const canvas = maskCanvasRef.value;
  if (canvas) {
    canvas.removeEventListener('mousemove', onMaskCanvasMouseMove);
    canvas.removeEventListener('mouseleave', onMaskCanvasMouseLeave);
  }
  if (minLineId && map.getLayer(minLineId)) map.removeLayer(minLineId);
  if (minLineId && map.getSource(minLineId)) map.removeSource(minLineId);
  if (maxLineId && map.getLayer(maxLineId)) map.removeLayer(maxLineId);
  if (maxLineId && map.getSource(maxLineId)) map.removeSource(maxLineId);
  // 清理 streetviews 点图层和数据源
  if (map && map.getLayer && map.getLayer('streetviews-points-layer')) map.removeLayer('streetviews-points-layer');
  if (map && map.getSource && map.getSource('streetviews-points')) map.removeSource('streetviews-points');
});
</script>

<style scoped>
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
  position: relative;
  flex: 0 0 70vw; /* 固定 70vw 宽度 */
  height: 100%;
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
  background: #fff;
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.15);
}

/* SVI 面板（右侧） */
.SVI-container {
  flex: 0 0 30vw; /* 固定 30vw 宽度 */
  height: 100%;
  overflow: hidden; /* 整体不滚动 */
  background: #111;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px;
}

/* 顶部图片区域：固定高度比（不参与滚动） */
.SVI-container .svi-top {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #222;
  position: relative;
  box-sizing: border-box;
}

/* 主图片和画布定位在该区域中间 */
.svi-main-img {
  max-height: 100%;
  max-width: 100%;
  object-fit: contain;
  display: block;
}
.svi-mask-canvas {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}

/* 附近 SVI 列表：可滚动，独立滚动区域 */
.nearby-SVI {
  flex: 1 1 auto; /* 占据剩余高度 */
  width: 100%;
  margin-top: 10px;
  overflow-y: auto; /* 仅内部可滚动 */
  -webkit-overflow-scrolling: touch;
  box-sizing: border-box;
}

/* 可选：控制 MultiSVI 内部项布局 */
.SVI-container .nearby-SVI .container {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
