<template>
  <div class="order-page">
    <!-- 顶部标题栏 -->
    <div class="header">
      <div class="header-content">
        <div class="store-name" v-if="storeName">{{ storeName }}</div>
        <h1>{{ currentLanguage === 'zh' ? '自助點餐' : 'Self-Service Ordering' }}</h1>
      </div>
      <button class="lang-switch-btn" @click="toggleLanguage">
        {{ currentLanguage === 'zh' ? 'EN' : '中' }}
      </button>
    </div>

    <!-- 主体内容区 -->
    <div class="main-container">
      <!-- 套餐列表 -->
      <div class="meal-list">
        <div 
          v-for="meal in meals" 
          :key="meal.id"
          class="meal-card"
        >
          <div class="meal-icon">{{ meal.icon }}</div>
          <div class="meal-info">
            <div class="meal-name">{{ getMealName(meal) }}</div>
            <div class="meal-desc">{{ getMealDesc(meal) }}</div>
            <div class="meal-price">${{ meal.price }}</div>
          </div>
          <button class="add-btn" @click="addToCart(meal.id, getMealName(meal), meal.price)">
            + {{ currentLanguage === 'zh' ? '選餐' : 'Add' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 底部固定购物车 -->
    <div class="cart-section">
      <div class="cart-header">
      </div>
      <div class="cart-items">
        <div class="cart-empty" v-if="cartData.length === 0">
          {{ currentLanguage === 'zh' ? '未選餐' : 'No items' }}
        </div>
        <div 
          v-for="item in cartData" 
          :key="item.id"
          class="cart-item"
        >
          <div class="cart-item-name">{{ item.name }}</div>
          <div class="quantity-control">
            <button 
              class="num-btn" 
              @click="decreaseQuantity(item.id)"
            >-</button>
            <span class="cart-item-num">{{ item.quantity }}</span>
            <button class="num-btn" @click="increaseQuantity(item.id)">+</button>
          </div>
          <div class="cart-item-price">${{ (item.price * item.quantity).toFixed(2) }}</div>
          <button class="delete-btn" @click="removeItem(item.id)" title="刪除"></button>
        </div>
      </div>
      <!-- 订单类型选择器 - 暂时隐藏 -->
      <div class="order-type-selector" v-if="false">
        <div class="order-type-label">{{ currentLanguage === 'zh' ? '訂單類型：' : 'Order Type:' }}</div>
        <button 
          class="order-type-btn" 
          :class="{ active: orderType === 0 }"
          @click="orderType = 0"
        >
          {{ currentLanguage === 'zh' ? '堂食' : 'Dine In' }}
        </button>
        <button 
          class="order-type-btn" 
          :class="{ active: orderType === 1 }"
          @click="orderType = 1"
        >
          {{ currentLanguage === 'zh' ? '外賣' : 'Takeout' }}
        </button>
      </div>
      <div class="checkout-area">
        <div class="total-price">
          {{ currentLanguage === 'zh' ? '總計：' : 'Total: ' }}
          <span>${{ totalPrice.toFixed(2) }}</span>
        </div>
        <button 
          class="pay-btn" 
          :disabled="cartData.length === 0 || isProcessing"
          @click="handlePayment"
        >
          <span v-if="!isProcessing">{{ currentLanguage === 'zh' ? '立即付款' : 'Pay Now' }}</span>
          <span v-else>{{ currentLanguage === 'zh' ? '處理中...' : 'Processing...' }}</span>
        </button>
      </div>
    </div>

    <!-- 提示信息 -->
    <div v-if="message" class="message" :class="messageType">
      {{ message }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { orderService } from '@/api';
import { ElMessage } from 'element-plus';

const meals = ref([]);
const cartData = ref([]);
const isProcessing = ref(false);
const message = ref('');
const messageType = ref('');
const isLoadingMeals = ref(false);
const orderType = ref(0); // 0=堂食, 1=外賣
const currentLanguage = ref('zh'); // 'zh' 或 'en'
const storeName = ref(''); // 店鋪名稱

// 切换语言
const toggleLanguage = () => {
  currentLanguage.value = currentLanguage.value === 'zh' ? 'en' : 'zh';
  // 更新购物车中的商品名称
  cartData.value.forEach(item => {
    const meal = meals.value.find(m => m.id === item.mealId);
    if (meal) {
      item.name = getMealName(meal);
    }
  });
};

// 获取菜品名称（根据当前语言）
const getMealName = (meal) => {
  if (currentLanguage.value === 'en' && meal.nameEn) {
    return meal.nameEn;
  }
  return meal.name || '';
};

// 获取菜品描述（根据当前语言）
const getMealDesc = (meal) => {
  if (currentLanguage.value === 'en' && meal.descEn) {
    return meal.descEn;
  }
  return meal.desc || '';
};

// 计算总价
const totalPrice = computed(() => {
  return cartData.value.reduce((total, item) => {
    return total + (item.price * item.quantity);
  }, 0);
});

// 加入购物车
const addToCart = (id, name, price) => {
  const existingItem = cartData.value.find(item => item.id === id);
  if (existingItem) {
    existingItem.quantity += 1;
    // 更新名称（如果语言切换了）
    existingItem.name = name;
  } else {
    cartData.value.push({ 
      id, 
      name, 
      price, 
      quantity: 1,
      mealId: id // 保存 mealId 以便语言切换时更新名称
    });
  }
};

// 减少商品数量（可以减到0，自动移除）
const decreaseQuantity = (id) => {
  const itemIndex = cartData.value.findIndex(item => item.id === id);
  if (itemIndex > -1) {
    cartData.value[itemIndex].quantity -= 1;
    // 如果数量减到0或以下，从购物车移除
    if (cartData.value[itemIndex].quantity <= 0) {
      cartData.value.splice(itemIndex, 1);
    }
  }
};

// 删除商品
const removeItem = (id) => {
  const itemIndex = cartData.value.findIndex(item => item.id === id);
  if (itemIndex > -1) {
    cartData.value.splice(itemIndex, 1);
  }
};

// 增加商品数量
const increaseQuantity = (id) => {
  const existingItem = cartData.value.find(item => item.id === id);
  if (existingItem) {
    existingItem.quantity += 1;
  }
};

// 处理付款
const handlePayment = async () => {
  if (cartData.value.length === 0) {
    ElMessage.warning(currentLanguage.value === 'zh' ? '購物車為空，請先選擇套餐' : 'Cart is empty, please select a meal');
    return;
  }

  isProcessing.value = true;
  message.value = '';
  messageType.value = '';

  try {
    // 构建订单数据，支持多个商品
    const orderData = {
      items: cartData.value.map(item => ({
        mealId: item.id,
        quantity: item.quantity,
        price: item.price
      })),
      totalAmount: totalPrice.value,
      orderType: orderType.value // 0=堂食, 1=外賣
    };

    const response = await orderService.create(orderData);
    
    if (response.data && response.data.success) {
      message.value = currentLanguage.value === 'zh' 
        ? '付款成功！正在列印小票...' 
        : 'Payment successful! Printing receipt...';
      messageType.value = 'success';
      
      // 延迟后清空购物车
      setTimeout(() => {
        cartData.value = [];
        message.value = '';
        ElMessage.success(currentLanguage.value === 'zh' 
          ? '訂單已創建，小票已列印' 
          : 'Order created, receipt printed');
      }, 2000);
    } else {
      throw new Error(response.data?.message || (currentLanguage.value === 'zh' ? '付款失敗' : 'Payment failed'));
    }
  } catch (error) {
    console.error('付款失败:', error);
    message.value = error.response?.data?.message || error.message || 
      (currentLanguage.value === 'zh' ? '付款失敗，請重試' : 'Payment failed, please try again');
    messageType.value = 'error';
    ElMessage.error(message.value);
  } finally {
    isProcessing.value = false;
  }
};

// 加载菜品列表
const loadMeals = async () => {
  isLoadingMeals.value = true;
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
    }
  } catch (error) {
    console.error('加载菜品列表失败:', error);
    ElMessage.error(currentLanguage.value === 'zh' 
      ? '載入菜品列表失敗，使用預設數據' 
      : 'Failed to load meals, using default data');
    // 如果加载失败，使用默认数据
    meals.value = [
      { id: 1, name: '一菜套餐', icon: '🍱', desc: '精選一菜', price: 15 },
      { id: 2, name: '兩菜套餐', icon: '🍲', desc: '精選兩菜', price: 25 }
    ];
  } finally {
    isLoadingMeals.value = false;
  }
};

// 加载店铺名称
const loadStoreName = async () => {
  try {
    const response = await orderService.getSettings({ key: 'store_name' });
    if (response.data && response.data.success) {
      const data = response.data.data;
      // 如果返回的是字符串，直接使用
      if (typeof data === 'string') {
        storeName.value = data;
      } else if (data !== null && data !== undefined) {
        // 如果是其他类型，尝试转换为字符串
        storeName.value = String(data);
      }
    }
  } catch (error) {
    console.error('載入店鋪名稱失敗:', error);
    // 失败时使用默认值或留空
    storeName.value = '';
  }
};

onMounted(() => {
  loadMeals();
  loadStoreName();
});
</script>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: "Microsoft YaHei", sans-serif;
}

.order-page {
  background-color: #f8f8f8;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 顶部标题栏 */
.header {
  background-color: #e63946;
  color: white;
  padding: 12px 15px;
  text-align: center;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
  position: sticky;
  top: 0;
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
  top: 50%;
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

/* 主体内容区 */
.main-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 套餐列表区 */
.meal-list {
  flex: 1;
  padding: 15px;
  overflow-y: auto;
  display: grid;
  grid-template-columns: 1fr;
  gap: 15px;
}

/* 套餐卡片 */
.meal-card {
  background-color: white;
  border-radius: 10px;
  padding: 15px;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  gap: 15px;
  transition: transform 0.2s;
}

.meal-card:hover {
  transform: scale(1.02);
}

.meal-icon {
  font-size: 60px;
  width: 100px;
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background-color: #f5f5f5;
  border-radius: 8px;
}

.meal-info {
  flex: 1;
}

.meal-name {
  font-size: 20px;
  font-weight: bold;
  color: #333;
  margin-bottom: 5px;
}

.meal-desc {
  font-size: 14px;
  color: #666;
  margin-bottom: 8px;
}

.meal-price {
  font-size: 22px;
  color: #e63946;
  font-weight: bold;
}

.add-btn {
  background-color: #ffb703;
  border: none;
  color: white;
  padding: 8px 15px;
  font-size: 16px;
  border-radius: 20px;
  cursor: pointer;
  flex-shrink: 0;
}

.add-btn:hover {
  background-color: #fb8500;
}

/* 购物车 - 固定在底部 */
.cart-section {
  background-color: white;
  padding: 15px;
  box-shadow: 0 -3px 8px rgba(0, 0, 0, 0.1);
  z-index: 10;
  flex-shrink: 0;
}

.cart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.cart-title {
  font-size: 20px;
  font-weight: bold;
  color: #333;
}

.cart-empty {
  font-size: 16px;
  color: #999;
  text-align: center;
  padding: 10px 0;
}

.cart-items {
  max-height: 120px;
  overflow-y: auto;
  margin-bottom: 10px;
}

.cart-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  font-size: 16px;
  border-bottom: 1px solid #eee;
}

.cart-item-name {
  color: #333;
  flex: 1;
}

/* 数量控制按钮样式 */
.quantity-control {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-right: 10px;
}

.num-btn {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid #e63946;
  color: #e63946;
  background-color: white;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.num-btn:disabled {
  border-color: #ccc;
  color: #ccc;
  cursor: not-allowed;
}

.cart-item-num {
  font-size: 16px;
  width: 30px;
  text-align: center;
}

.cart-item-price {
  color: #e63946;
  font-weight: bold;
  min-width: 80px;
  text-align: right;
}

/* 订单类型选择器 */
.order-type-selector {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  padding: 8px 0;
  border-bottom: 1px solid #eee;
}

.order-type-label {
  font-size: 16px;
  color: #333;
  font-weight: 500;
}

.order-type-btn {
  padding: 6px 20px;
  border: 2px solid #ddd;
  border-radius: 20px;
  background-color: white;
  color: #666;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.order-type-btn:hover {
  border-color: #e63946;
  color: #e63946;
}

.order-type-btn.active {
  border-color: #e63946;
  background-color: #e63946;
  color: white;
}

.delete-btn {
  width: 28px;
  height: 28px;
  min-width: 28px;
  min-height: 28px;
  border-radius: 50%;
  border: 1px solid #999;
  color: #999;
  background-color: white;
  cursor: pointer;
  font-size: 18px;
  font-weight: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0;
  margin-left: 8px;
  transition: all 0.2s;
  box-sizing: border-box;
  line-height: 0;
  position: relative;
}

.delete-btn::before {
  content: '×';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 20px;
  font-weight: 300;
}

.delete-btn:hover {
  border-color: #e63946;
  color: #e63946;
  background-color: #fff5f5;
}

.checkout-area {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 10px;
  border-top: 2px solid #eee;
}

.total-price {
  font-size: 20px;
  font-weight: bold;
  color: #333;
}

.total-price span {
  color: #e63946;
}

.pay-btn {
  padding: 10px 25px;
  background-color: #e63946;
  color: white;
  border: none;
  border-radius: 20px;
  font-size: 18px;
  font-weight: bold;
  cursor: pointer;
}

.pay-btn:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}

/* 提示信息 */
.message {
  position: fixed;
  top: 80px;
  left: 50%;
  transform: translateX(-50%);
  padding: 15px 25px;
  border-radius: 8px;
  text-align: center;
  font-size: 16px;
  z-index: 1000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  animation: slideDown 0.3s ease;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

.message.success {
  background: #d4edda;
  color: #155724;
  border: 1px solid #c3e6cb;
}

.message.error {
  background: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
}

/* 响应式设计 */
@media (min-width: 768px) {
  .meal-list {
    grid-template-columns: repeat(2, 1fr);
    max-width: 1200px;
    margin: 0 auto;
    width: 100%;
  }
}
</style>
