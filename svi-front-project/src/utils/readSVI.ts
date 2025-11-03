// 上传文件的处理函数，解析文件名中的经纬度，并为每个点生成缓冲区以筛选相交建筑

import * as turf from '@turf/turf'

export type SVIItem = {
    file: string;       // 文件名
    fileData: File;     // 原始文件对象，用于上传
    lat: number;
    lon: number;
    rotation?: number;  // 从对应的 JSON 文件中读取的 rotation 值
    buildings?: any[];
}

export async function parseSVIFileList(fileList: FileList | File[] | null): Promise<SVIItem[]> {
    const results: SVIItem[] = []
    if (!fileList) return results

    // 将文件列表转换为数组并按文件名排序
    // 显式处理 FileList 和 File[] 的类型转换
    const files = Array.from<File>(
        'items' in fileList ? fileList : fileList as Iterable<File>
    ).sort((a, b) => a.name.localeCompare(b.name))

    // 创建文件名到文件的映射，使用显式的类型
    const fileMap = new Map<string, File>(
        files.map((f): [string, File] => [f.name, f])
    )

    for (const file of files) {
        const filename = file.name
        // 跳过 JSON 文件，只处理图片
        if (filename.endsWith('.json')) continue
        if (!/\.(jpe?g|png)$/i.test(filename)) continue

        const name = filename.replace(/\.[^/.]+$/, '')
        const matches = name.match(/-?\d+\.\d+/g)
        let item: SVIItem | null = null

        if (matches && matches.length >= 2) {
            const latStr = matches[matches.length - 2]
            const lonStr = matches[matches.length - 1]
            if (latStr && lonStr) {
                const lat = parseFloat(latStr)
                const lon = parseFloat(lonStr)
                if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
                    item = { file: filename, fileData: file, lat, lon }
                }
            }
        } else {
            const parts = name.split(',')
            if (parts.length >= 3) {
                const latStr = parts[1]
                const lonStr = parts[2]
                if (latStr && lonStr) {
                    const maybeLat = parseFloat(latStr)
                    const maybeLon = parseFloat(lonStr)
                    if (!Number.isNaN(maybeLat) && !Number.isNaN(maybeLon)) {
                        item = { file: filename, fileData: file, lat: maybeLat, lon: maybeLon }
                    }
                }
            }
        }

        // 如果成功创建了 item，尝试读取对应的 JSON 文件
        if (item) {
            const jsonFilename = `${name}.metadata.json`
            const jsonFile = fileMap.get(jsonFilename)
            
            if (jsonFile) {
                try {
                    const reader = new FileReader()
                    const text = await new Promise<string>((resolve, reject) => {
                        reader.onload = () => {
                            // 显式类型转换确保 result 是字符串
                            const result = reader.result as string
                            resolve(result)
                        }
                        reader.onerror = () => reject(reader.error)
                        reader.readAsText(jsonFile)
                    })

                    const metadata = JSON.parse(text) as { rotation?: number }
                    if (typeof metadata.rotation === 'number') {
                        item.rotation = metadata.rotation
                    }
                } catch (err) {
                    console.warn(`Error processing JSON file ${jsonFilename}:`, err)
                }
            }
            results.push(item)
        }
    }
    return results
}

// 添加上传函数
export async function uploadSVIFiles(items: SVIItem[], uniqueBuildings?: any[]): Promise<any> {
    const formData = new FormData()
    
    items.forEach((item, index) => {
        formData.append(`files[${index}]`, item.fileData)
        formData.append(`coords[${index}]`, JSON.stringify({
            lat: item.lat,
            lon: item.lon,
            filename: item.file,
            rotation: item.rotation,
            buildings: item.buildings || []
        }))
    })

    // 将去重后的 uniqueBuildings 一并上传（作为一个 JSON 字段）
    formData.append('uniqueBuildings', JSON.stringify(uniqueBuildings || []))

     // 发送到后端 API
     const USE_MOCK = true  // MOCK开关
 
     let response
 
     if (USE_MOCK) {
         // 模拟 fetch 的返回结果
         response = {
             ok: true,
             status: 200,
             json: async () => ({ message: 'Mock upload success', url: '/mock/image.jpg', formDataSummary: [...formData.entries()].map(([k,v]) => [k, v instanceof File ? v.name : v]) })
         }
     } else {
         // 真正请求后端
         response = await fetch('/api/upload-svi', {
             method: 'POST',
             body: formData
         })
     }
 
     if (!response.ok) {
         throw new Error(`Upload failed: ${response.statusText}`)
     }
 
     return await response.json()
}

/**
 * 批量处理上传的文件：为每个点生成缓冲并筛选相交建筑，支持进度回调
 * options:
 *  - features: 已加载的建筑要素数组（来自 map.querySourceFeatures 或 queryRenderedFeatures）
 *  - radiusMeters: 缓冲半径（米）
 *  - onProgress: (processed, total, percent) => void
 */
export async function processSVIFiles(
    fileList: FileList | File[] | null,
    options: {
        features?: any[],
        radiusMeters?: number,
        onProgress?: (processed: number, total: number, percent: number) => void
    } = {}
): Promise<{ coords: SVIItem[], uniqueBuildings: any[] }> {
    const coords = await parseSVIFileList(fileList)
    const total = coords.length
    const features = options.features || []
    const radius = typeof options.radiusMeters === 'number' ? options.radiusMeters : 50
    for (let i = 0; i < coords.length; i++) {
        const c = coords[i]
        if (c && features.length && c.lon != null && c.lat != null) {
            const center = [c.lon, c.lat]
            const circle = turf.circle(center, radius / 1000, { units: 'kilometers' })
            const intersected = features.filter(f => {
                try { return turf.booleanIntersects(f, circle) } catch (err) { return false }
            })
            c.buildings = intersected
        } else if(c) {
            c.buildings = []
        }
        const processed = i + 1
        const percent = total ? Math.round((processed / total) * 100) : 100
        options.onProgress && options.onProgress(processed, total, percent)
        await new Promise(resolve => setTimeout(resolve, 0))
    }
    console.log('coods', coords);
    
    // 汇总并去重
    const allIntersected: any[] = []
    coords.forEach(c => {
        if (Array.isArray(c.buildings) && c.buildings.length) allIntersected.push(...c.buildings)
    })
    const seen = new Set<string>()
    const uniqueBuildings: any[] = []
    for (const f of allIntersected) {
        const key = (f && f.id != null)
            ? `id:${f.id}`
            : `geom:${JSON.stringify(f.geometry)}|props:${JSON.stringify(f.properties || {})}`
        if (!seen.has(key)) {
            seen.add(key)
            uniqueBuildings.push(f)
        }
    }

    return { coords, uniqueBuildings }
}