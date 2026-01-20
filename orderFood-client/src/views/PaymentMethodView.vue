<template>
  <div class="payment-page">
    <!-- 顶部标题栏 -->
    <div class="header">
      <div class="header-content">
        <div class="store-name" v-if="storeName">{{ storeName }}</div>
        <h1>{{ currentLanguage === 'zh' ? '選擇付款方式' : 'Select Payment Method' }}</h1>
      </div>
      <button class="lang-switch-btn" @click="toggleLanguage">
        {{ currentLanguage === 'zh' ? 'EN' : '中' }}
      </button>
    </div>

    <!-- 订单信息 -->
    <div class="order-info">
      <div class="order-summary">
        <div class="order-items">
          <div 
            v-for="item in orderItems" 
            :key="item.id"
            class="order-item"
          >
            <span class="item-name">{{ item.name }}</span>
            <span class="item-quantity">x{{ item.quantity }}</span>
            <span class="item-price">${{ (item.price * item.quantity).toFixed(2) }}</span>
          </div>
        </div>
        <div class="order-total">
          {{ currentLanguage === 'zh' ? '總計：' : 'Total: ' }}
          <span>${{ totalAmount.toFixed(2) }}</span>
        </div>
      </div>
    </div>

    <!-- 付款方式列表 -->
    <div class="payment-methods">
      <div 
        v-for="method in paymentMethods" 
        :key="method.id"
        class="payment-method-card"
        @click="selectPaymentMethod(method)"
      >
        <div class="method-icon">
          <img 
            v-if="getPaymentIcon(method.code)" 
            :src="getPaymentIcon(method.code)" 
            :alt="getMethodName(method)"
            @error="$event.target.style.display='none'; $event.target.nextElementSibling?.style.setProperty('display', 'block')"
          />
          <span 
            v-if="!getPaymentIcon(method.code)" 
            class="icon-placeholder"
          >{{ method.icon || '💳' }}</span>
          <span 
            v-else
            class="icon-placeholder"
            style="display: none;"
          >{{ method.icon || '💳' }}</span>
        </div>
        <div class="method-info">
          <div class="method-name">{{ getMethodName(method) }}</div>
        </div>
      </div>
    </div>

    <!-- 返回按钮 -->
    <div class="footer-actions">
      <button class="back-btn" @click="goBack">
        {{ currentLanguage === 'zh' ? '返回' : 'Back' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { orderService } from '@/api';
import { ElMessage } from 'element-plus';

// 导入付款方式图标
import wechatIcon from '@/assets/payment-icons/wechat.svg';
import alipayIcon from '@/assets/payment-icons/alipay.svg';
import visaIcon from '@/assets/payment-icons/visa.svg';
import mastercardIcon from '@/assets/payment-icons/mastercard.svg';
import octopusIcon from '@/assets/payment-icons/octopus.svg';
import cashIcon from '@/assets/payment-icons/cash.svg';

const router = useRouter();
const route = useRoute();

const paymentMethods = ref([]);
const orderItems = ref([]);
const totalAmount = ref(0);
const orderType = ref(0);
const currentLanguage = ref('zh');
const storeName = ref('');

// 从路由参数获取订单数据
onMounted(() => {
  if (route.query.items) {
    try {
      orderItems.value = JSON.parse(decodeURIComponent(route.query.items));
    } catch (e) {
      console.error('解析订单数据失败:', e);
    }
  }
  if (route.query.totalAmount) {
    totalAmount.value = parseFloat(route.query.totalAmount);
  }
  if (route.query.orderType !== undefined) {
    orderType.value = parseInt(route.query.orderType);
  }
  // 优先使用路由参数中的语言，否则从 localStorage 读取
  if (route.query.language) {
    currentLanguage.value = route.query.language;
    localStorage.setItem('app_language', route.query.language);
  } else {
    const savedLanguage = localStorage.getItem('app_language');
    if (savedLanguage === 'zh' || savedLanguage === 'en') {
      currentLanguage.value = savedLanguage;
    }
  }
  
  loadPaymentMethods();
  loadStoreName();
});

// 切换语言
const toggleLanguage = () => {
  currentLanguage.value = currentLanguage.value === 'zh' ? 'en' : 'zh';
  // 保存语言设置到 localStorage
  localStorage.setItem('app_language', currentLanguage.value);
  // 重新加载店铺名称（根据新语言）
  loadStoreName();
};

// 获取付款方式名称（根据当前语言）
const getMethodName = (method) => {
  if (currentLanguage.value === 'en' && method.nameEn) {
    return method.nameEn;
  }
  return method.name || '';
};

// 付款方式图标映射
const paymentIcons = {
  wechat: wechatIcon,
  alipay: alipayIcon,
  visa: visaIcon,
  mastercard: mastercardIcon,
  octopus: octopusIcon,
  cash: cashIcon
};

// 获取付款方式官方图标
const getPaymentIcon = (code) => {
  return paymentIcons[code] || null;
};

// 加载付款方式列表
const loadPaymentMethods = async () => {
  try {
    const response = await orderService.getPaymentMethods();
    if (response.data && Array.isArray(response.data)) {
      paymentMethods.value = response.data;
    }
  } catch (error) {
    console.error('加载付款方式列表失败:', error);
    ElMessage.error(currentLanguage.value === 'zh' 
      ? '載入付款方式失敗' 
      : 'Failed to load payment methods');
  }
};

// 加载店铺名称（根据当前语言）
const loadStoreName = async () => {
  try {
    const key = currentLanguage.value === 'en' ? 'store_name_en' : 'store_name_zh';
    const response = await orderService.getSettings({ key });
    if (response.data && response.data.success) {
      const data = response.data.data;
      if (typeof data === 'string') {
        storeName.value = data;
      } else if (data !== null && data !== undefined) {
        storeName.value = String(data);
      }
    } else {
      // 如果当前语言的店铺名称不存在，尝试使用另一种语言
      const fallbackKey = currentLanguage.value === 'en' ? 'store_name_zh' : 'store_name_en';
      const fallbackResponse = await orderService.getSettings({ key: fallbackKey });
      if (fallbackResponse.data && fallbackResponse.data.success) {
        const fallbackData = fallbackResponse.data.data;
        if (typeof fallbackData === 'string') {
          storeName.value = fallbackData;
        } else if (fallbackData !== null && fallbackData !== undefined) {
          storeName.value = String(fallbackData);
        }
      }
    }
  } catch (error) {
    console.error('載入店鋪名稱失敗:', error);
    storeName.value = '';
  }
};

// 选择付款方式
const selectPaymentMethod = (method) => {
  console.log('选择付款方式:', method);
  console.log('订单数据:', {
    items: orderItems.value,
    totalAmount: totalAmount.value,
    orderType: orderType.value
  });
  
  // 跳转到付款指示页面
  router.push({
    path: '/payment-instruction',
    query: {
      items: encodeURIComponent(JSON.stringify(orderItems.value)),
      totalAmount: totalAmount.value,
      orderType: orderType.value,
      paymentMethod: encodeURIComponent(JSON.stringify(method)),
      language: currentLanguage.value
    }
  }).catch(err => {
    console.error('路由跳转失败:', err);
  });
};

// 返回订单页面
const goBack = () => {
  router.push('/order');
};
</script>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: "Microsoft YaHei", sans-serif;
}

.payment-page {
  background-color: #f8f8f8;
  height: 37.04vh;
  width: 37.04vw;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform: scale(2.7);
  transform-origin: top left;
  position: fixed;
  top: 0;
  left: 0;
}

/* 顶部标题栏 */
.header {
  background-color: #e63946;
  color: white;
  padding: 12px 15px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
  z-index: 10;
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
}

.header-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.store-name {
  font-size: 18px;
  font-weight: 500;
  margin-bottom: 4px;
  line-height: 1.2;
}

.header h1 {
  font-size: 28px;
  font-weight: bold;
  margin: 0;
  line-height: 1.2;
}

.lang-switch-btn {
  position: absolute;
  right: 15px;
  top: 40%;
  transform: translateY(-50%);
  background-color: rgba(255, 255, 255, 0.2);
  border: 2px solid rgba(255, 255, 255, 0.5);
  color: white;
  padding: 6px 12px;
  border-radius: 20px;
  cursor: pointer;
  font-size: 14px;
  font-weight: bold;
  transition: all 0.3s;
}

.lang-switch-btn:hover {
  background-color: rgba(255, 255, 255, 0.3);
  border-color: rgba(255, 255, 255, 0.8);
}

/* 订单信息 */
.order-info {
  background-color: white;
  padding: 15px;
  margin: 10px 15px;
  border-radius: 10px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
  flex-shrink: 0;
}

.order-items {
  margin-bottom: 10px;
}

.order-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  font-size: 16px;
  border-bottom: 1px solid #eee;
}

.order-item:last-child {
  border-bottom: none;
}

.item-name {
  flex: 1;
  color: #333;
}

.item-quantity {
  color: #666;
  margin: 0 10px;
}

.item-price {
  color: #e63946;
  font-weight: bold;
  min-width: 80px;
  text-align: right;
}

.order-total {
  font-size: 20px;
  font-weight: bold;
  color: #333;
  text-align: right;
  padding-top: 10px;
  border-top: 2px solid #eee;
}

.order-total span {
  color: #e63946;
  font-size: 24px;
}

/* 付款方式列表 */
.payment-methods {
  flex: 1;
  padding: 10px 15px;
  overflow: hidden;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  min-height: 0;
}

.payment-method-card {
  background-color: white;
  border-radius: 10px;
  padding: 15px;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  cursor: pointer;
  transition: all 0.2s;
  min-height: 0;
}

.payment-method-card:hover {
  transform: scale(1.02);
  box-shadow: 0 5px 12px rgba(0, 0, 0, 0.15);
}

.payment-method-card:active {
  transform: scale(0.98);
}

.method-icon {
  width: 60px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background-color: #f5f5f5;
  border-radius: 10px;
  padding: 0;
  overflow: hidden;
}

.method-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.method-icon .icon-placeholder {
  font-size: 40px;
  display: block;
}

.method-info {
  width: 100%;
  text-align: center;
}

.method-name {
  font-size: 18px;
  font-weight: bold;
  color: #333;
  word-break: break-word;
}

/* 底部操作区 */
.footer-actions {
  padding: 15px;
  background-color: white;
  box-shadow: 0 -3px 8px rgba(0, 0, 0, 0.1);
  flex-shrink: 0;
}

.back-btn {
  width: 100%;
  padding: 12px 25px;
  background-color: #6c757d;
  color: white;
  border: none;
  border-radius: 20px;
  font-size: 18px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
}

.back-btn:hover {
  background-color: #5a6268;
}

.back-btn:active {
  transform: scale(0.98);
}

</style>
