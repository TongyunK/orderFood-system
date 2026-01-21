// 设置控制台编码（解决 Windows 繁体中文系统乱码问题）
if (process.platform === 'win32') {
  try {
    const { execSync } = require('child_process');
    try {
      execSync('chcp 936 >nul 2>&1', { stdio: 'ignore' });
    } catch (e) {
      // 忽略错误
    }
    process.stdout.setDefaultEncoding('gbk');
    process.stderr.setDefaultEncoding('gbk');
  } catch (error) {
    // 忽略编码设置错误
  }
}

// 使用 try-catch 包装所有 require，确保错误能被捕获
let app, http, os, printerService, logger, sequelize, Meal, Order, OrderItem, Settings, PaymentMethod;
let initMeals, initSettings, initPaymentMethods, migrateDatabase;

try {
  logger = require('./utils/logger');
  logger.info('开始加载模块...');
  
  app = require('./app');
  logger.info('✓ app 模块加载成功');
  
  http = require('http');
  os = require('os');
  logger.info('✓ 核心模块加载成功');
  
  printerService = require('./services/printerService');
  logger.info('✓ printerService 模块加载成功');
  
  const models = require('./models');
  sequelize = models.sequelize;
  Meal = models.Meal;
  Order = models.Order;
  OrderItem = models.OrderItem;
  Settings = models.Settings;
  PaymentMethod = models.PaymentMethod;
  logger.info('✓ models 模块加载成功');
  
  initMeals = require('./scripts/initMeals').initMeals;
  initSettings = require('./scripts/initSettings').initSettings;
  initPaymentMethods = require('./scripts/initPaymentMethods').initPaymentMethods;
  migrateDatabase = require('./scripts/migrateDatabase').migrateDatabase;
  logger.info('✓ 脚本模块加载成功');
} catch (error) {
  // 如果 logger 还没加载，使用 console
  if (logger) {
    logger.error('模块加载失败', error);
  } else {
    console.error('❌ 模块加载失败:', error);
    console.error('错误堆栈:', error.stack);
  }
  
  // 在打包环境中，等待用户看到错误信息
  const isPacked = typeof process.pkg !== 'undefined';
  if (isPacked) {
    console.error('\n程序将在 10 秒后自动退出，或按 Ctrl+C 立即退出...');
    setTimeout(() => {
      console.error('程序退出');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(1);
  }
}

const PORT = process.env.PORT || 3002;
const server = http.createServer(app);

// 初始化数据库
async function initDatabase() {
  try {
    logger.info('开始初始化数据库...');
    
    // 测试数据库连接
    try {
      await sequelize.authenticate();
      logger.info('✓ 数据库连接成功');
    } catch (authError) {
      logger.error('数据库连接失败:', authError);
      throw new Error(`数据库连接失败: ${authError.message}`);
    }
    
    // 先执行数据库迁移（如果需要）
    try {
      // logger.info('开始数据库迁移...');
      await migrateDatabase();
      logger.info('✓ 数据库迁移完成');
    } catch (migrateError) {
      logger.warn('数据库迁移检查失败，继续初始化:', migrateError.message);
    }
    
    // 同步数据库模型（创建表结构）
    // 注意：migrateDatabase 已经处理了大部分同步逻辑
    // 这里只创建缺失的表，不使用 alter 避免创建备份表
    try {
      // 检查是否有表缺失
      const [allTables] = await sequelize.query(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_backup'
      `);
      const tableNames = allTables.map(t => t.name);
      const requiredTables = ['meals', 'orders', 'order_items', 'settings', 'payment_methods'];
      const missingTables = requiredTables.filter(name => !tableNames.includes(name));
      
      if (missingTables.length > 0) {
        logger.info(`检测到缺失的表: ${missingTables.join(', ')}，将创建这些表`);
        // 只创建缺失的表，不使用 alter 避免修改现有表结构
        for (const tableName of missingTables) {
          try {
            switch (tableName) {
              case 'meals':
                await Meal.sync({ force: false });
                break;
              case 'orders':
                await Order.sync({ force: false });
                break;
              case 'order_items':
                await OrderItem.sync({ force: false });
                break;
              case 'settings':
                await Settings.sync({ force: false });
                break;
              case 'payment_methods':
                await PaymentMethod.sync({ force: false });
                break;
            }
            logger.info(`✓ 已创建表: ${tableName}`);
          } catch (tableError) {
            logger.warn(`创建表 ${tableName} 失败:`, tableError.message);
          }
        }
        
        // 清理可能创建的备份表
        const [backupTables] = await sequelize.query(`
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name LIKE '%_backup'
        `);
        if (backupTables.length > 0) {
          for (const table of backupTables) {
            await sequelize.query(`DROP TABLE IF EXISTS ${table.name}`);
            logger.info(`已清理备份表: ${table.name}`);
          }
        }
      } else {
        // logger.info('所有必需表都存在，跳过 sync 操作', null, true);
      }
    } catch (error) {
      logger.warn('表结构检查失败:', error.message);
    }
    
    logger.info('数据库表结构同步成功', null, true);
    
    // 初始化默认菜品数据
    // logger.info('开始初始化默认菜品数据...');
    await initMeals();
    // logger.info('✓ 默认菜品数据初始化完成');
    
    // 初始化系统设置
    // logger.info('开始初始化系统设置...');
    await initSettings();
    // logger.info('✓ 系统设置初始化完成');
    
    // 初始化付款方式数据
    // logger.info('开始初始化付款方式数据...');
    await initPaymentMethods();
    // logger.info('✓ 付款方式数据初始化完成');
    
    logger.info('✓ 数据库初始化完成', null, true);
  } catch (error) {
    logger.error('数据库初始化失败:', error);
    // 数据库初始化失败不影响服务器启动，但记录错误
    throw error; // 重新抛出错误，让调用者知道
  }
}

// 启动服务器
async function startServer() {
  try {
    // 输出环境信息（用于调试）
    const isPacked = typeof process.pkg !== 'undefined';
    if (isPacked) {
      logger.info('运行环境: 打包后的可执行文件', {
        execPath: process.execPath,
        execDir: require('path').dirname(process.execPath),
        cwd: process.cwd(),
        __dirname: __dirname
      });
    }
    
    // 初始化数据库
    logger.info('准备初始化数据库...');
    await initDatabase();
    logger.info('✓ 数据库初始化完成');
    
    // 初始化打印机
    logger.info('准备初始化打印机...');
    try {
      if (printerService.isAvailable()) {
        const initResult = await printerService.initPrinter();
        if (initResult) {
          logger.info('✅ 打印机初始化成功', null, true);
        } else {
          logger.warn('⚠️  打印机初始化失败，但服务器将继续运行', null, true);
        }
      } else {
        logger.info('ℹ️  打印机功能未启用（DLL未加载或已禁用）', null, true);
      }
    } catch (error) {
      logger.error('初始化打印机时发生错误:', error);
    }
    
    logger.info(`准备启动服务器，监听端口 ${PORT}...`);
    server.listen(PORT, '0.0.0.0', () => {
      // 获取所有网络接口的IP地址
      const networkInterfaces = os.networkInterfaces();
      const addresses = [];
      
      Object.keys(networkInterfaces).forEach((interfaceName) => {
        networkInterfaces[interfaceName].forEach((iface) => {
          if (iface.family === 'IPv4' && !iface.internal) {
            addresses.push(iface.address);
          }
        });
      });
      
      const primaryIP = addresses.length > 0 ? addresses[0] : 'localhost';
      
      // 构建启动信息
      let startupInfo = '\n========================================\n';
      startupInfo += '自助点单系统服务器启动成功！\n';
      startupInfo += '========================================\n';
      startupInfo += `本地访问地址:\n`;
      startupInfo += `  http://localhost:${PORT}\n`;
      startupInfo += `  http://127.0.0.1:${PORT}\n`;
      startupInfo += `\n网络访问地址:\n`;
      
      if (addresses.length > 0) {
        addresses.forEach((ip) => {
          startupInfo += `  http://${ip}:${PORT}\n`;
        });
      } else {
        startupInfo += `  (未检测到网络接口，请检查网络配置)\n`;
      }
      
      startupInfo += `\nAPI接口:\n`;
      startupInfo += `  创建订单: POST http://${primaryIP}:${PORT}/api/orderfood/orders\n`;
      startupInfo += `  获取套餐: GET http://${primaryIP}:${PORT}/api/orderfood/meals\n`;
      startupInfo += `  获取付款方式: GET http://${primaryIP}:${PORT}/api/orderfood/payment-methods\n`;
      startupInfo += `\n💡提示: 从其他设备访问时，请使用网络访问地址\n`;
      startupInfo += '========================================\n';
      startupInfo += '按 Ctrl+C 停止服务器\n';
      
      console.log(startupInfo);
      logger.info('服务器启动成功', {
        port: PORT,
        localAddresses: [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`],
        networkAddresses: addresses.map(ip => `http://${ip}:${PORT}`)
      });
    });
    
    // 处理服务器监听错误
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        const errorMsg = `❌ 错误: 端口 ${PORT} 已被占用\n   解决方法:\n   1. 关闭占用端口 ${PORT} 的程序\n   2. 或使用环境变量设置其他端口: set PORT=8080`;
        console.error(errorMsg);
        logger.error(`端口 ${PORT} 已被占用`, error);
      } else {
        console.error('❌ 服务器启动失败:', error);
        logger.error('服务器启动失败:', error);
      }
      process.exit(1);
    });
    
  } catch (error) {
    const errorMsg = `❌ 启动服务器时发生严重错误:\n错误信息: ${error.message}\n${error.stack || ''}`;
    console.error(errorMsg);
    logger.error('启动服务器时发生严重错误:', error);
    
    // 在打包环境中，等待用户看到错误信息
    const isPacked = typeof process.pkg !== 'undefined';
    if (isPacked) {
      console.error('\n按任意键退出...');
      // 等待用户输入（Windows）
      if (process.platform === 'win32') {
        try {
          require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
          }).question('', () => process.exit(1));
        } catch (e) {
          // 如果 readline 失败，至少等待一段时间
          setTimeout(() => process.exit(1), 5000);
        }
      } else {
        setTimeout(() => process.exit(1), 5000);
      }
    } else {
      process.exit(1);
    }
  }
}

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  const errorMsg = `❌ 未捕获的异常: ${error.message}\n${error.stack}`;
  console.error(errorMsg);
  logger.error('未捕获的异常', error);
  
  // 在打包环境中，等待用户看到错误信息
  const isPacked = typeof process.pkg !== 'undefined';
  if (isPacked) {
    console.error('\n按任意键退出...');
    // 等待用户输入（Windows）
    if (process.platform === 'win32') {
      try {
        require('readline').createInterface({
          input: process.stdin,
          output: process.stdout
        }).question('', () => process.exit(1));
      } catch (e) {
        // 如果 readline 失败，至少等待一段时间
        setTimeout(() => process.exit(1), 5000);
      }
    } else {
      setTimeout(() => process.exit(1), 5000);
    }
  } else {
    process.exit(1);
  }
});

// 处理未处理的 Promise 拒绝
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ 未处理的 Promise 拒绝:', reason);
  logger.error('未处理的 Promise 拒绝', { reason, promise });
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('收到 SIGTERM 信号，正在关闭服务器...');
  logger.info('收到 SIGTERM 信号，正在关闭服务器');
  server.close(() => {
    logger.info('服务器已关闭');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n收到 SIGINT 信号，正在关闭服务器...');
  logger.info('收到 SIGINT 信号，正在关闭服务器');
  server.close(() => {
    logger.info('服务器已关闭');
    process.exit(0);
  });
});

// 启动服务器（包装在 try-catch 中，确保所有错误都被捕获）
try {
  startServer().catch((error) => {
    const errorMsg = `❌ 启动服务器失败: ${error.message}\n${error.stack || ''}`;
    console.error(errorMsg);
    logger.error('启动服务器失败', error);
    
    // 在打包环境中，等待用户看到错误信息
    const isPacked = typeof process.pkg !== 'undefined';
    if (isPacked) {
      console.error('\n程序将在 10 秒后自动退出，或按 Ctrl+C 立即退出...');
      setTimeout(() => {
        console.error('程序退出');
        process.exit(1);
      }, 10000);
    } else {
      process.exit(1);
    }
  });
} catch (error) {
  const errorMsg = `❌ 启动时发生同步错误: ${error.message}\n${error.stack || ''}`;
  console.error(errorMsg);
  logger.error('启动时发生同步错误', error);
  
  // 在打包环境中，等待用户看到错误信息
  const isPacked = typeof process.pkg !== 'undefined';
  if (isPacked) {
    console.error('\n程序将在 10 秒后自动退出，或按 Ctrl+C 立即退出...');
    setTimeout(() => {
      console.error('程序退出');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(1);
  }
}
