import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

// 从环境变量获取后端地址，默认使用 127.0.0.1:3002
// 如果前后端在同一台机器上，使用 127.0.0.1 更高效
// 如果需要跨机器访问，可以通过环境变量设置：VITE_API_TARGET=http://10.10.8.70:3002
const API_TARGET = process.env.VITE_API_TARGET || 'http://127.0.0.1:3002';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  server: {
    host: '0.0.0.0', // 允许从其他设备访问
    proxy: {
      '/api': {
        target: API_TARGET, // 支持通过环境变量配置后端地址
        changeOrigin: true,
        secure: false,
        ws: false,
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, res) => {
            console.error('代理错误:', err.message);
          });
        }
      }
    }
  }
});
