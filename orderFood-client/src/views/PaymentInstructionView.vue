<template>
  <div class="payment-instruction-page">
    <!-- 顶部标题栏 -->
    <div class="header">
      <div class="header-content">
        <div class="store-name" v-if="storeName">{{ storeName }}</div>
        <h1>{{ instructionTitle }}</h1>
      </div>
      <button class="lang-switch-btn" @click="toggleLanguage">
        {{ currentLanguage === 'zh' ? 'EN' : '中' }}
      </button>
    </div>

    <!-- 付款指示内容 -->
    <div class="instruction-content">
      <div class="instruction-image-container">
        <img 
          :src="instructionImage" 
          :alt="instructionTitle"
          class="instruction-image"
          @error="handleImageError"
        />
      </div>
      <div class="instruction-text">
        <p class="main-instruction">{{ mainInstruction }}</p>
        <p class="sub-instruction" v-if="subInstruction">{{ subInstruction }}</p>
      </div>
    </div>

    <!-- 订单信息 -->
    <div class="order-info">
      <div class="order-summary">
        <div class="order-total">
          {{ currentLanguage === 'zh' ? '訂單金額：' : 'Order Amount: ' }}
          <span>${{ totalAmount.toFixed(2) }}</span>
        </div>
        <div class="payment-method-name">
          {{ currentLanguage === 'zh' ? '付款方式：' : 'Payment Method: ' }}
          <span>{{ paymentMethodName }}</span>
        </div>
      </div>
    </div>

    <!-- 底部操作区 -->
    <div class="footer-actions">
      <button class="cancel-btn" @click="cancelPayment">
        {{ currentLanguage === 'zh' ? '取消付款' : 'Cancel Payment' }}
      </button>
      <button class="confirm-btn" @click="confirmPayment" :disabled="isProcessing">
        {{ isProcessing 
          ? (currentLanguage === 'zh' ? '處理中...' : 'Processing...') 
          : (currentLanguage === 'zh' ? '確認付款' : 'Confirm Payment') 
        }}
      </button>
    </div>

    <!-- 提示信息 -->
    <div v-if="message" class="message" :class="messageType">
      {{ message }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { orderService } from '@/api';
import { ElMessage } from 'element-plus';

// 导入付款指示图片
import nfcInstructionImage from '@/assets/payment-instructions/nfc-payment.svg';
import qrcodeInstructionImage from '@/assets/payment-instructions/qrcode-payment.svg';

const router = useRouter();
const route = useRoute();

const orderItems = ref([]);
const totalAmount = ref(0);
const orderType = ref(0);
const paymentMethod = ref(null);
const isProcessing = ref(false);
const message = ref('');
const messageType = ref('');
const currentLanguage = ref('zh');
const storeName = ref('');

// 判断是否为NFC支付方式
const isNfcPayment = computed(() => {
  if (!paymentMethod.value) return false;
  const code = paymentMethod.value.code;
  return ['visa', 'mastercard', 'octopus'].includes(code);
});

// 判断是否为二维码支付方式
const isQrcodePayment = computed(() => {
  if (!paymentMethod.value) return false;
  const code = paymentMethod.value.code;
  return ['wechat', 'alipay'].includes(code);
});

// 获取付款指示图片
const instructionImage = computed(() => {
  if (isNfcPayment.value) {
    return nfcInstructionImage;
  } else if (isQrcodePayment.value) {
    return qrcodeInstructionImage;
  }
  return null;
});

// 获取指示标题
const instructionTitle = computed(() => {
  if (isNfcPayment.value) {
    return currentLanguage.value === 'zh' ? '請將卡片靠近感應區' : 'Please Tap Your Card';
  } else if (isQrcodePayment.value) {
    return currentLanguage.value === 'zh' ? '請掃描二維碼付款' : 'Please Scan QR Code';
  }
  return currentLanguage.value === 'zh' ? '付款指示' : 'Payment Instruction';
});

// 获取主要指示文字
const mainInstruction = computed(() => {
  if (isNfcPayment.value) {
    return currentLanguage.value === 'zh' 
      ? '請將您的卡片靠近NFC感應區域' 
      : 'Please tap your card near the NFC reader';
  } else if (isQrcodePayment.value) {
    return currentLanguage.value === 'zh' 
      ? '請使用手機掃描屏幕上的二維碼完成付款' 
      : 'Please scan the QR code on the screen with your phone to complete payment';
  }
  return '';
});

// 获取次要指示文字
const subInstruction = computed(() => {
  if (isNfcPayment.value) {
    return currentLanguage.value === 'zh' 
      ? '保持卡片穩定，直到聽到提示音' 
      : 'Keep your card steady until you hear a beep';
  } else if (isQrcodePayment.value) {
    return currentLanguage.value === 'zh' 
      ? '請使用微信或支付寶掃描' 
      : 'Please use WeChat or Alipay to scan';
  }
  return '';
});

// 获取付款方式名称
const paymentMethodName = computed(() => {
  if (!paymentMethod.value) return '';
  if (currentLanguage.value === 'en' && paymentMethod.value.nameEn) {
    return paymentMethod.value.nameEn;
  }
  return paymentMethod.value.name || '';
});

// 从路由参数获取数据
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
  if (route.query.paymentMethod) {
    try {
      paymentMethod.value = JSON.parse(decodeURIComponent(route.query.paymentMethod));
    } catch (e) {
      console.error('解析付款方式数据失败:', e);
    }
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
  
  loadStoreName();
});

// 切换语言
const toggleLanguage = () => {
  currentLanguage.value = currentLanguage.value === 'zh' ? 'en' : 'zh';
  localStorage.setItem('app_language', currentLanguage.value);
  loadStoreName();
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

// 处理图片加载错误
const handleImageError = (event) => {
  console.error('付款指示图片加载失败:', event);
  event.target.style.display = 'none';
};

// 确认付款（创建订单）
const confirmPayment = async () => {
  if (isProcessing.value || !paymentMethod.value) return;

  isProcessing.value = true;
  message.value = '';
  messageType.value = '';

  try {
    // 构建订单数据
    const orderData = {
      items: orderItems.value.map(item => ({
        mealId: item.id,
        quantity: item.quantity,
        price: item.price
      })),
      totalAmount: totalAmount.value,
      orderType: orderType.value,
      paymentMethodId: paymentMethod.value.id
    };

    const response = await orderService.create(orderData);
    
    if (response.data && response.data.success) {
      message.value = currentLanguage.value === 'zh' 
        ? '付款成功！正在列印小票...' 
        : 'Payment successful! Printing receipt...';
      messageType.value = 'success';
      
      // 清空购物车数据（订单创建成功后）
      try {
        localStorage.removeItem('order_cart_data');
      } catch (error) {
        console.warn('清空购物车数据失败:', error);
      }
      
      // 延迟后返回订单页面
      setTimeout(() => {
        ElMessage.success(currentLanguage.value === 'zh' 
          ? '訂單已創建，小票已列印' 
          : 'Order created, receipt printed');
        router.push('/order');
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

// 取消付款（返回付款方式选择页面）
const cancelPayment = () => {
  router.push({
    path: '/payment',
    query: {
      items: encodeURIComponent(JSON.stringify(orderItems.value)),
      totalAmount: totalAmount.value,
      orderType: orderType.value,
      language: currentLanguage.value
    }
  });
};
</script>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: "Microsoft YaHei", sans-serif;
}

.payment-instruction-page {
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

/* 付款指示内容 */
.instruction-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  overflow: hidden;
  min-height: 0;
}

.instruction-image-container {
  width: 100%;
  max-width: 400px;
  margin-bottom: 20px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.instruction-image {
  width: 100%;
  height: auto;
  max-height: 300px;
  object-fit: contain;
}

.instruction-text {
  text-align: center;
  padding: 0 20px;
}

.main-instruction {
  font-size: 22px;
  font-weight: bold;
  color: #333;
  margin-bottom: 10px;
  line-height: 1.5;
}

.sub-instruction {
  font-size: 16px;
  color: #666;
  line-height: 1.5;
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

.order-summary {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.order-total,
.payment-method-name {
  font-size: 18px;
  color: #333;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.order-total span,
.payment-method-name span {
  color: #e63946;
  font-weight: bold;
  font-size: 20px;
}

/* 底部操作区 */
.footer-actions {
  padding: 15px;
  background-color: white;
  box-shadow: 0 -3px 8px rgba(0, 0, 0, 0.1);
  flex-shrink: 0;
  display: flex;
  gap: 10px;
}

.cancel-btn,
.confirm-btn {
  flex: 1;
  padding: 12px 25px;
  border: none;
  border-radius: 20px;
  font-size: 18px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
}

.cancel-btn {
  background-color: #6c757d;
  color: white;
}

.cancel-btn:hover {
  background-color: #5a6268;
}

.cancel-btn:active {
  transform: scale(0.98);
}

.confirm-btn {
  background-color: #e63946;
  color: white;
}

.confirm-btn:hover:not(:disabled) {
  background-color: #d62839;
}

.confirm-btn:active:not(:disabled) {
  transform: scale(0.98);
}

.confirm-btn:disabled {
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
</style>
