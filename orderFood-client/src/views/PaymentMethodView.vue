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
      <!-- 银行卡和二维码分别占满一行 -->
      <template v-for="method in fullWidthMethods" :key="method.id">
        <div 
          class="payment-method-card full-width-card"
          @click="selectPaymentMethod(method)"
        >
          <div class="method-info">
            <div class="method-header">
              <img 
                :src="getMethodHeaderIcon(method.id)" 
                :alt="getMethodName(method)"
                class="method-header-icon"
              />
              <div class="method-name">{{ getMethodName(method) }}</div>
            </div>
          </div>
          <div class="method-icon multiple-icons">
            <img 
              v-for="(icon, index) in getPaymentIcons(method.id)" 
              :key="index"
              :src="icon" 
              :alt="getMethodName(method)"
              class="icon-item"
            />
          </div>
        </div>
      </template>
      
      <!-- 八达通、FPS、PayMe在同一行显示，不显示文字 -->
      <div class="payment-method-row">
        <div 
          v-for="method in compactMethods" 
          :key="method.id"
          class="payment-method-card compact-card"
          @click="selectPaymentMethod(method)"
        >
          <div class="method-icon">
            <img 
              v-if="getPaymentIcon(method.id)" 
              :src="getPaymentIcon(method.id)" 
              :alt="getMethodName(method)"
              @error="$event.target.style.display='none'; $event.target.nextElementSibling?.style.setProperty('display', 'block')"
            />
            <span 
              v-if="!getPaymentIcon(method.id)" 
              class="icon-placeholder"
            >{{ method.icon || '💳' }}</span>
            <span 
              v-else
              class="icon-placeholder"
              style="display: none;"
            >{{ method.icon || '💳' }}</span>
          </div>
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

// 导入银行卡图标
import visaIcon from '@/assets/payment-icons/bankCard/visa.svg';
import mastercardIcon from '@/assets/payment-icons/bankCard/Mastercard.svg';
import amexIcon from '@/assets/payment-icons/bankCard/cc-amex.svg';
import unionPayIcon from '@/assets/payment-icons/bankCard/China-UnionPay.svg';
import jcbIcon from '@/assets/payment-icons/bankCard/jcb.svg';
import dinersClubIcon from '@/assets/payment-icons/bankCard/diners-club.svg';

// 导入二维码图标
import wechatIcon from '@/assets/payment-icons/QRcode/wechat.svg';
import alipayIcon from '@/assets/payment-icons/QRcode/alipay.svg';
import unionPayQRIcon from '@/assets/payment-icons/QRcode/云闪付支付.svg';

// 导入主图标
import bankCardHeaderIcon from '@/assets/payment-icons/bankcard.svg';
import qrCodeHeaderIcon from '@/assets/payment-icons/qrcode.svg';

// 导入单个图标
import octopusIcon from '@/assets/payment-icons/octopus.svg';
import fpsIcon from '@/assets/payment-icons/FPS.svg';
import paymeIcon from '@/assets/payment-icons/payme.svg';

const router = useRouter();
const route = useRoute();

const paymentMethods = ref([]);
const orderItems = ref([]);
const meals = ref([]); // 存储菜品列表，用于根据语言更新名称
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
  loadMeals(); // 加载菜品列表
});

// 切换语言
const toggleLanguage = () => {
  currentLanguage.value = currentLanguage.value === 'zh' ? 'en' : 'zh';
  // 保存语言设置到 localStorage
  localStorage.setItem('app_language', currentLanguage.value);
  // 重新加载店铺名称（根据新语言）
  loadStoreName();
  // 更新订单项的名称（根据新语言）
  updateOrderItemNames();
};

// 获取菜品名称（根据当前语言）
const getMealName = (meal) => {
  if (currentLanguage.value === 'en' && meal.nameEn) {
    return meal.nameEn;
  }
  return meal.name || '';
};

// 更新订单项的名称（根据当前语言）
const updateOrderItemNames = () => {
  orderItems.value.forEach(item => {
    // 注意：mealId 可能为 0（飲品），因此不能用簡單的 if (item.mealId) 判斷
    if (item.mealId !== undefined && item.mealId !== null) {
      const meal = meals.value.find(m => m.id === item.mealId);
      if (meal) {
        item.name = getMealName(meal);
      }
    }
  });
};

// 加载菜品列表
const loadMeals = async () => {
  try {
    const response = await orderService.getMeals();
    if (response.data && Array.isArray(response.data)) {
      meals.value = response.data.map(meal => ({
        id: meal.id,
        name: meal.name || meal.name_zh || '',
        nameEn: meal.nameEn || meal.name_en || '',
        desc: meal.desc || meal.desc_zh || '',
        descEn: meal.descEn || meal.desc_en || '',
        price: meal.price,
        icon: meal.icon || '🍽️',
        category: meal.category
      }));
      // 加载完成后，更新订单项的名称
      updateOrderItemNames();
    }
  } catch (error) {
    console.error('加载菜品列表失败:', error);
  }
};

// 获取付款方式名称（根据当前语言）
const getMethodName = (method) => {
  if (currentLanguage.value === 'en' && method.nameEn) {
    return method.nameEn;
  }
  return method.name || '';
};

// 分离全宽显示的付款方式（银行卡和二维码）
const fullWidthMethods = computed(() => {
  return paymentMethods.value.filter(method => method.id === 1 || method.id === 2);
});

// 分离紧凑显示的付款方式（八达通、FPS、PayMe）
const compactMethods = computed(() => {
  return paymentMethods.value.filter(method => method.id === 3 || method.id === 4 || method.id === 5);
});

// 获取银行卡图标列表
const getBankCardIcons = () => {
  return [visaIcon, mastercardIcon, jcbIcon, amexIcon, unionPayIcon, dinersClubIcon];
};

// 获取二维码图标列表
const getQRCodeIcons = () => {
  return [alipayIcon, wechatIcon, unionPayQRIcon];
};

// 判断付款方式是否有多个图标
const hasMultipleIcons = (methodId) => {
  return methodId === 1 || methodId === 2; // 银行卡(id=1)和二维码(id=2)有多个图标
};

// 获取付款方式图标列表（用于银行卡和二维码）
const getPaymentIcons = (methodId) => {
  if (methodId === 1) {
    return getBankCardIcons();
  } else if (methodId === 2) {
    return getQRCodeIcons();
  }
  return [];
};

// 获取付款方式的主图标（用于文字左边显示）
const getMethodHeaderIcon = (methodId) => {
  switch (methodId) {
    case 1: // 银行卡
      return bankCardHeaderIcon;
    case 2: // 二维码
      return qrCodeHeaderIcon;
    default:
      return null;
  }
};

// 获取单个付款方式图标（用于八达通、FPS、PayMe）
const getPaymentIcon = (methodId) => {
  switch (methodId) {
    case 3: // 八达通
      return octopusIcon;
    case 4: // FPS
      return fpsIcon;
    case 5: // PayMe
      return paymeIcon;
    default:
      return null;
  }
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
  height: 41.66vh;
  width: 41.66vw;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform: scale(2.4);
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
  overflow-y: auto;
  display: flex;
  flex-direction: column;
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

.payment-method-card.full-width-card {
  width: 100%;
  flex-direction: row;
  justify-content: flex-start;
  align-items: center;
  gap: 15px;
  padding: 15px 20px;
  overflow: hidden;
}

.payment-method-card.full-width-card .method-info {
  flex: 1 1 0;
  text-align: left;
  min-width: 0;
  max-width: 33.33%;
}

.method-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.method-header-icon {
  width: 32px;
  height: 32px;
  object-fit: contain;
  flex-shrink: 0;
}

.payment-method-card.full-width-card .method-name {
  flex: 1;
}

.payment-method-card.full-width-card .method-icon {
  flex: 2 1 0;
  min-width: 0;
  max-width: 66.67%;
  justify-content: flex-start;
  overflow: visible;
}

.payment-method-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  width: 100%;
}

.payment-method-card.compact-card {
  padding: 10px 15px;
  min-height: 60px;
  height: 60px;
  justify-content: center;
  align-items: center;
}

.payment-method-card.compact-card .method-icon {
  width: 100%;
  height: 100%;
  max-height: 50px;
  display: flex;
  align-items: center;
  justify-content: center;
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
  background-color: transparent;
  border-radius: 10px;
  padding: 0;
  overflow: hidden;
}

.method-icon.multiple-icons {
  width: 100%;
  max-width: 100%;
  height: auto;
  min-height: 50px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 5px 0;
  align-items: center;
  overflow: visible;
}

.method-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.payment-method-card.compact-card .method-icon img {
  width: auto;
  height: 100%;
  max-width: 100%;
  max-height: 50px;
  object-fit: contain;
}

.method-icon.multiple-icons .icon-item {
  width: 100%;
  height: 35px;
  max-width: 100%;
  object-fit: contain;
  display: block;
  margin: 0;
}

.method-icon .icon-placeholder {
  font-size: 40px;
  display: block;
}

.method-info {
  width: 100%;
  text-align: center;
}

.payment-method-card.full-width-card .method-info {
  text-align: left;
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
