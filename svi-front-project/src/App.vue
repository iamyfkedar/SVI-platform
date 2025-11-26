<template>
  <div class="container">
    <div id="map-container" style="width: 100vw; height: 70vh;"></div>

    <!-- 上传控件 -->
    <div style="padding:8px; background:#fff; position: absolute; left:8px; top:8px; z-index:10; border-radius:4px;">
      <label style="font-size:14px;">上传街景图片：</label>
      <input type="file" accept="image/*" @change="onFileChange" />
      <br />
      <label style="font-size:14px;">上传元数据(.metadata.json)：</label>
      <input type="file" accept=".json" @change="onMetaChange" />
      <br />
      <label style="font-size:14px;">上传掩码CSV（可多选）：</label>
      <input type="file" accept=".csv" multiple @change="onMultiMaskCsvChange" />
    </div>

    <!-- 普通图片展示，叠加掩码canvas -->
    <div
      style="height: 30vh; display: flex; align-items: center; justify-content: center; background: #222; position: relative;"
      ref="imgContainerRef"
    >
      <img
        v-if="imgUrl"
        :src="imgUrl"
        alt="街景图片"
        style="max-height: 100%; max-width: 100%; object-fit: contain; display: block;"
        ref="imgRef"
        @load="onImgLoad"
      />
      <canvas
        v-if="imgUrl && maskList.length"
        ref="maskCanvasRef"
        :width="displayWidth"
        :height="displayHeight"
        style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);"
      ></canvas>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref, onUnmounted, watch, nextTick } from "vue";
import mapboxgl from 'mapbox-gl'
import * as turf from '@turf/turf'

mapboxgl.accessToken = 'pk.eyJ1Ijoid2lubmlleiIsImEiOiJjbDEyNmMxb2MycGJuM2RtdTBrNHk5OGcyIn0.s0v5JoEeCedaL7tqMCBNLA'
const imgUrl = ref('/image/0,40.80637146,-73.94810491.jpg');
let currentObjectUrl = null; // 用于释放之前的 objectURL
let map = null;
let marker = null;
let mapLoaded = false;

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

let directionLineId = null;

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

function highlightBuilding(centerLng, centerLat, rotationDeg) {
  // 移除旧方向线
  if (directionLineId && map.getLayer(directionLineId)) map.removeLayer(directionLineId);
  if (directionLineId && map.getSource(directionLineId)) map.removeSource(directionLineId);
  directionLineId = 'direction-line';
  // 计算终点坐标（50米，rotation角度，正北为0，顺时针）
  const start = turf.point([centerLng, centerLat]);
  const end = turf.destination(start, 0.05, rotationDeg, { units: 'kilometers' });
  const line = turf.lineString([
    [centerLng, centerLat],
    end.geometry.coordinates
  ]);
  map.addSource(directionLineId, {
    type: 'geojson',
    data: line
  });
  map.addLayer({
    id: directionLineId,
    type: 'line',
    source: directionLineId,
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
    // 可选：高亮该建筑
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
      let degree = (minVal + maxVal) * scaleX / 2 / displayWidth.value * 360 - 180;
      let heading = (540 - rotation.value) % 360; // 转为正北为0，顺时针方向
      let viewAngle = heading + degree; // 视角方向
      highlightBuilding(lon, lat, viewAngle);
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
  map.on('load', () => { mapLoaded = true; });
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
  if (directionLineId && map && map.getLayer(directionLineId)) map.removeLayer(directionLineId);
  if (directionLineId && map && map.getSource(directionLineId)) map.removeSource(directionLineId);
});
</script>

<style>
body {
  margin: 0;
  overflow: hidden;
}
</style>
