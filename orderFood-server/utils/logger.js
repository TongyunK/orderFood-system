/**
 * 通用日志记录模块（点单系统专用）
 * 用于将所有的日志信息保存到日志文件中
 * 支持保留程序启动时的必要控制台输出
 */

const fs = require('fs');
const path = require('path');

// 判断是否在打包环境中
const isPacked = typeof process.pkg !== 'undefined';

// 获取日志文件路径
function getLogFilePath() {
  // 如果设置了环境变量，优先使用
  if (process.env.APP_LOG_PATH) {
    return process.env.APP_LOG_PATH;
  }
  
  if (isPacked) {
    // 打包环境：日志文件放在可执行文件同目录下
    const execPath = process.execPath;
    const execDir = path.dirname(execPath);
    return path.join(execDir, 'app.log');
  } else {
    // 开发环境：日志文件放在项目根目录下
    return path.join(__dirname, '../../app.log');
  }
}

// 日志文件路径
const LOG_FILE_PATH = getLogFilePath();

// 日志级别
const LOG_LEVELS = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR'
};

// 最大日志文件大小（10MB）
const MAX_LOG_SIZE = 10 * 1024 * 1024;

// 是否允许控制台输出（用于启动信息）
let allowConsoleOutput = true;

/**
 * 设置是否允许控制台输出
 * @param {boolean} allow - 是否允许
 */
function setAllowConsoleOutput(allow) {
  allowConsoleOutput = allow;
}

// 备份日志文件
function rotateLogFile() {
  try {
    if (fs.existsSync(LOG_FILE_PATH)) {
      const stats = fs.statSync(LOG_FILE_PATH);
      if (stats.size > MAX_LOG_SIZE) {
        // 创建备份文件（带时间戳）
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = LOG_FILE_PATH.replace('.log', `-${timestamp}.log`);
        fs.renameSync(LOG_FILE_PATH, backupPath);
        
        // 只保留最近的5个备份文件
        const logDir = path.dirname(LOG_FILE_PATH);
        const logBaseName = path.basename(LOG_FILE_PATH, '.log');
        const files = fs.readdirSync(logDir)
          .filter(file => file.startsWith(logBaseName) && file.endsWith('.log') && file !== path.basename(LOG_FILE_PATH))
          .map(file => ({
            name: file,
            path: path.join(logDir, file),
            time: fs.statSync(path.join(logDir, file)).mtime
          }))
          .sort((a, b) => b.time - a.time);
        
        // 删除超过5个的旧备份文件
        if (files.length > 5) {
          files.slice(5).forEach(file => {
            try {
              fs.unlinkSync(file.path);
            } catch (error) {
              // 忽略删除失败的错误
            }
          });
        }
      }
    }
  } catch (error) {
    // 如果日志轮转失败，不影响日志记录
    if (allowConsoleOutput) {
      console.error('日志轮转失败:', error.message);
    }
  }
}

// 格式化日志消息
function formatLogMessage(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const levelStr = level.padEnd(5);
  
  let logMessage = `[${timestamp}] [${levelStr}] ${message}`;
  
  if (data !== null && data !== undefined) {
    try {
      if (data instanceof Error) {
        logMessage += `\n错误信息: ${data.message}`;
        if (data.stack) {
          logMessage += `\n错误堆栈: ${data.stack}`;
        }
      } else {
        const dataStr = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
        logMessage += `\n${dataStr}`;
      }
    } catch (error) {
      logMessage += `\n[无法序列化数据: ${error.message}]`;
    }
  }
  
  return logMessage + '\n';
}

// 写入日志文件
function writeToLog(level, message, data = null, alsoConsole = false) {
  try {
    // 检查并轮转日志文件
    rotateLogFile();
    
    // 格式化日志消息
    const logMessage = formatLogMessage(level, message, data);
    
    // 确保日志目录存在
    const logDir = path.dirname(LOG_FILE_PATH);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    // 追加写入日志文件
    fs.appendFileSync(LOG_FILE_PATH, logMessage, 'utf8');
    
    // 如果需要同时输出到控制台（用于启动信息等）
    if (alsoConsole && allowConsoleOutput) {
      if (level === LOG_LEVELS.ERROR) {
        console.error(message, data || '');
      } else if (level === LOG_LEVELS.WARN) {
        console.warn(message, data || '');
      } else {
        console.log(message, data || '');
      }
    }
  } catch (error) {
    // 如果写入日志文件失败，输出到控制台（作为后备）
    if (allowConsoleOutput) {
      console.error(`[日志写入失败] ${message}:`, error.message);
      if (data) {
        console.error('数据:', data);
      }
    }
  }
}

// 日志记录器对象
const logger = {
  debug(message, data = null) {
    writeToLog(LOG_LEVELS.DEBUG, message, data);
  },
  
  info(message, data = null, alsoConsole = false) {
    writeToLog(LOG_LEVELS.INFO, message, data, alsoConsole);
  },
  
  warn(message, data = null, alsoConsole = false) {
    writeToLog(LOG_LEVELS.WARN, message, data, alsoConsole);
  },
  
  error(message, data = null, alsoConsole = false) {
    writeToLog(LOG_LEVELS.ERROR, message, data, alsoConsole);
  },
  
  getLogPath() {
    return LOG_FILE_PATH;
  },
  
  setAllowConsoleOutput(allow) {
    setAllowConsoleOutput(allow);
  }
};

module.exports = logger;
