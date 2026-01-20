const path = require('path');
const fs = require('fs');

/**
 * 获取数据库文件路径（点单系统专用）
 * 在打包后的环境中，数据库文件应该放在可执行文件同目录下
 * @returns {string} 数据库文件路径
 */
function getDatabasePath() {
  // 如果设置了环境变量，优先使用
  if (process.env.DATABASE_PATH) {
    return process.env.DATABASE_PATH;
  }
  
  // 判断是否在打包环境中（pkg 打包后 __dirname 会指向快照目录）
  const isPacked = typeof process.pkg !== 'undefined';
  
  if (isPacked) {
    // 打包环境：数据库文件放在可执行文件同目录下
    const execPath = process.execPath; // 可执行文件路径
    const execDir = path.dirname(execPath);
    const dbPath = path.join(execDir, 'database.sqlite');
    
    return dbPath;
  } else {
    // 开发环境：使用项目目录下的数据库文件
    return path.join(__dirname, '../database.sqlite');
  }
}

module.exports = { getDatabasePath };
