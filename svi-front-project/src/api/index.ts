import axios from 'axios'

const service = axios.create({
  baseURL: import.meta.env.VITE_BASE_API, // 根据环境变化
  timeout: 10000
})

// 请求拦截器
service.interceptors.request.use(
  (config) => {
    // 示例：自动带 Token
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// 响应拦截器
service.interceptors.response.use(
  (response) => response.data,
  (error) => {
    console.error('❌ API请求出错:', error)
    return Promise.reject(error)
  }
)

export default service
