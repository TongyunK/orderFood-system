const express = require('express');
const router = express.Router();
const orderFoodController = require('../controllers/orderFoodController');

// 创建订单
router.post('/orders', orderFoodController.createOrder);

// 获取套餐列表
router.get('/meals', orderFoodController.getMeals);

// 获取付款方式列表
router.get('/payment-methods', orderFoodController.getPaymentMethods);

// 获取系统设置
router.get('/settings', orderFoodController.getSettings);

module.exports = router;
