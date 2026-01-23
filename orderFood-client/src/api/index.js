import axios from 'axios';

const API_URL = '/api';

const api = axios.create({
  baseURL: API_URL,
  timeout: 5000 // 5秒超时，打印操作已改为异步执行，不会阻塞响应
});

// 订单服务
export const orderService = {
  // 创建订单
  create: (orderData) => api.post('/orderfood/orders', orderData),
  // 获取套餐列表
  getMeals: () => api.get('/orderfood/meals'),
  // 获取付款方式列表
  getPaymentMethods: () => api.get('/orderfood/payment-methods'),
  // 获取系统设置
  getSettings: (params) => api.get('/orderfood/settings', { params }),
  // 更新系统设置
  updateSettings: (data) => api.put('/orderfood/settings', data)
};

export default {
  get: api.get,
  post: api.post,
  put: api.put,
  delete: api.delete,
  orderService
};
