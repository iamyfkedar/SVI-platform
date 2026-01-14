import '@photo-sphere-viewer/core/index.css'
import '@photo-sphere-viewer/markers-plugin/index.css'
import { Viewer } from '@photo-sphere-viewer/core';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';

const baseUrl = 'https://photo-sphere-viewer-data.netlify.app/assets/';

let viewer: Viewer | null = null;
let markersPlugin: any = null;
// 绘制控制开关（默认关闭）
let drawingEnabled = false;

export function setDrawingEnabled(enabled: boolean) {
  drawingEnabled = !!enabled;
}
export function enableDrawing() { setDrawingEnabled(true) }
export function disableDrawing() { setDrawingEnabled(false) }
export function isDrawingEnabled() { return drawingEnabled }

// 绘制面相关状态（模块级）
let currentPolygonPoints: [number, number][] = [];
let currentVertexMarkerIds: string[] = [];
let polygonCount = 0;
const polygonsStore: { id: string; points: [number, number][] }[] = [];
// 预绘制相关
let previewMarkerId: string | null = null;

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

  const onContainerMouseMove = (ev: MouseEvent) => {
    if (!viewer || !markersPlugin) return;
    if (!drawingEnabled) return; // 未启用绘制则不做预览
    // 如果还没开始绘制则忽略
    if (currentPolygonPoints.length === 0) return;
    
    try {
      const rect = viewer.container.getBoundingClientRect();
      const viewerX = ev.clientX - rect.left;
      const viewerY = ev.clientY - rect.top;

      // 返回与射线相交的点列表（EventsHandler 里也是用这个）
      const intersections = viewer.renderer.getIntersections({ x: viewerX, y: viewerY });
      const inter = intersections[0];
      if (!inter) {
          return;
      }
      // 把 THREE.Vector3 点转为球面坐标（yaw/pitch）
      const pos = viewer.dataHelper.vector3ToSphericalCoords(inter.point);
      if (!pos || typeof pos.yaw !== 'number' || typeof pos.pitch !== 'number') return;

      const cursorPoint: [number, number] = [pos.yaw, pos.pitch];
      const tempPoints = currentPolygonPoints.concat([cursorPoint]);

      // 更新或添加预览 marker（用特殊 id）
      const pid = previewMarkerId || ('preview-' + Math.random().toString(36).slice(2,9));
      if (previewMarkerId) {
        try { markersPlugin.removeMarker(previewMarkerId); } catch (e) { /* ignore */ }
      }

      // 当只有 2 个点时绘制临时线段（polyline），点数 >=3 时绘制多边形（polygon）
      const markerOptions: any = {
        id: pid,
        svgStyle: {
          fill: 'rgba(0, 200, 50, 0.3)',
          stroke: 'rgba(0, 200, 50, 0.8)',
          strokeWidth: '1px',
          strokeDasharray: '6,4',
          // 预览不应拦截鼠标事件，避免覆盖后续 click 无法触发
          pointerEvents: 'none'
        },
      }
      if (tempPoints.length === 2) {
        // 使用 polyline 字段绘制线（MarkersPlugin 支持 polyline）
        markerOptions.polyline = tempPoints
      } else {
        markerOptions.polygon = tempPoints
      }
      markersPlugin.addMarker(markerOptions)
      previewMarkerId = pid;
    } catch (err) { /* ignore */ }
  };

  // 把监听器注册到 viewer.container（DOM 节点），并在 destroy 时移除
  if (viewer && viewer.container && (viewer.container as HTMLElement).addEventListener) {
    (viewer.container as HTMLElement).addEventListener('mousemove', onContainerMouseMove);
  }

  // 点击添加顶点（左键）
  viewer.addEventListener('click', ({ data }: any) => {
    if (!drawingEnabled) return; // 仅在启用绘制时响应 click 添加顶点
    console.log('1111');
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
      // 点击后移除当前预览（下一次 mousemove 会重新生成）
      if (previewMarkerId) {
        try { markersPlugin.removeMarker(previewMarkerId); } catch (e) { /* ignore */ }
        previewMarkerId = null;
      }
    }
  });

  // 右键完成面（contextmenu 事件挂在 container）
  if (viewer.container) {
    viewer.container.addEventListener('contextmenu', (e: MouseEvent) => {
      if (!drawingEnabled) return; // 仅在启用绘制时允许完成面
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
        // 完成后移除预览（如果存在）
        if (previewMarkerId) {
          try { markersPlugin.removeMarker(previewMarkerId); } catch (e) { /* ignore */ }
          previewMarkerId = null;
        }
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
      try {
        if (viewer.container) {
          viewer.container.removeEventListener('contextmenu', () => {});
          // 移除我们添加的 mousemove 监听器（需要引用同一函数）
          try { (viewer.container as HTMLElement).removeEventListener('mousemove', onContainerMouseMove as any); } catch (e) { /* ignore */ }
        }
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
  // 清理预览 marker
  previewMarkerId = null;
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
