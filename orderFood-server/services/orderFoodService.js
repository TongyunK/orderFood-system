const printerService = require('./printerService');
const logger = require('../utils/logger');
const { Order, OrderItem, Meal, PaymentMethod } = require('../models');
const { Op } = require('sequelize');

/**
 * 创建订单并打印小票
 * @param {Object} orderData - 订单数据
 * @param {Array} orderData.items - 订单明细数组 [{mealId, quantity, price}, ...]
 * @param {number} orderData.totalAmount - 订单总金额
 * @param {number} orderData.storeId - 店铺ID（可选，默认为1）
 * @param {number} orderData.orderType - 订单类型（可选，0=堂食, 1=外卖，默认为0）
 * @param {number} orderData.paymentMethodId - 付款方式ID（可选）
 * @returns {Promise<{success: boolean, message: string, orderNumber?: string}>}
 */
const createOrder = async (orderData) => {
  const { items, totalAmount, storeId = 1, orderType = 0, paymentMethodId } = orderData;
  
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error('订单明细不能为空');
  }
  
  try {
    // 生成订单号（格式：OF + 时间戳后8位）
    const timestamp = Date.now().toString();
    const orderNumber = `OF${timestamp.slice(-8)}`;
    
    // 验证菜品是否存在并获取菜品信息
    const mealIds = items.map(item => item.mealId);
    const meals = await Meal.findAll({
      where: {
        id: { [Op.in]: mealIds },
        is_active: true
      }
    });
    
    if (meals.length !== mealIds.length) {
      throw new Error('部分菜品不存在或已下架');
    }
    
    // 验证付款方式（如果提供了）
    let paymentMethod = null;
    if (paymentMethodId) {
      paymentMethod = await PaymentMethod.findOne({
        where: {
          id: paymentMethodId,
          is_active: true
        }
      });
      if (!paymentMethod) {
        throw new Error('付款方式不存在或已禁用');
      }
    }
    
    // 创建订单（使用事务）
    const transaction = await Order.sequelize.transaction();
    
    try {
      // 创建订单主表
      const order = await Order.create({
        order_number: orderNumber,
        store_id: storeId,
        total_amount: totalAmount,
        order_type: orderType, // 0=堂食, 1=外卖
        payment_method_id: paymentMethodId || null,
        status: 'paid', // 已支付（因为付款功能暂不开发，这里直接设为已支付）
        print_status: null,
        print_message: null
      }, { transaction });
      
      // 创建订单明细
      const orderItems = [];
      for (const item of items) {
        const meal = meals.find(m => m.id === item.mealId);
        const subtotal = item.price * item.quantity;
        
        const orderItem = await OrderItem.create({
          order_id: order.id,
          meal_id: item.mealId,
          quantity: item.quantity,
          price: item.price,
          subtotal: subtotal
        }, { transaction });
        
        orderItems.push({
          ...orderItem.toJSON(),
          meal: meal
        });
      }
      
      // 提交事务
      await transaction.commit();
      
      // 准备打印数据
      const printData = {
        order_number: orderNumber,
        items: orderItems.map(item => ({
          name: item.meal.name_zh || item.meal.name_en,
          quantity: item.quantity,
          price: item.price,
          subtotal: item.subtotal
        })),
        total_amount: totalAmount,
        order_time: new Date().toLocaleString('zh-CN', { 
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })
      };
      
      // 调用打印机服务打印小票
      const printResult = await printerService.printOrderReceipt(printData);
      
      // 更新订单的打印状态
      await order.update({
        print_status: printResult.success ? 'success' : 'error',
        print_message: printResult.message
      });
      
      logger.info('订单已保存到数据库', { 
        orderNumber,
        orderId: order.id,
        itemCount: orderItems.length
      });
      
      if (printResult.success) {
        logger.info('订单创建成功并已打印小票', {
          orderNumber,
          totalAmount,
          itemCount: orderItems.length
        });
        
        return {
          success: true,
          message: '订单创建成功，小票已打印',
          orderNumber: orderNumber
        };
      } else {
        logger.warn('订单创建成功，但打印失败', {
          orderNumber,
          totalAmount,
          printError: printResult.message
        });
        
        return {
          success: true,
          message: `订单创建成功，但打印失败: ${printResult.message}`,
          orderNumber: orderNumber
        };
      }
    } catch (error) {
      // 回滚事务
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    logger.error('创建订单失败:', error);
    throw error;
  }
};

/**
 * 获取所有启用的菜品列表
 * @param {Object} options - 查询选项
 * @param {string} options.category - 分类筛选（可选）
 * @returns {Promise<Array>}
 */
const getMeals = async (options = {}) => {
  try {
    const where = {
      is_active: true
    };
    
    if (options.category) {
      where.category = options.category;
    }
    
    const meals = await Meal.findAll({
      where,
      order: [['sort_order', 'ASC'], ['id', 'ASC']]
    });
    
    return meals.map(meal => ({
      id: meal.id,
      name: meal.name_zh,
      nameEn: meal.name_en,
      desc: meal.desc_zh,
      descEn: meal.desc_en,
      price: parseFloat(meal.price),
      category: meal.category,
      icon: meal.icon,
      imageUrl: meal.image_url
    }));
  } catch (error) {
    logger.error('获取菜品列表失败:', error);
    throw error;
  }
};

/**
 * 获取所有启用的付款方式列表
 * @returns {Promise<Array>}
 */
const getPaymentMethods = async () => {
  try {
    const paymentMethods = await PaymentMethod.findAll({
      where: {
        is_active: true
      },
      order: [['sort_order', 'ASC'], ['id', 'ASC']]
    });
    
    return paymentMethods.map(method => ({
      id: method.id,
      code: method.code,
      name: method.name_zh,
      nameEn: method.name_en,
      icon: method.icon
    }));
  } catch (error) {
    logger.error('获取付款方式列表失败:', error);
    throw error;
  }
};

/**
 * 获取系统设置
 * @param {string} key - 设置键名（可选，不提供则返回所有设置）
 * @returns {Promise<Object|string>}
 */
const getSettings = async (key = null) => {
  try {
    const { Settings } = require('../models');
    
    if (key) {
      // 获取单个设置
      const setting = await Settings.findOne({
        where: { key }
      });
      
      if (!setting) {
        return null;
      }
      
      // 尝试解析 JSON，如果失败则返回原始值
      try {
        return JSON.parse(setting.value);
      } catch (e) {
        return setting.value;
      }
    } else {
      // 获取所有设置
      const settings = await Settings.findAll();
      
      const result = {};
      for (const setting of settings) {
        try {
          result[setting.key] = JSON.parse(setting.value);
        } catch (e) {
          result[setting.key] = setting.value;
        }
      }
      
      return result;
    }
  } catch (error) {
    logger.error('获取系统设置失败:', error);
    throw error;
  }
};

module.exports = {
  createOrder,
  getMeals,
  getPaymentMethods,
  getSettings
};
