const { sequelize, Order, Meal, OrderItem, Settings, PaymentMethod } = require('../models');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const { getDatabasePath } = require('../utils/getDatabasePath');

/**
 * 数据库迁移脚本
 * 1. 删除从 queueSystem-server 复制过来的多余表
 * 2. 从旧版本（只有 orders 表）迁移到新版本（meals, orders, order_items 表）
 */
async function migrateDatabase() {
  try {
    await sequelize.authenticate();
    logger.info('数据库连接成功');
    
    // 定义 orderFood-server 需要的表（保留这些表）
    const requiredTables = ['meals', 'orders', 'order_items', 'settings', 'payment_methods'];
    
    // 定义 queueSystem-server 的表（需要删除的表）
    const queueSystemTables = [
      'business_types',
      'counter_business_last_ticket',
      'counter_displays',
      'counters',
      'ticket_sequences'
    ];
    
    // 获取数据库中所有表
    const [allTables] = await sequelize.query(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `);
    
    const tableNames = allTables.map(t => t.name);
    logger.info(`数据库中发现 ${tableNames.length} 个表: ${tableNames.join(', ')}`);
    
    // 检查所有必需表的结构是否正确（只在表存在时检查）
    // 定义每个表的必需字段和禁止字段（用于验证表结构是否正确）
    const tableStructureChecks = {
      'settings': {
        required: ['key', 'category'],
        forbidden: [] // 没有禁止字段
      },
      'meals': {
        required: ['name_zh', 'price', 'is_active'],
        forbidden: [] // meals 表不应该有 icon 字段
      },
      'orders': {
        required: ['order_number', 'store_id', 'total_amount', 'order_type', 'daily_sequence'],
        forbidden: []
      },
      'order_items': {
        required: ['order_id', 'meal_id', 'quantity', 'price'],
        forbidden: []
      },
      'payment_methods': {
        required: ['code', 'name_zh', 'is_active'],
        forbidden: [] // payment_methods 表不应该有 icon 字段
      }
    };
    
    let needRebuild = false;
    const tablesToRebuild = [];
    
    // 检查每个必需表的结构
    for (const tableName of requiredTables) {
      if (tableNames.includes(tableName)) {
        const structureCheck = tableStructureChecks[tableName];
        if (structureCheck) {
          try {
            const [columns] = await sequelize.query(`PRAGMA table_info(${tableName})`);
            const columnNames = columns.map(col => col.name);
            const missingFields = structureCheck.required.filter(field => !columnNames.includes(field));
            const forbiddenFields = structureCheck.forbidden.filter(field => columnNames.includes(field));
            
            if (missingFields.length > 0) {
              logger.info(`表 ${tableName} 缺少必需字段: ${missingFields.join(', ')}，将重建`);
              tablesToRebuild.push(tableName);
              needRebuild = true;
            } else if (forbiddenFields.length > 0) {
              logger.info(`表 ${tableName} 包含不应存在的字段: ${forbiddenFields.join(', ')}，将重建`);
              tablesToRebuild.push(tableName);
              needRebuild = true;
            }
          } catch (error) {
            logger.warn(`检查表 ${tableName} 结构时出错，将重建:`, error.message);
            tablesToRebuild.push(tableName);
            needRebuild = true;
          }
        }
      }
    }
    
    // 备份并删除需要重建的表（先备份数据，再删除表）
    const tableBackups = {};
    if (needRebuild) {
      for (const tableName of tablesToRebuild) {
        try {
          // 先备份数据（特别是meals和payment_methods这种重要数据表）
          if (tableName === 'meals' || tableName === 'payment_methods') {
            try {
              const [rows] = await sequelize.query(`SELECT * FROM ${tableName}`);
              tableBackups[tableName] = rows;
              logger.info(`✓ 已备份 ${tableName} 表数据（${rows.length} 条记录）`);
            } catch (backupError) {
              logger.warn(`备份表 ${tableName} 数据失败:`, backupError.message);
            }
          }
          
          await sequelize.query(`DROP TABLE IF EXISTS ${tableName}`);
          logger.info(`✓ 已删除需要重建的表: ${tableName}`);
          const index = tableNames.indexOf(tableName);
          if (index > -1) {
            tableNames.splice(index, 1);
          }
        } catch (error) {
          logger.warn(`删除表 ${tableName} 失败:`, error.message);
        }
      }
    }
    
    // 首先删除 Sequelize 创建的备份表（以 _backup 结尾的表）
    // 必须在 sync 之前删除，避免 sync 时检测到备份表而误判
    const backupTables = tableNames.filter(name => name.endsWith('_backup'));
    if (backupTables.length > 0) {
      logger.info(`发现 Sequelize 创建的备份表: ${backupTables.join(', ')}，将删除`);
      for (const tableName of backupTables) {
        try {
          await sequelize.query(`DROP TABLE IF EXISTS ${tableName}`);
          logger.info(`✓ 已删除备份表: ${tableName}`);
        } catch (error) {
          logger.warn(`删除备份表 ${tableName} 失败:`, error.message);
        }
      }
    }
    
    // 删除 queueSystem-server 的多余表
    const tablesToDelete = tableNames.filter(name => 
      queueSystemTables.includes(name) || 
      (!requiredTables.includes(name) && name !== 'SequelizeMeta' && !name.endsWith('_backup'))
    );
    
    if (tablesToDelete.length > 0) {
      logger.info(`发现需要删除的表: ${tablesToDelete.join(', ')}`);
      
      for (const tableName of tablesToDelete) {
        try {
          await sequelize.query(`DROP TABLE IF EXISTS ${tableName}`);
          logger.info(`✓ 已删除表: ${tableName}`);
        } catch (error) {
          logger.warn(`删除表 ${tableName} 失败:`, error.message);
        }
      }
    } else {
      // logger.info('没有需要删除的多余表');
    }
    
    // 检查是否存在旧的 orders 表结构
    const [ordersTable] = await sequelize.query(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='orders'
    `);
    
    if (ordersTable.length === 0) {
      logger.info('数据库中没有 orders 表，将创建新表结构');
      // 直接创建新表结构，不使用 alter
      await Meal.sync({ force: false });
      await Order.sync({ force: false });
      await OrderItem.sync({ force: false });
      await Settings.sync({ force: false });
      await PaymentMethod.sync({ force: false });
      
      // 清理可能创建的备份表
      const [newBackupTables] = await sequelize.query(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name LIKE '%_backup'
      `);
      if (newBackupTables.length > 0) {
        for (const table of newBackupTables) {
          await sequelize.query(`DROP TABLE IF EXISTS ${table.name}`);
          logger.info(`✓ 已清理备份表: ${table.name}`);
        }
      }
      
      const { initMeals } = require('./initMeals');
      await initMeals();
      const { initSettings } = require('./initSettings');
      await initSettings();
      const { initPaymentMethods } = require('./initPaymentMethods');
      await initPaymentMethods();
      logger.info('数据库初始化完成！');
      return;
    }
    
    // 检查旧表结构（检查是否有 meal_id 或 meal_type 字段，这是旧版本的特征）
    const [columns] = await sequelize.query(`
      PRAGMA table_info(orders)
    `);
    
    const columnNames = columns.map(col => col.name);
    const hasOldStructure = columnNames.includes('meal_id') || columnNames.includes('meal_type');
    const hasNewStructure = columnNames.includes('store_id') && columnNames.includes('total_amount');
    
    // 检查所有必需的表是否存在
    const [existingTables] = await sequelize.query(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `);
    const existingTableNames = existingTables.map(t => t.name);
    const missingTables = requiredTables.filter(name => !existingTableNames.includes(name));
    
    if (hasNewStructure && !hasOldStructure) {
      if (missingTables.length > 0 || needRebuild) {
        logger.info(`数据库结构基本正确，但${missingTables.length > 0 ? `缺少以下表: ${missingTables.join(', ')}` : ''}${missingTables.length > 0 && needRebuild ? '，且' : ''}${needRebuild ? `需要重建以下表: ${tablesToRebuild.join(', ')}` : ''}，将创建/更新表结构`);
        
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
        
        // 重建需要重建的表（已经在上面的逻辑中删除了）
        for (const tableName of tablesToRebuild) {
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
            logger.info(`✓ 已重建表: ${tableName}`);
          } catch (tableError) {
            logger.warn(`重建表 ${tableName} 失败:`, tableError.message);
          }
        }
        
        // 清理可能创建的备份表
        const [newBackupTables] = await sequelize.query(`
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name LIKE '%_backup'
        `);
        if (newBackupTables.length > 0) {
          for (const table of newBackupTables) {
            await sequelize.query(`DROP TABLE IF EXISTS ${table.name}`);
            logger.info(`✓ 已清理备份表: ${table.name}`);
          }
        }
        
        // 恢复meals表的数据（如果之前有备份）
        if (tablesToRebuild.includes('meals') && tableBackups['meals']) {
          try {
            const { Meal } = require('../models');
            const backupData = tableBackups['meals'];
            // 过滤掉icon字段，只保留需要的字段
            const restoredData = backupData.map(row => ({
              name_zh: row.name_zh,
              name_en: row.name_en,
              desc_zh: row.desc_zh,
              desc_en: row.desc_en,
              price: row.price,
              category: row.category,
              image_url: row.image_url,
              is_active: row.is_active !== undefined ? row.is_active : true,
              sort_order: row.sort_order !== undefined ? row.sort_order : 0
            }));
            
            // 批量恢复数据
            await Meal.bulkCreate(restoredData, { ignoreDuplicates: true });
            logger.info(`✓ 已恢复 meals 表数据（${restoredData.length} 条记录）`);
          } catch (restoreError) {
            logger.warn(`恢复 meals 表数据失败，将使用默认数据:`, restoreError.message);
            const { initMeals } = require('./initMeals');
            await initMeals();
          }
        } else if (missingTables.includes('meals') || tablesToRebuild.includes('meals')) {
          // 如果没有备份数据，使用默认数据初始化
          const { initMeals } = require('./initMeals');
          await initMeals();
        }
        // 总是初始化 settings，确保新增的设置项被创建
        const { initSettings } = require('./initSettings');
        await initSettings();
        
        // 恢复payment_methods表的数据（如果之前有备份）
        if (tablesToRebuild.includes('payment_methods') && tableBackups['payment_methods']) {
          try {
            const { PaymentMethod } = require('../models');
            const backupData = tableBackups['payment_methods'];
            // 过滤掉icon字段，只保留需要的字段
            const restoredData = backupData.map(row => ({
              code: row.code,
              name_zh: row.name_zh,
              name_en: row.name_en,
              is_active: row.is_active !== undefined ? row.is_active : true,
              sort_order: row.sort_order !== undefined ? row.sort_order : 0
            }));
            
            // 使用bulkCreate，但需要处理可能的唯一约束冲突
            for (const item of restoredData) {
              await PaymentMethod.findOrCreate({
                where: { code: item.code },
                defaults: item
              });
            }
            logger.info(`✓ 已恢复 payment_methods 表数据（${restoredData.length} 条记录）`);
          } catch (restoreError) {
            logger.warn(`恢复 payment_methods 表数据失败，将使用默认数据:`, restoreError.message);
            const { initPaymentMethods } = require('./initPaymentMethods');
            await initPaymentMethods();
          }
        } else if (missingTables.includes('payment_methods') || tablesToRebuild.includes('payment_methods')) {
          const { initPaymentMethods } = require('./initPaymentMethods');
          await initPaymentMethods();
        }
        logger.info('表结构已更新并初始化完成');
      } else {
        // 所有表都存在且结构正确，只做快速检查，不执行 sync（提高启动速度）
        // 但仍然需要初始化 settings，确保新增的设置项被创建
        // logger.info('数据库结构已是最新版本，所有必需表都存在且结构正确，跳过同步');
        const { initSettings } = require('./initSettings');
        await initSettings();
      }
      return;
    }
    
    if (!hasOldStructure) {
      logger.info('数据库表结构异常，将重新创建');
    }
    
    logger.info('检测到旧版本数据库结构，开始迁移...');
    
    // 备份旧数据（如果有订单数据）
    const [oldOrders] = await sequelize.query(`
      SELECT * FROM orders
    `);
    
    if (oldOrders.length > 0) {
      const backupPath = path.join(
        path.dirname(getDatabasePath()),
        `database-backup-${Date.now()}.json`
      );
      fs.writeFileSync(backupPath, JSON.stringify(oldOrders, null, 2), 'utf8');
      logger.info(`已备份 ${oldOrders.length} 条旧订单数据到: ${backupPath}`);
    }
    
    // 删除旧表
    logger.info('删除旧表结构...');
    await sequelize.query(`DROP TABLE IF EXISTS orders`);
    
    // 重新创建表结构
    logger.info('创建新表结构...');
    // 不使用 alter，直接创建所有表
    await Meal.sync({ force: false });
    await Order.sync({ force: false });
    await OrderItem.sync({ force: false });
    await Settings.sync({ force: false });
    await PaymentMethod.sync({ force: false });
    
    // 清理可能创建的备份表
    const [newBackupTables] = await sequelize.query(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name LIKE '%_backup'
    `);
    if (newBackupTables.length > 0) {
      for (const table of newBackupTables) {
        await sequelize.query(`DROP TABLE IF EXISTS ${table.name}`);
        logger.info(`✓ 已清理备份表: ${table.name}`);
      }
    }
    
    // 初始化默认菜品数据
    const { initMeals } = require('./initMeals');
    await initMeals();
    
    // 初始化系统设置
    const { initSettings } = require('./initSettings');
    await initSettings();
    
    // 初始化付款方式数据（如果表被重建，确保数据被恢复）
    const { initPaymentMethods } = require('./initPaymentMethods');
    await initPaymentMethods();
    
    logger.info('数据库迁移完成！');
    logger.info('注意：旧订单数据已备份，但未自动迁移到新结构。');
    logger.info('如需恢复旧订单，请手动处理备份文件。');
    
  } catch (error) {
    logger.error('数据库迁移失败:', error);
    throw error;
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  (async () => {
    try {
      await migrateDatabase();
      process.exit(0);
    } catch (error) {
      console.error('迁移失败:', error);
      process.exit(1);
    }
  })();
}

module.exports = { migrateDatabase };
