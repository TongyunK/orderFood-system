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
/**
 * 生成订单编号（优化版：在事务内查询，避免并发问题）
 * 格式：业务标识(D/T) + 分店编号(3位) + 日期(8位) + 时间(6位) + 节点/随机数(2位) + 当日序号(4位)
 * 示例：D0012025092912003909260059
 * 
 * @param {number} orderType - 订单类型：0=堂食, 1=外卖
 * @param {number} storeId - 店铺ID
 * @param {Object} transaction - 数据库事务对象（可选，如果提供则在事务内查询）
 * @returns {Promise<{orderNumber: string, dailySequence: number}>} 订单编号和当日序号
 */
const generateOrderNumber = async (orderType, storeId, transaction = null) => {
  try {
    // 1. 业务标识：D=堂食(0), T=外卖(1)
    const businessCode = orderType === 1 ? 'T' : 'D';
    
    // 2. 分店编号：从系统设置获取 store_number，如果没有则使用 store_id（3位数字，001-999）
    const { Settings } = require('../models');
    let storeNumber = '001';
    const storeNumberSetting = await Settings.findOne({ 
      where: { key: 'store_number' },
      transaction 
    });
    if (storeNumberSetting) {
      try {
        const num = parseInt(JSON.parse(storeNumberSetting.value));
        storeNumber = String(num).padStart(3, '0').slice(0, 3);
      } catch (e) {
        // 如果解析失败，使用 store_id
        storeNumber = String(storeId || 1).padStart(3, '0').slice(0, 3);
      }
    } else {
      storeNumber = String(storeId || 1).padStart(3, '0').slice(0, 3);
    }
    
    // 3. 日期：YYYYMMDD格式
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateStr = `${year}${month}${day}`;
    
    // 4. 时间：HHMMSS格式
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const timeStr = `${hours}${minutes}${seconds}`;
    
    // 5. 节点/随机数：2位数字（00-99）
    const nodeNumber = String(Math.floor(Math.random() * 100)).padStart(2, '0');
    
    // 6. 当日序号：4位数字（0001-9999）
    // 优化：使用settings表中的计数器，避免每次查询数据库
    const todayDateStr = dateStr; // YYYYMMDD格式
    
    // 获取对应的计数器key
    const sequenceKey = orderType === 1 ? 'daily_takeout_sequence' : 'daily_dine_in_sequence';
    const dateKey = 'daily_sequence_date';
    
    // 获取当前计数器和日期
    const sequenceSetting = await Settings.findOne({ 
      where: { key: sequenceKey },
      transaction 
    });
    const dateSetting = await Settings.findOne({ 
      where: { key: dateKey },
      transaction 
    });
    
    let dailySequence = 1;
    let currentDate = null;
    
    // 检查日期设置
    if (dateSetting) {
      try {
        currentDate = JSON.parse(dateSetting.value);
      } catch (e) {
        currentDate = null;
      }
    }
    
    // 如果日期不匹配，重置计数器
    if (currentDate !== todayDateStr) {
      dailySequence = 1;
      // 更新日期和计数器
      if (dateSetting) {
        await dateSetting.update({ 
          value: JSON.stringify(todayDateStr) 
        }, { transaction });
      } else {
        await Settings.create({
          key: dateKey,
          value: JSON.stringify(todayDateStr),
          description: '当日序号对应的日期（YYYY-MM-DD），用于判断是否需要重置',
          category: 'order'
        }, { transaction });
      }
      
      // 重置对应的序号计数器
      if (sequenceSetting) {
        await sequenceSetting.update({ 
          value: JSON.stringify(1) 
        }, { transaction });
      } else {
        await Settings.create({
          key: sequenceKey,
          value: JSON.stringify(1),
          description: orderType === 1 ? '当日外卖序号' : '当日堂食序号',
          category: 'order'
        }, { transaction });
      }
    } else {
      // 日期匹配，递增计数器
      if (sequenceSetting) {
        try {
          dailySequence = parseInt(JSON.parse(sequenceSetting.value)) || 0;
          dailySequence += 1;
          // 更新计数器
          await sequenceSetting.update({ 
            value: JSON.stringify(dailySequence) 
          }, { transaction });
        } catch (e) {
          dailySequence = 1;
          await sequenceSetting.update({ 
            value: JSON.stringify(1) 
          }, { transaction });
        }
      } else {
        // 如果计数器不存在，创建它
        dailySequence = 1;
        await Settings.create({
          key: sequenceKey,
          value: JSON.stringify(1),
          description: orderType === 1 ? '当日外卖序号' : '当日堂食序号',
          category: 'order'
        }, { transaction });
      }
    }
    
    const sequenceNumber = String(dailySequence).padStart(4, '0');
    
    // 组合订单编号
    const orderNumber = `${businessCode}${storeNumber}${dateStr}${timeStr}${nodeNumber}${sequenceNumber}`;
    
    return {
      orderNumber,
      dailySequence
    };
  } catch (error) {
    logger.error('生成订单编号失败:', error);
    // 如果生成失败，使用备用方案
    const timestamp = Date.now().toString();
    return {
      orderNumber: `OF${timestamp.slice(-8)}`,
      dailySequence: 0
    };
  }
};

const createOrder = async (orderData) => {
  const { items, totalAmount, storeId = 1, orderType = 0, paymentMethodId } = orderData;
  
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error('订单明细不能为空');
  }
  
  try {
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
      // 在事务内生成订单号（确保序号唯一性，避免并发问题）
      const { orderNumber, dailySequence } = await generateOrderNumber(orderType, storeId, transaction);
      
      // 创建订单主表
      const order = await Order.create({
        order_number: orderNumber,
        store_id: storeId,
        total_amount: totalAmount,
        order_type: orderType, // 0=堂食, 1=外卖
        payment_method_id: paymentMethodId || null,
        status: 'paid', // 已支付（因为付款功能暂不开发，这里直接设为已支付）
        print_status: null,
        print_message: null,
        daily_sequence: dailySequence // 保存当日序号
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
      const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
      const orderTime = (() => {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
      })();
      
      // 尝试读取店铺名称（中/英文）
      let storeNameZh = '';
      let storeNameEn = '';
      try {
        const { Settings } = require('../models');
        const storeNameZhSetting = await Settings.findOne({ where: { key: 'store_name_zh' } });
        const storeNameEnSetting = await Settings.findOne({ where: { key: 'store_name_en' } });
        if (storeNameZhSetting) {
          try {
            storeNameZh = JSON.parse(storeNameZhSetting.value);
          } catch {
            storeNameZh = storeNameZhSetting.value || '';
          }
        }
        if (storeNameEnSetting) {
          try {
            storeNameEn = JSON.parse(storeNameEnSetting.value);
          } catch {
            storeNameEn = storeNameEnSetting.value || '';
          }
        }
      } catch (e) {
        logger.warn('读取店铺名称失败，将使用空名称', e);
      }
      
      const printData = {
        order_number: orderNumber,
        daily_sequence: dailySequence, // 当日序号
        order_type: orderType,
        items: orderItems.map(item => ({
          name: item.meal.name_zh || item.meal.name_en,
          quantity: item.quantity,
          price: item.price,
          subtotal: item.subtotal
        })),
        total_amount: totalAmount,
        total_quantity: totalQuantity,
        order_time: orderTime,
        store_name_zh: storeNameZh,
        store_name_en: storeNameEn,
        payment_type_zh: paymentMethod ? (paymentMethod.name_zh || '') : '',
        payment_type_en: paymentMethod ? (paymentMethod.name_en || '') : ''
      };
      
      // 先返回订单创建成功，然后异步打印小票（避免打印阻塞导致超时）
      logger.info('订单已保存到数据库', { 
        orderNumber,
        orderId: order.id,
        itemCount: orderItems.length
      });
      
      // 异步打印小票（不阻塞响应）
      setImmediate(async () => {
        try {
          const printResult = await printerService.printOrderReceipt(printData);
          
          // 更新订单的打印状态
          await order.update({
            print_status: printResult.success ? 'success' : 'error',
            print_message: printResult.message
          });
          
          if (printResult.success) {
            logger.info('订单小票打印成功', {
              orderNumber,
              totalAmount,
              itemCount: orderItems.length
            });
          } else {
            logger.warn('订单小票打印失败', {
              orderNumber,
              totalAmount,
              printError: printResult.message
            });
          }
        } catch (printError) {
          logger.error('打印订单小票时发生错误', {
            orderNumber,
            error: printError.message,
            stack: printError.stack
          });
          
          // 更新订单的打印状态为错误
          try {
            await order.update({
              print_status: 'error',
              print_message: `打印错误: ${printError.message}`
            });
          } catch (updateError) {
            logger.error('更新订单打印状态失败', updateError);
          }
        }
      });
      
      // 立即返回订单创建成功
      return {
        success: true,
        message: '订单创建成功，正在打印小票...',
        orderNumber: orderNumber
      };
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
      category: meal.category
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
      nameEn: method.name_en
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
