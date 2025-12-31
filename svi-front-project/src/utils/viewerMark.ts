import '@photo-sphere-viewer/core/index.css'
import '@photo-sphere-viewer/markers-plugin/index.css'
import { Viewer } from '@photo-sphere-viewer/core';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';

const baseUrl = 'https://photo-sphere-viewer-data.netlify.app/assets/';

let viewer: Viewer | null = null;
let markersPlugin: any = null;

// 绘制面相关状态（模块级）
let currentPolygonPoints: [number, number][] = [];
let currentVertexMarkerIds: string[] = [];
let polygonCount = 0;
// 存储已完成的多边形（每项包含 markerId 与顶点点集）
const polygonsStore: { id: string; points: [number, number][] }[] = [];

export const SELECT_MARKER_EVENT = 'psv-select-marker'

// 初始化 viewer 并挂载交互逻辑
export function initViewer(container: HTMLElement | string | null, panorama?: string) {
  // 销毁旧实例
  destroyViewer();

  viewer = new Viewer({
    container: container as any,
    panorama: panorama || baseUrl + 'sphere.jpg',
    caption: 'Parc national du Mercantour <b>&copy; Damien Sorel</b>',
    loadingImg: baseUrl + 'loader.gif',
    touchmoveTwoFingers: true,
    mousewheelCtrlKey: true,
    plugins: [
      MarkersPlugin.withConfig({
        markers: [],
      }),
    ],
  });

  markersPlugin = viewer.getPlugin(MarkersPlugin);

  // 点击 marker（由 MarkersPlugin 触发的 select-marker 事件）
  // 如果点击的是 polygon 类型的 marker，则在控制台打印该面的顶点（yaw,pitch）
  markersPlugin.addEventListener('select-marker', (e: any) => {
    // 兼容不同事件结构：viewer 事件回调可能在 e.marker / e.data.marker / e.detail.marker
    const marker = e?.marker || e?.data?.marker || e?.detail?.marker;
    if (!marker) return;
    const id = marker.id;
    // 若 marker 包含 polygon 字段，或在 polygonsStore 中有对应 id，则认为是已绘制的面
    if (marker.polygon || id) {
      const stored = polygonsStore.find(p => p.id === id);
      const points: [number, number][] = stored ? stored.points : (marker.polygon || []);
      console.log('点击了多边形：', id, '顶点(yaw,pitch)：', points);
      // 将信息派发为自定义事件，供外部组件监听
      try {
        // 优先使用 initViewer 参数传入的 container（外层元素），否则回退到 viewer.container
        let dispatchTarget: HTMLElement | null = null;
        try {
          // 'container' 是 initViewer 的参数（可能为 HTMLElement 或选择器字符串）
          if (container && (container as any) instanceof HTMLElement) {
            dispatchTarget = container as unknown as HTMLElement;
          } else if (typeof container === 'string') {
            const el = document.querySelector(container as string);
            if (el && el instanceof HTMLElement) dispatchTarget = el;
          }
        } catch (e) { /* ignore */ }
        if (!dispatchTarget && viewer) {
          dispatchTarget = (viewer as any).container as HTMLElement | null;
        }
        if (dispatchTarget) {
          // 允许冒泡与穿透 shadow DOM，以便外层监听器能捕获到事件
          const ev = new CustomEvent(SELECT_MARKER_EVENT, { detail: { id, points, marker }, bubbles: true, composed: true });
          dispatchTarget.dispatchEvent(ev);
          console.log('ev', ev);
        }
      } catch (err) {
        // ignore
      }
    }
  });

  // 点击添加顶点（左键）
  viewer.addEventListener('click', ({ data }: any) => {
    if (!data.rightclick) {
      const newPoint = { yaw: data.yaw, pitch: data.pitch };
      currentPolygonPoints.push([newPoint.yaw, newPoint.pitch]);
      const vertexMarkerId = 'v-' + Math.random().toString(36).slice(2, 9);
      currentVertexMarkerIds.push(vertexMarkerId);
      markersPlugin.addMarker({
        id: vertexMarkerId,
        position: newPoint,
        image: baseUrl + 'pictos/pin-red.png',
        size: { width: 32, height: 32 },
        anchor: 'bottom center',
        tooltip: `顶点 ${currentPolygonPoints.length}`,
        data: { isVertex: true },
      });
    }
  });

  // 右键完成面（contextmenu 事件挂在 container）
  if (viewer.container) {
    viewer.container.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      if (currentPolygonPoints.length >= 3) {
        polygonCount += 1;
        const polygonId = 'polygon-' + Math.random().toString(36).slice(2,9);
        markersPlugin.addMarker({
          id: polygonId,
          polygon: currentPolygonPoints,
          svgStyle: {
            fill: 'rgba(0, 200, 50, 0.3)',
            stroke: 'rgba(0, 200, 50, 0.8)',
            strokeWidth: '2px',
          },
          tooltip: `绘制的面${polygonCount}`,
        });
        // 将顶点数据持久化到模块级存储（注意复制数组）
        polygonsStore.push({ id: polygonId, points: currentPolygonPoints.slice() });
      } else if (currentPolygonPoints.length > 0) {
        console.log('点太少，无法构成面。绘制已取消。');
      }
      // 清理临时顶点标记与状态
      currentVertexMarkerIds.forEach((markerId) => {
        markersPlugin.removeMarker(markerId);
      });
      currentVertexMarkerIds = [];
      currentPolygonPoints = [];
    });
  }

  return viewer;
}

// 切换 panorama（图片）
export function setViewerPanorama(panorama: string) {
  if (!viewer) return Promise.reject(new Error('viewer not initialized'));
  return viewer.setPanorama(panorama);
}

// 销毁 viewer 并清理状态
export function destroyViewer() {
  try {
    if (viewer && typeof viewer.destroy === 'function') {
      // 移除 container 上可能添加的 contextmenu listener
      try {
        if (viewer.container) viewer.container.removeEventListener('contextmenu', () => {});
      } catch (e) { /* ignore */ }
      viewer.destroy();
    }
  } catch (err) {
    console.warn('destroy viewer error', err);
  }
  viewer = null;
  markersPlugin = null;
  currentPolygonPoints = [];
  currentVertexMarkerIds = [];
  polygonCount = 0;
}

// 获取所有已创建的多边形（返回 id 与 yaw/pitch 顶点数组）
export function getPolygons() {
  return polygonsStore.map(p => ({ id: p.id, points: p.points.slice() }));
}

// 按 id 获取单个多边形的顶点
export function getPolygonById(id: string) {
  const p = polygonsStore.find(x => x.id === id);
  return p ? { id: p.id, points: p.points.slice() } : null;
}

// 清除所有存储的多边形
export function clearPolygonsStore() {
  polygonsStore.length = 0;
  polygonCount = 0;
}
