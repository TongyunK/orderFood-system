/**
 * 打印机服务模块
 * 使用 ffi-napi 调用打印机 DLL (CsnPrinterLibs.dll)
 */

const path = require('path');
const fs = require('fs');
const printerLogger = require('../utils/printerLogger');
const logger = require('../utils/logger');

// 依赖：npm install iconv-lite
const iconv = require('iconv-lite');

// 延迟加载 loadPrinterModules，避免在模块加载时失败
let loadPrinterModules, getPrinterDllPath;
try {
  const printerModulesLoader = require('../utils/loadPrinterModules');
  loadPrinterModules = printerModulesLoader.loadPrinterModules;
  getPrinterDllPath = printerModulesLoader.getPrinterDllPath;
  logger.info('✓ loadPrinterModules 工具函数加载成功');
} catch (error) {
  logger.error('❌ 加载 loadPrinterModules 工具函数失败:', error);
  // 设置空函数，避免后续调用失败
  loadPrinterModules = () => null;
  getPrinterDllPath = () => '';
}

let ffi = null;
let ref = null;
let printerDll = null;
let printerHandle = null; // 打印机端口句柄

// 定义 wchar_t 及 wchar_t* 类型（适配 Windows DLL 的 const wchar_t*）
// Windows 下 wchar_t = 2字节无符号短整型（ushort）
let wchar_t = null;
let wchar_t_ptr = null;

/**
 * 调用 Pos_Text 打印文本
 * @param {string} text - 要打印的文本
 * @param {number} encoding - 编码类型：0=GBK, 1=UTF-8, 3=BIG-5
 * @param {number} position - 位置
 * @param {number} widthTimes - 宽度倍数
 * @param {number} heightTimes - 高度倍数
 * @param {number} fontType - 字体类型
 * @param {number} fontStyle - 字体样式
 */
/**
 * 将字符串转换为 wchar_t* 所需的 UTF-16LE Buffer（带双字节终止符）
 * @param {string} str - 要转换的字符串
 * @returns {Buffer} UTF-16LE 编码的 Buffer（包含 null 终止符 0x0000）
 */
function toWcharBuffer(str) {
  if (!str || str.trim() === '') {
    // 空字符串返回双字节终止符（0x0000）
    return Buffer.alloc(2, 0);
  }
  // 核心：字符串 + '\0' → 转 UTF-16LE → 自动生成双字节终止符（0x0000）
  return Buffer.from(str + '\0', 'utf16le');
}

/**
 * 调用 Pos_Text 打印文本
 * @param {string} text - 要打印的文本
 * @param {number} encoding - 编码类型：0=GBK, 1=UTF-8, 3=BIG-5
 * @param {number} position - 位置
 * @param {number} widthTimes - 宽度倍数
 * @param {number} heightTimes - 高度倍数
 * @param {number} fontType - 字体类型
 * @param {number} fontStyle - 字体样式
 */
function printText(text, encoding, position, widthTimes, heightTimes, fontType, fontStyle) {
  if (!printerDll || !wchar_t_ptr) {
    return false;
  }
  
  try {
    // 将字符串转换为 UTF-16LE Buffer（wchar_t* 格式）
    const wcharBuffer = toWcharBuffer(text);
    
    // 直接传递 Buffer，ffi-napi 会自动处理 wchar_t* 指针转换
    // DLL 会根据 nLan 参数（encoding）来处理编码转换
    const result = printerDll.Pos_Text(wcharBuffer, encoding, position, widthTimes, heightTimes, fontType, fontStyle);
    
    return result;
  } catch (error) {
    printerLogger.error('printText 调用失败', {
      error: error.message,
      text: text.substring(0, 50),
      encoding,
      stack: error.stack
    });
    return false;
  }
}

/**
 * 加载打印机配置文件
 * 优先级：环境变量 > 配置文件 > 默认值
 * @returns {Object} 配置对象
 */
function loadPrinterConfig() {
  // 默认配置
  const defaultConfig = {
    portType: 'USB',
    portName: 'USB001',
    printerName: "POS80",
    tcpPort: 9100,
    baudrate: 9600,
    flowcontrol: 0,
    parity: 0,
    databits: 8,
    stopbits: 0,
    enabled: true,
    textEncoding: 1, // 文本编码：0=GBK(UTF-16LE), 1=UTF-8(UTF-16LE), 3=BIG-5(ANSI Buffer，直接传递)
    checkStatus: false // 是否在打印前/后查询打印机状态（默认关闭，现场柜台通常不需要）
  };

  // 尝试从配置文件读取
  let fileConfig = {};
  const configPaths = [
    // 打包环境：可执行文件同目录下的配置文件
    path.join(process.cwd(), 'printer.config.json'),
    // 开发环境：项目根目录下的配置文件
    path.join(__dirname, '../printer.config.json'),
    // 备用路径
    path.join(__dirname, '../../printer.config.json')
  ];

  for (const configPath of configPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, 'utf8');
        fileConfig = JSON.parse(configContent);
        logger.info(`✓ 已加载打印机配置文件: ${configPath}`);
        break;
      }
    } catch (error) {
      // 如果某个路径读取失败，继续尝试下一个
      logger.warn(`⚠ 读取配置文件失败 ${configPath}:`, error);
    }
  }

  // 合并配置：环境变量 > 配置文件 > 默认值
  const config = {
    portType: process.env.PRINTER_PORT_TYPE || fileConfig.portType || defaultConfig.portType,
    portName: process.env.PRINTER_PORT_NAME || fileConfig.portName || defaultConfig.portName,
    printerName: process.env.PRINTER_PRINTER_NAME || fileConfig.printerName || undefined,
    tcpPort: process.env.PRINTER_TCP_PORT 
      ? parseInt(process.env.PRINTER_TCP_PORT) 
      : (fileConfig.tcpPort !== undefined ? fileConfig.tcpPort : defaultConfig.tcpPort),
    baudrate: process.env.PRINTER_BAUDRATE 
      ? parseInt(process.env.PRINTER_BAUDRATE) 
      : (fileConfig.baudrate !== undefined ? fileConfig.baudrate : defaultConfig.baudrate),
    flowcontrol: process.env.PRINTER_FLOWCONTROL 
      ? parseInt(process.env.PRINTER_FLOWCONTROL) 
      : (fileConfig.flowcontrol !== undefined ? fileConfig.flowcontrol : defaultConfig.flowcontrol),
    parity: process.env.PRINTER_PARITY 
      ? parseInt(process.env.PRINTER_PARITY) 
      : (fileConfig.parity !== undefined ? fileConfig.parity : defaultConfig.parity),
    databits: process.env.PRINTER_DATABITS 
      ? parseInt(process.env.PRINTER_DATABITS) 
      : (fileConfig.databits !== undefined ? fileConfig.databits : defaultConfig.databits),
    stopbits: process.env.PRINTER_STOPBITS 
      ? parseInt(process.env.PRINTER_STOPBITS) 
      : (fileConfig.stopbits !== undefined ? fileConfig.stopbits : defaultConfig.stopbits),
    enabled: process.env.PRINTER_ENABLED !== undefined 
      ? process.env.PRINTER_ENABLED !== 'false' 
      : (fileConfig.enabled !== undefined ? fileConfig.enabled : defaultConfig.enabled),
    textEncoding: process.env.PRINTER_TEXT_ENCODING 
      ? parseInt(process.env.PRINTER_TEXT_ENCODING) 
      : (fileConfig.textEncoding !== undefined ? fileConfig.textEncoding : defaultConfig.textEncoding),
    checkStatus: process.env.PRINTER_CHECK_STATUS !== undefined
      ? process.env.PRINTER_CHECK_STATUS !== 'false'
      : (fileConfig.checkStatus !== undefined ? fileConfig.checkStatus : defaultConfig.checkStatus)
  };

  // 显示配置来源信息
  const configSource = Object.keys(fileConfig).length > 0 ? '配置文件' : '默认值';
  const hasEnvVars = Object.keys(process.env).some(key => key.startsWith('PRINTER_'));
  if (hasEnvVars) {
    logger.info('ℹ️  打印机配置来源: 环境变量（覆盖配置文件和默认值）');
  } else if (configSource === '配置文件') {
    logger.info('ℹ️  打印机配置来源: 配置文件');
  } else {
    logger.info('ℹ️  打印机配置来源: 默认值');
  }

  return config;
}

// 加载打印机配置
const PRINTER_CONFIG = loadPrinterConfig();

// 尝试加载 ffi-napi 和 DLL
try {
  if (PRINTER_CONFIG.enabled) {
    logger.info('========================================');
    logger.info('开始初始化打印机服务...');
    logger.info('========================================');
    
    // 使用工具函数动态加载原生模块（支持 pkg 打包环境）
    logger.info('调用 loadPrinterModules()...');
    let printerModules;
    try {
      printerModules = loadPrinterModules();
      logger.info('loadPrinterModules() 执行完成');
    } catch (loadError) {
      logger.error('❌ loadPrinterModules() 执行时发生异常:', loadError);
      throw loadError;
    }
    
    if (!printerModules) {
      logger.error('❌ loadPrinterModules() 返回 null');
      throw new Error('loadPrinterModules() 返回 null，无法加载打印机原生模块');
    }
    
    logger.info('✓ loadPrinterModules() 返回了模块对象');
    
    logger.info('已加载的模块:', Object.keys(printerModules));
    
    if (!printerModules['ffi-napi']) {
      throw new Error('无法加载 ffi-napi 模块');
    }
    
    if (!printerModules['ref-napi']) {
      throw new Error('无法加载 ref-napi 模块');
    }
    
    ffi = printerModules['ffi-napi'];
    ref = printerModules['ref-napi'];
    logger.info('✓ ffi-napi 和 ref-napi 加载成功');
    
    // 定义 wchar_t 及 wchar_t* 类型（适配 Windows DLL 的 const wchar_t*）
    // Windows 下 wchar_t = 2字节无符号短整型（ushort）
    wchar_t = ref.types.ushort;
    wchar_t_ptr = ref.refType(wchar_t); // 定义 wchar_t* 指针类型
    logger.info('✓ wchar_t 类型定义完成');
    
    // 使用工具函数获取 DLL 路径（支持 pkg 打包环境）
    const DLL_PATH = getPrinterDllPath();
    logger.info(`DLL 路径: ${DLL_PATH}`);
    
    // 验证 DLL 文件是否存在
    if (!fs.existsSync(DLL_PATH)) {
      throw new Error(`打印机 DLL 文件不存在: ${DLL_PATH}`);
    }
    logger.info('✓ DLL 文件存在');
    
    // 定义 DLL 函数签名（根据 PrinterLibs.h）
    printerDll = ffi.Library(DLL_PATH, {
      // 端口枚举函数
      'Port_EnumUSB': ['size_t', ['pointer', 'size_t']],
      
      // 端口操作函数
      'Port_OpenCOMIO': ['pointer', ['string', 'uint32', 'int', 'int', 'int', 'int']],
      'Port_OpenUSBIO': ['pointer', ['string']],
      'Port_OpenLPTIO': ['pointer', ['string']],
      'Port_OpenPRNIO': ['pointer', ['string']],
      'Port_OpenTCPIO': ['pointer', ['string', 'ushort']],
      'Port_SetPort': ['bool', ['pointer']],
      'Port_ClosePort': ['void', ['pointer']],
      
      // 打印函数
      'Pos_Reset': ['bool', []],
      'Pos_SelfTest': ['bool', []],
      'Pos_FeedLine': ['bool', []],
      'Pos_Feed_N_Line': ['bool', ['int']],
      'Pos_Align': ['bool', ['int']],
      'Pos_Text': ['bool', [wchar_t_ptr, 'int', 'int', 'int', 'int', 'int', 'int']],
      'Pos_FullCutPaper': ['bool', []],
      'Pos_HalfCutPaper': ['bool', []],
      
      // 查询函数
      'Pos_QueryPrinterErr': ['int', ['ulong']]
    });
    
    logger.info('✓ 打印机 DLL 函数绑定成功');
    printerLogger.info('打印机 DLL 加载成功', { dllPath: DLL_PATH, config: PRINTER_CONFIG });
  } else {
    printerLogger.info('打印机功能已禁用（PRINTER_ENABLED=false）');
  }
} catch (error) {
  logger.error('❌ 打印机 DLL 加载失败:', error);
  
  printerLogger.warn('打印机 DLL 加载失败，将使用模拟模式', { 
    error: error.message,
    stack: error.stack,
    hint: '请确保已安装依赖: npm install ffi-napi ref-napi ref-struct-napi ref-array-napi。如果是打包环境，请确保这些模块已复制到可执行文件同目录下的 node_modules 目录中。'
  });
  printerDll = null;
  ffi = null;
  ref = null;
}

/**
 * 打开打印机端口
 * @returns {Promise<boolean>} 是否成功
 */
async function openPort() {
  if (!printerDll) {
    return false;
  }
  
  // 如果已经打开，先关闭
  if (printerHandle) {
    await closePort();
  }
  
  try {
    let handle = null;
    let actualPortName = PRINTER_CONFIG.portName;
    
    switch (PRINTER_CONFIG.portType.toUpperCase()) {
      case 'COM':
        handle = printerDll.Port_OpenCOMIO(
          PRINTER_CONFIG.portName,
          PRINTER_CONFIG.baudrate,
          PRINTER_CONFIG.flowcontrol,
          PRINTER_CONFIG.parity,
          PRINTER_CONFIG.databits,
          PRINTER_CONFIG.stopbits
        );
        break;
        
      case 'USB':
        // 使用 Port_OpenUSBIO 打开底层 USB 端口
        // 这里的 portName 应配置为 USB 端口名，例如：USB001 / USB002 / USBPRINT\...\USB002
        if (!PRINTER_CONFIG.portName) {
          throw new Error('USB 端口类型需要配置 portName（例如：USB001 / USB002 或 USBPRINT\\\\...\\\\USB002）');
        }

        printerLogger.info(`使用 Port_OpenUSBIO 打开 USB 端口: ${PRINTER_CONFIG.portName}`);
        handle = printerDll.Port_OpenUSBIO(PRINTER_CONFIG.portName);

        if (handle.isNull()) {
          throw new Error(
            `无法使用 Port_OpenUSBIO 打开 USB 端口 "${PRINTER_CONFIG.portName}"。请检查：\n` +
            `1. 端口名称是否正确（可通过 wmic 或 EnumUSB 查询，如 USB002）\n` +
            `2. 设备管理器中是否显示 "USB Printing Support" / "USB 打印支持"\n` +
            `3. 打印机是否已连接、已开机且驱动安装正常`
          );
        }

        actualPortName = PRINTER_CONFIG.portName;
        break;
        
      case 'LPT':
        handle = printerDll.Port_OpenLPTIO(PRINTER_CONFIG.portName);
        break;
        
      case 'PRN':
        handle = printerDll.Port_OpenPRNIO(PRINTER_CONFIG.portName);
        break;
        
      case 'TCP':
        handle = printerDll.Port_OpenTCPIO(PRINTER_CONFIG.portName, PRINTER_CONFIG.tcpPort);
        break;
        
      default:
        throw new Error(`不支持的端口类型: ${PRINTER_CONFIG.portType}`);
    }
    
    // 检查句柄是否有效（非零表示成功，零表示失败）
    if (handle.isNull()) {
      const errorMsg = `无法打开端口 ${actualPortName}，请检查：\n` +
        `1. 打印机是否已连接并开机\n` +
        `2. 设备管理器中是否显示"USB Printing Support"\n` +
        `3. 如果显示的是"Prolific USB-to-Serial Comm Port"，请改用COM端口类型`;
      throw new Error(errorMsg);
    }
    
    // 设置端口
    const setResult = printerDll.Port_SetPort(handle);
    if (!setResult) {
      printerDll.Port_ClosePort(handle);
      throw new Error('设置端口失败');
    }
    
    printerHandle = handle;
    printerLogger.info(`打印机端口打开成功: ${PRINTER_CONFIG.portType}:${actualPortName}`);
    return true;
    
  } catch (error) {
    printerLogger.error('打开打印机端口失败', { 
      error: error.message,
      stack: error.stack,
      portType: PRINTER_CONFIG.portType,
      portName: PRINTER_CONFIG.portName
    });
    printerHandle = null;
    return false;
  }
}

/**
 * 关闭打印机端口
 * @returns {Promise<boolean>} 是否成功
 */
async function closePort() {
  if (!printerDll || !printerHandle) {
    return false;
  }
  
  try {
    printerDll.Port_ClosePort(printerHandle);
    printerHandle = null;
    return true;
  } catch (error) {
    printerLogger.error('关闭打印机端口失败', { 
      error: error.message,
      stack: error.stack
    });
    printerHandle = null;
    return false;
  }
}

/**
 * 初始化打印机
 * @returns {Promise<boolean>} 是否成功
 */
async function initPrinter() {
  if (!printerDll) {
    printerLogger.warn('打印机 DLL 未加载，跳过初始化');
    return false;
  }
  
  try {
    // 打开端口
    const opened = await openPort();
    if (!opened) {
      return false;
    }
    
    // 重置打印机
    const resetResult = printerDll.Pos_Reset();
    if (!resetResult) {
      printerLogger.warn('打印机重置失败，但继续执行');
    }
    
    // 打印测试页
    const selfTestResult = printerDll.Pos_SelfTest();
    if (!selfTestResult) {
      printerLogger.warn('打印测试页失败，但继续执行');
    } else {
      printerLogger.info('打印机测试页打印成功');
    }
    
    printerLogger.info('打印机初始化成功');
    return true;
  } catch (error) {
    printerLogger.error('初始化打印机失败', { 
      error: error.message,
      stack: error.stack
    });
    return false;
  }
}


/**
 * 打印订单小票
 * @param {Object} orderData - 订单数据
 * @param {string} orderData.order_number - 订单号
 * @param {number} orderData.daily_sequence - 当日序号
 * @param {number} orderData.order_type - 订单类型（0=堂食，1=外卖）
 * @param {Array} orderData.items - 订单明细数组 [{name, quantity, price, subtotal}, ...]
 * @param {number} orderData.total_amount - 订单总金额
 * @param {number} orderData.total_quantity - 订单总数量
 * @param {string} orderData.order_time - 订单时间（YYYY-MM-DD HH:mm:ss）
 * @param {string} orderData.store_name_zh - 店铺名称（中文）
 * @param {string} orderData.store_name_en - 店铺名称（英文）
 * @param {string} orderData.payment_type_zh - 支付类型（中文）
 * @param {string} orderData.payment_type_en - 支付类型（英文）
 * @returns {Promise<{success: boolean, message: string}>} 打印结果
 */
async function printOrderReceipt(orderData) {
  const {
    order_number,
    daily_sequence,
    order_type,
    items,
    total_amount,
    total_quantity,
    order_time,
    store_name_zh,
    store_name_en,
    payment_type_zh,
    payment_type_en
  } = orderData;
  
  // 如果 DLL 未加载，返回模拟结果
  if (!printerDll) {
    printerLogger.debug('模拟打印订单小票（DLL未加载）', {
      order_number,
      items: items?.length || 0,
      total_amount
    });
    return {
      success: true,
      message: '模拟打印成功（DLL未加载）'
    };
  }
  
  try {
    // 确保端口已打开
    if (!printerHandle) {
      const opened = await openPort();
      if (!opened) {
        return {
          success: false,
          message: '無法打開打印機，請檢查打印機連接'
        };
      }
    }
    
    // 打印前检查打印机状态
    if (PRINTER_CONFIG.checkStatus) {
      try {
        const statusBefore = await queryPrinterStatus();
        if (statusBefore.error === -3) {
          printerLogger.warn('打印前检测到缺纸', { status: statusBefore });
          return {
            success: false,
            message: '打印機缺紙，請添加紙張後重試'
          };
        } else if (statusBefore.error === -1) {
          printerLogger.warn('打印前检测到打印机脱机', { status: statusBefore });
          return {
            success: false,
            message: '打印機離線，請檢查打印機連接'
          };
        } else if (statusBefore.error === -2) {
          printerLogger.warn('打印前检测到上盖打开', { status: statusBefore });
          return {
            success: false,
            message: '打印機上蓋打開，請關閉上蓋後重試'
          };
        }
      } catch (statusError) {
        printerLogger.debug('打印前状态查询失败，继续打印', { error: statusError.message });
      }
    }
    
    // 繁体中文编码
    const TRADITIONAL_CHINESE_ENCODING = 3; // 繁体中文固定使用 BIG-5
    const TEXT_ENCODING = PRINTER_CONFIG.textEncoding !== undefined ? PRINTER_CONFIG.textEncoding : 0;
    
    // 定义字号倍数：表格区域、时间、交易号等使用0.9倍，序号数字使用1.5倍
    const NORMAL_SIZE = 0.9; // 表格/时间/交易号等区域的字号倍数
    const SEQ_NUMBER_SIZE = 1.0; // 序号数字字号倍数
    
    // 纸张宽度限制：80mm热敏打印机（POS80）标准字体约48个ASCII字符/行
    // 使用1.0倍字号时，最大行宽约48个字符
    const MAX_LINE_WIDTH = 48; // 最大行宽（ASCII字符数）
    
    // 分隔线长度：一行48个"-"（固定长度）
    const SEPARATOR_LENGTH = 48;
    const SEPARATOR_LINE = '-'.repeat(SEPARATOR_LENGTH); // 生成分隔线
    
    // 文本截断函数，确保不超过指定宽度
    const truncateText = (text, maxWidth) => {
      if (!text) return '';
      const str = String(text);
      // 简单截断：如果超过最大宽度，截断并添加省略号
      if (str.length > maxWidth) {
        return str.substring(0, maxWidth - 1) + '…';
      }
      return str;
    };
    
    // 1. 打印店铺名称（中英文同一行，居中，0.9倍字号）
    printerDll.Pos_Align(1);
    let storeNameLine = '';
    if (store_name_zh && store_name_en) {
      // 中英文都有，用 " - " 连接
      storeNameLine = `${store_name_zh} - ${store_name_en}`;
    } else if (store_name_zh) {
      // 只有中文
      storeNameLine = store_name_zh;
    } else if (store_name_en) {
      // 只有英文
      storeNameLine = store_name_en;
    }
    
    if (storeNameLine) {
      // 使用繁体中文编码打印整行（包含中英文）
      printText(storeNameLine, TRADITIONAL_CHINESE_ENCODING, -2, NORMAL_SIZE, NORMAL_SIZE, 0, 0);
      printerDll.Pos_FeedLine();
    }
    
    // 打印"您的號碼(Your number)"行（居中，使用更小字号）
    const ticketNumberLabel = '***您的號碼(Your number)***';
    printText(ticketNumberLabel, TRADITIONAL_CHINESE_ENCODING, -2, 0.7, 0.7, 0, 0);
    printerDll.Pos_FeedLine();
    
    // 打印订单号码（居中，1.5倍字号）
    // 格式：堂食=D，外卖=T，后跟4位序号（不足补0）
    if (daily_sequence !== undefined && daily_sequence !== null) {
      const orderTypeCode = order_type === 1 ? 'T' : 'D'; // 1=外卖=T，0=堂食=D
      const sequenceStr = String(daily_sequence).padStart(4, '0'); // 4位序号，不足补0
      const orderNumber = `${orderTypeCode}${sequenceStr}`; // 例如：D0007, T0007
      printText(orderNumber, TEXT_ENCODING, -2, SEQ_NUMBER_SIZE, SEQ_NUMBER_SIZE, 0, 0x08); // 1.5倍字号，加粗
      printerDll.Pos_FeedLine();
    }
    
    // 2. 打印分隔线（根据字号倍数动态计算长度，占满一行）
    printerDll.Pos_Align(0);
    printText(SEPARATOR_LINE, TEXT_ENCODING, -1, NORMAL_SIZE, NORMAL_SIZE, 0, 0);
    printerDll.Pos_FeedLine();
    
    // 3. 打印店号、类型、时间、交易号（序号已在店铺名称下方显示，此处不再重复）
    // 获取店铺号码（从订单编号中提取，或使用默认值001）
    let storeNumber = '001';
    if (order_number && order_number.length >= 4) {
      // 订单编号格式：D001... 或 T001...，第2-4位是店铺号码
      storeNumber = order_number.substring(1, 4);
    }
    
    // 打印店号
    printText(`店號(Store No)：${storeNumber}`, TRADITIONAL_CHINESE_ENCODING, -1, NORMAL_SIZE, NORMAL_SIZE, 0, 0);
    printerDll.Pos_FeedLine();
    
    // 打印类型
    const typeTextZh = order_type === 1 ? '外賣' : '堂食';
    printText(`類型(Type)：${typeTextZh}`, TRADITIONAL_CHINESE_ENCODING, -1, NORMAL_SIZE, NORMAL_SIZE, 0, 0);
    printerDll.Pos_FeedLine();
    
    // 确保交易时间和交易号不超过最大宽度
    const timeLine = `交易時間(Time): ${order_time}`;
    printText(truncateText(timeLine, MAX_LINE_WIDTH), TRADITIONAL_CHINESE_ENCODING, -1, NORMAL_SIZE, NORMAL_SIZE, 0, 0);
    printerDll.Pos_FeedLine();
    
    const orderNumLine = `交易號(TN): ${order_number}`;
    printText(truncateText(orderNumLine, MAX_LINE_WIDTH), TRADITIONAL_CHINESE_ENCODING, -1, NORMAL_SIZE, NORMAL_SIZE, 0, 0);
    printerDll.Pos_FeedLine();
    
    // 4. 分隔线（根据字号倍数动态计算长度，占满一行）
    printText(SEPARATOR_LINE, TEXT_ENCODING, -1, NORMAL_SIZE, NORMAL_SIZE, 0, 0);
    printerDll.Pos_FeedLine();
    
    // 5. 打印表头（使用列位置记录方式，确保对齐）
    // 80mm热敏打印机限制：标准字体约48字符/行，0.9倍字号约53字符/行
    // 定义列宽（ASCII字符数）
    // 16 + 8 + 10 + 14 = 48
    const COL_WIDTH_NAME = 16;  // 品項/Item 列宽
    const COL_WIDTH_QTY = 8;    // 數量/Qty 列宽
    const COL_WIDTH_PRICE = 10; // 單價/Unit Price 列宽
    const COL_WIDTH_AMOUNT = 14; // 小計/Amount 列宽
    
    // 计算每列的起始位置（基于ASCII字符位置）
    const COL_POS_NAME = 0;                    // 品項列起始位置（左对齐，从0开始）
    const COL_POS_QTY = COL_WIDTH_NAME;        // 數量列起始位置
    const COL_POS_PRICE = COL_POS_QTY + COL_WIDTH_QTY;    // 單價列起始位置
    const COL_POS_AMOUNT = COL_POS_PRICE + COL_WIDTH_PRICE; // 小計列起始位置
    
    // 计算文本的实际显示宽度（考虑中文字符占2个ASCII字符）
    const getDisplayWidth = (text) => {
      let width = 0;
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        // 判断是否为中文字符（包括繁体中文）
        if (/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(char)) {
          width += 2; // 中文字符占2个ASCII字符宽度
        } else {
          width += 1; // 英文字符占1个ASCII字符宽度
        }
      }
      return width;
    };
    
    // 左对齐格式化（考虑中文字符宽度）
    const leftAlign = (text, targetWidth) => {
      const displayWidth = getDisplayWidth(text);
      const padding = Math.max(0, targetWidth - displayWidth);
      return text + ' '.repeat(padding);
    };
    
    // 居中对齐格式化（考虑中文字符宽度）
    const centerAlign = (text, targetWidth) => {
      const displayWidth = getDisplayWidth(text);
      const totalPadding = Math.max(0, targetWidth - displayWidth);
      const leftPadding = Math.floor(totalPadding / 2);
      const rightPadding = totalPadding - leftPadding;
      return ' '.repeat(leftPadding) + text + ' '.repeat(rightPadding);
    };
    
    // 右对齐格式化（考虑中文字符宽度）
    const rightAlign = (text, targetWidth) => {
      const displayWidth = getDisplayWidth(text);
      const padding = Math.max(0, targetWidth - displayWidth);
      return ' '.repeat(padding) + text;
    };
    
    // 构建表头/数据行：使用固定位置拼接
    const buildTableRow = (name, qty, price, amount, nameAlignCenter = false) => {
      // 需要居中时第一列居中，否则左对齐
      const namePart = nameAlignCenter ? centerAlign(name, COL_WIDTH_NAME) : leftAlign(name, COL_WIDTH_NAME);
      const qtyPart = centerAlign(qty, COL_WIDTH_QTY);
      const pricePart = centerAlign(price, COL_WIDTH_PRICE);
      const amountPart = centerAlign(amount, COL_WIDTH_AMOUNT);
      return namePart + qtyPart + pricePart + amountPart;
    };
    
    // 中文表头（第一列左对齐，加粗；去掉实际打印中的左侧缩进）
    const headerZh = buildTableRow('品項', '數量', '單價', '小計', false);
    printText(headerZh, TRADITIONAL_CHINESE_ENCODING, -1, NORMAL_SIZE, NORMAL_SIZE, 0, 0x08);
    printerDll.Pos_FeedLine();
    
    // 英文表头（第一列左对齐，加粗）
    const headerEn = buildTableRow('Item', 'Qty', 'Unit Price', 'Amount', false);
    printText(headerEn, TEXT_ENCODING, -1, NORMAL_SIZE, NORMAL_SIZE, 0, 0x08);
    printerDll.Pos_FeedLine();
    
    // 6. 打印订单明细（使用相同的格式化函数确保对齐，第一列左对齐）
    if (items && Array.isArray(items) && items.length > 0) {
      items.forEach((item) => {
        // 确保菜品名称不超过列宽
        const itemName = truncateText(item.name || '', COL_WIDTH_NAME);
        const itemRow = buildTableRow(
          itemName,
          String(item.quantity),
          String(item.price),
          String(item.subtotal),
          false // 数据行第一列左对齐
        );
        printText(itemRow, TEXT_ENCODING, -1, NORMAL_SIZE, NORMAL_SIZE, 0, 0);
        printerDll.Pos_FeedLine();
      });
      printerDll.Pos_FeedLine();
    }
    
    // 7. 打印合计前的分隔线
    printText(SEPARATOR_LINE, TEXT_ENCODING, -1, NORMAL_SIZE, NORMAL_SIZE, 0, 0);
    printerDll.Pos_FeedLine();
    
    // 8. 打印合计（使用相同的格式化函数确保对齐，第一列左对齐）
    const qtyTotal = total_quantity !== undefined && total_quantity !== null
      ? total_quantity
      : (items || []).reduce((sum, it) => sum + (it.quantity || 0), 0);
    const totalRow = buildTableRow(
      '合計 Total',
      String(qtyTotal),
      '',  // 单价列留空
      `HK$${total_amount}`,
      false // 合计行第一列左对齐
    );
    printText(totalRow, TRADITIONAL_CHINESE_ENCODING, -1, NORMAL_SIZE, NORMAL_SIZE, 0, 0x08);
    printerDll.Pos_FeedLine();
    
    // 9. 分隔线（根据字号倍数动态计算长度，占满一行）
    printText(SEPARATOR_LINE, TEXT_ENCODING, -1, NORMAL_SIZE, NORMAL_SIZE, 0, 0);
    printerDll.Pos_FeedLine();
    
    // 10. 打印支付类型（中英文两行，左对齐，标签和值对齐为两列）
    printerDll.Pos_Align(0); // 左对齐
    printerDll.Pos_FeedLine();

    // 标签列宽（使用显示宽度，考虑中英文混排）
    const PAY_LABEL_WIDTH = 12;
    const buildLabelValueLine = (label, value) => {
      const safeValue = value || '';
      const labelPart = leftAlign(label, PAY_LABEL_WIDTH);
      return `${labelPart}  ${safeValue}`;
    };
    
    // 中文：支付類型           微信支付
    const payTypeZh = truncateText(payment_type_zh || '', 20);
    const payTypeLineZh = buildLabelValueLine('支付類型', payTypeZh);
    printText(payTypeLineZh, TRADITIONAL_CHINESE_ENCODING, -1, NORMAL_SIZE, NORMAL_SIZE, 0, 0);
    printerDll.Pos_FeedLine();
    
    // 英文：Payment type      WeChat Pay
    const payTypeEn = truncateText(payment_type_en || '', 30);
    if (payTypeEn) {
      const payTypeLineEn = buildLabelValueLine('Payment type', payTypeEn);
      printText(payTypeLineEn, TEXT_ENCODING, -1, NORMAL_SIZE, NORMAL_SIZE, 0, 0);
      printerDll.Pos_FeedLine();
    }
    
    // 11. 分隔线
    printText(SEPARATOR_LINE, TEXT_ENCODING, -1, NORMAL_SIZE, NORMAL_SIZE, 0, 0);
    printerDll.Pos_FeedLine();
    
    // 12. 支付金额一行：支付金額 和 金额在同一行显示，左/右对齐，统一样式（1.5倍字号，加粗）
    const payAmountText = `HK$${total_amount}`;
    const payAmountLabel = '支付金額';
    const labelWidth = getDisplayWidth(payAmountLabel);
    const amountWidth = getDisplayWidth(payAmountText);
    const lineTotalWidth = MAX_LINE_WIDTH; // 使用整行最大宽度
    const spaceWidth = Math.max(1, lineTotalWidth - labelWidth - amountWidth);
    const payAmountLine = payAmountLabel + ' '.repeat(spaceWidth) + payAmountText;
    // 整行统一使用繁体中文编码、1.5倍字号并加粗
    printText(payAmountLine, TRADITIONAL_CHINESE_ENCODING, -1, 1.5, 1.5, 0, 0x08);
    printerDll.Pos_FeedLine();
    
    // 13. 分隔线
    printText(SEPARATOR_LINE, TEXT_ENCODING, -1, NORMAL_SIZE, NORMAL_SIZE, 0, 0);
    printerDll.Pos_FeedLine();
    
    // 14. 打印提示信息（居中对齐）
    printerDll.Pos_Align(1);
    printerDll.Pos_FeedLine();
    printText('感謝您的惠顧', TRADITIONAL_CHINESE_ENCODING, -2, NORMAL_SIZE, NORMAL_SIZE, 0, 0);
    printerDll.Pos_FeedLine();
    printText('Thank You!', TEXT_ENCODING, -2, NORMAL_SIZE, NORMAL_SIZE, 0, 0);
    printerDll.Pos_FeedLine();
    
    // 15. 进纸
    printerDll.Pos_Feed_N_Line(4);
    
    // 16. 切纸
    try {
      printerDll.Pos_FullCutPaper();
    } catch (error) {
      printerLogger.debug('打印机可能没有切刀功能', { error: error.message });
    }
    
    // 12. 再进纸一行
    printerDll.Pos_FeedLine();
    
    // 打印后检查状态
    let printStatus = '成功';
    if (PRINTER_CONFIG.checkStatus) {
      try {
        await new Promise(resolve => setTimeout(resolve, 500));
        const statusAfter = await queryPrinterStatus();
        if (statusAfter.error === -3) {
          printStatus = '可能缺纸';
          printerLogger.warn('打印后检测到缺纸', { status: statusAfter, order_number });
        }
      } catch (statusError) {
        printerLogger.debug('打印后状态查询失败', { error: statusError.message });
      }
    }
    
    printerLogger.debug('订单小票打印完成', {
      order_number,
      items_count: items?.length || 0,
      total_amount,
      order_time,
      status: printStatus
    });
    
    if (printStatus === '可能缺纸') {
      return {
        success: false,
        message: '打印可能不完整：檢測到缺紙，請檢查打印結果'
      };
    }
    
    return {
      success: true,
      message: '打印成功'
    };
    
  } catch (error) {
    printerLogger.error('打印订单小票失败', {
      error: error.message,
      stack: error.stack,
      order_number,
      items_count: items?.length || 0,
      total_amount
    });
    return {
      success: false,
      message: `打印失敗: ${error.message}`
    };
  }
}

/**
 * 关闭打印机连接
 * @returns {Promise<boolean>} 是否成功
 */
async function closePrinter() {
  return await closePort();
}

/**
 * 查询打印机状态
 * @returns {Promise<{status: string, error: number}>} 打印机状态
 */
async function queryPrinterStatus() {
  if (!printerDll || !printerHandle) {
    return {
      status: '未连接',
      error: -999
    };
  }
  
  try {
    const errorCode = printerDll.Pos_QueryPrinterErr(3000); // 3秒超时
    
    const statusMap = {
      1: '正常',
      '-1': '脱机',
      '-2': '上盖打开',
      '-3': '缺纸',
      '-4': '切刀异常',
      '-5': '头片温度过高',
      '-6': '查询失败'
    };
    
    const status = statusMap[errorCode] || '未知状态';
    printerLogger.debug('查询打印机状态', { status, errorCode });
    return {
      status,
      error: errorCode
    };
  } catch (error) {
    printerLogger.error('查询打印机状态失败', { 
      error: error.message,
      stack: error.stack
    });
    return {
      status: '查询失败',
      error: -999
    };
  }
}

module.exports = {
  initPrinter,
  printOrderReceipt,
  closePrinter,
  queryPrinterStatus,
  isAvailable: () => printerDll !== null,
  getConfig: () => ({ ...PRINTER_CONFIG })
};
