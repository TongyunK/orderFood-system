const orderFoodService = require('../services/orderFoodService');
const logger = require('../utils/logger');

/**
 * 创建订单
 */
const createOrder = async (req, res) => {
  try {
    const { items, totalAmount, storeId, orderType, paymentMethodId } = req.body;
    
    // 验证必填字段
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ 
        success: false,
        message: '订单明细不能为空' 
      });
    }
    
    if (totalAmount === undefined || totalAmount <= 0) {
      return res.status(400).json({ 
        success: false,
        message: '订单总金额无效' 
      });
    }
    
    // 验证订单类型（0=堂食, 1=外卖）
    const validOrderType = orderType !== undefined ? (orderType === 0 || orderType === 1 ? orderType : 0) : 0;
    
    // 验证订单明细格式
    for (const item of items) {
      if (!item.mealId || !item.quantity || item.price === undefined) {
        return res.status(400).json({ 
          success: false,
          message: '订单明细格式不正确，需要 mealId, quantity, price' 
        });
      }
      
      if (item.quantity <= 0) {
        return res.status(400).json({ 
          success: false,
          message: '商品数量必须大于0' 
        });
      }
    }
    
    const result = await orderFoodService.createOrder({
      items,
      totalAmount,
      storeId: storeId || 1,
      orderType: validOrderType,
      paymentMethodId: paymentMethodId || null
    });
    
    res.status(200).json(result);
  } catch (error) {
    logger.error('创建订单失败:', error);
    res.status(500).json({ 
      success: false,
      message: error.message || '创建订单失败', 
      error: error.message 
    });
  }
};

/**
 * 获取套餐列表
 */
const getMeals = async (req, res) => {
  try {
    const { category } = req.query;
    
    const meals = await orderFoodService.getMeals({ category });
    
    res.status(200).json(meals);
  } catch (error) {
    logger.error('获取套餐列表失败:', error);
    res.status(500).json({ 
      success: false,
      message: '获取套餐列表失败', 
      error: error.message 
    });
  }
};

/**
 * 获取付款方式列表
 */
const getPaymentMethods = async (req, res) => {
  try {
    const paymentMethods = await orderFoodService.getPaymentMethods();
    
    res.status(200).json(paymentMethods);
  } catch (error) {
    logger.error('获取付款方式列表失败:', error);
    res.status(500).json({ 
      success: false,
      message: '获取付款方式列表失败', 
      error: error.message 
    });
  }
};

/**
 * 获取系统设置
 */
const getSettings = async (req, res) => {
  try {
    const { key } = req.query;
    
    const settings = await orderFoodService.getSettings(key);
    
    if (key && settings === null) {
      return res.status(404).json({ 
        success: false,
        message: `设置项 ${key} 不存在` 
      });
    }
    
    res.status(200).json({
      success: true,
      data: settings
    });
  } catch (error) {
    logger.error('获取系统设置失败:', error);
    res.status(500).json({ 
      success: false,
      message: '获取系统设置失败', 
      error: error.message 
    });
  }
};

module.exports = {
  createOrder,
  getMeals,
  getPaymentMethods,
  getSettings
};
