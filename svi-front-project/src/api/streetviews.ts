import request from './index'

/**
 * 封装 streetviews 通用操作
 */
const streetviewsApi = {
  // 获取所有 streetviews（可带查询参数）
  list(params?: Record<string, any>) {
    return request.get('/streetview/image/all', { params })
  },

  // 根据 id 获取单个 streetview
  get(id: string | number) {
    return request.get(`/streetview/image/${id}`)
  },

  getMask(id: string | number) {
    return request.get(`/streetview/mask/${id}`)
  }, 

  // 根据 id 获取附近20米内的 streetview
  getNearImage(id: string | number){
    return request.get(`/streetview/nearby/${id}`)
  }
}


// 兼容性导出：按需导出具体函数
export const getAllStreetviews = (params?: Record<string, any>) => streetviewsApi.list(params)
export const getStreetviewById = (id: string | number) => streetviewsApi.get(id)
export const getStreetviewMaskById = (id: string | number) => streetviewsApi.getMask(id)
export const getNearbyStreetviewById = (id: string | number) => streetviewsApi.getNearImage(id)

