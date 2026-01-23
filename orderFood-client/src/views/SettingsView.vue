<template>
  <div class="settings-page">
    <!-- 顶部标题栏 -->
    <div class="header">
      <div class="header-content">
        <h1>
          <span class="store-name" v-if="storeName">{{ storeName }}</span>
          <span v-if="storeName" class="separator"> - </span>
          <span>{{ currentLanguage === 'zh' ? '系統設置' : 'System Settings' }}</span>
        </h1>
      </div>
      <button class="lang-switch-btn" @click="toggleLanguage">
        {{ currentLanguage === 'zh' ? 'EN' : '中' }}
      </button>
    </div>

    <!-- 设置内容区 -->
    <div class="settings-container">
      <div class="settings-wrapper">
        <div v-if="loading" class="loading">
          {{ currentLanguage === 'zh' ? '載入中...' : 'Loading...' }}
        </div>
        
        <div v-else-if="error" class="error">
          {{ error }}
        </div>
        
        <div v-else class="settings-content">
        <!-- 按分类显示设置 -->
        <div 
          v-for="category in categories" 
          :key="category"
          class="settings-category"
        >
          <h2 class="category-title">{{ getCategoryName(category) }}</h2>
          
          <div class="settings-list">
            <div 
              v-for="setting in getSettingsByCategory(category)" 
              :key="setting.id"
              class="setting-item"
            >
              <div class="setting-info">
                <div class="setting-key">{{ setting.key }}</div>
                <div class="setting-description" v-if="setting.description">
                  {{ setting.description }}
                </div>
              </div>
              
              <div class="setting-control">
                <!-- 文本输入 -->
                <input
                  v-if="isTextInput(setting.value)"
                  type="text"
                  v-model="editingValues[setting.id]"
                  class="setting-input"
                  :placeholder="getValuePlaceholder(setting.value)"
                />
                
                <!-- 数字输入 -->
                <input
                  v-else-if="typeof setting.value === 'number'"
                  type="number"
                  v-model.number="editingValues[setting.id]"
                  class="setting-input"
                />
                
                <!-- 布尔值开关 -->
                <label v-else-if="typeof setting.value === 'boolean'" class="switch">
                  <input
                    type="checkbox"
                    v-model="editingValues[setting.id]"
                  />
                  <span class="slider"></span>
                </label>
                
                <!-- 文本区域（用于长文本） -->
                <textarea
                  v-else-if="typeof setting.value === 'string' && setting.value.length > 50"
                  v-model="editingValues[setting.id]"
                  class="setting-textarea"
                  rows="3"
                ></textarea>
                
                <!-- 默认文本输入 -->
                <input
                  v-else
                  type="text"
                  v-model="editingValues[setting.id]"
                  class="setting-input"
                />
              </div>
              
              <button 
                class="save-btn"
                @click="saveSetting(setting)"
                :disabled="isSaving[setting.id]"
              >
                {{ isSaving[setting.id] 
                  ? (currentLanguage === 'zh' ? '保存中...' : 'Saving...') 
                  : (currentLanguage === 'zh' ? '保存' : 'Save') 
                }}
              </button>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>

    <!-- 底部操作区 -->
    <div class="footer-actions">
      <div class="footer-content">
        <button class="save-all-btn" @click="saveAllSettings" :disabled="isSavingAll">
          {{ isSavingAll 
            ? (currentLanguage === 'zh' ? '保存中...' : 'Saving...') 
            : (currentLanguage === 'zh' ? '保存' : 'Save') 
          }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { orderService } from '@/api';
import { ElMessage } from 'element-plus';

const router = useRouter();

const settings = ref([]);
const loading = ref(false);
const error = ref('');
const currentLanguage = ref('zh');
const storeName = ref('');
const editingValues = ref({});
const isSaving = ref({});
const isSavingAll = ref(false);

// 分类列表
const categories = computed(() => {
  const cats = [...new Set(settings.value.map(s => s.category || 'general'))];
  return cats.sort();
});

// 按分类获取设置
const getSettingsByCategory = (category) => {
  return settings.value.filter(s => (s.category || 'general') === category);
};

// 获取分类名称
const getCategoryName = (category) => {
  const names = {
    'store': currentLanguage.value === 'zh' ? '店鋪信息' : 'Store Information',
    'sync': currentLanguage.value === 'zh' ? '云端同步' : 'Cloud Sync',
    'system': currentLanguage.value === 'zh' ? '系統設置' : 'System Settings',
    'general': currentLanguage.value === 'zh' ? '一般設置' : 'General Settings'
  };
  return names[category] || category;
};

// 判断是否为文本输入
const isTextInput = (value) => {
  return typeof value === 'string' && value.length <= 50;
};

// 获取值占位符
const getValuePlaceholder = (value) => {
  if (value === null || value === undefined) {
    return currentLanguage.value === 'zh' ? '请输入值' : 'Enter value';
  }
  return String(value);
};

// 切换语言
const toggleLanguage = () => {
  currentLanguage.value = currentLanguage.value === 'zh' ? 'en' : 'zh';
  localStorage.setItem('app_language', currentLanguage.value);
  loadStoreName();
};

// 加载店铺名称
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
    }
  } catch (error) {
    console.error('載入店鋪名稱失敗:', error);
    storeName.value = '';
  }
};

// 加载设置列表
const loadSettings = async () => {
  loading.value = true;
  error.value = '';
  
  try {
    const response = await orderService.getSettings();
    if (response.data && response.data.success) {
      settings.value = response.data.data || [];
      
      // 初始化编辑值
      editingValues.value = {};
      settings.value.forEach(setting => {
        editingValues.value[setting.id] = setting.value;
      });
    } else {
      error.value = currentLanguage.value === 'zh' 
        ? '載入設置失敗' 
        : 'Failed to load settings';
    }
  } catch (err) {
    console.error('載入設置失敗:', err);
    error.value = currentLanguage.value === 'zh' 
      ? '載入設置失敗: ' + (err.message || '未知錯誤') 
      : 'Failed to load settings: ' + (err.message || 'Unknown error');
    ElMessage.error(error.value);
  } finally {
    loading.value = false;
  }
};

// 保存单个设置
const saveSetting = async (setting) => {
  const settingId = setting.id;
  isSaving.value[settingId] = true;
  
  try {
    const newValue = editingValues.value[settingId];
    
    const response = await orderService.updateSettings({
      key: setting.key,
      value: newValue,
      description: setting.description
    });
    
    if (response.data && response.data.success) {
      ElMessage.success(
        currentLanguage.value === 'zh' 
          ? '設置已保存' 
          : 'Setting saved successfully'
      );
      
      // 更新本地设置值
      const updatedSetting = response.data.data;
      const index = settings.value.findIndex(s => s.id === settingId);
      if (index !== -1) {
        settings.value[index] = updatedSetting;
      }
    } else {
      throw new Error(response.data?.message || '保存失敗');
    }
  } catch (err) {
    console.error('保存設置失敗:', err);
    ElMessage.error(
      currentLanguage.value === 'zh' 
        ? '保存設置失敗: ' + (err.message || '未知錯誤') 
        : 'Failed to save setting: ' + (err.message || 'Unknown error')
    );
  } finally {
    isSaving.value[settingId] = false;
  }
};

// 保存所有设置
const saveAllSettings = async () => {
  isSavingAll.value = true;
  let successCount = 0;
  let failCount = 0;
  
  try {
    // 获取所有已修改的设置项
    const settingsToSave = settings.value.filter(setting => {
      const originalValue = setting.value;
      const editedValue = editingValues.value[setting.id];
      return JSON.stringify(originalValue) !== JSON.stringify(editedValue);
    });
    
    if (settingsToSave.length === 0) {
      ElMessage.info(
        currentLanguage.value === 'zh' 
          ? '沒有需要保存的更改' 
          : 'No changes to save'
      );
      return;
    }
    
    // 批量保存所有修改的设置
    for (const setting of settingsToSave) {
      try {
        const newValue = editingValues.value[setting.id];
        
        const response = await orderService.updateSettings({
          key: setting.key,
          value: newValue,
          description: setting.description
        });
        
        if (response.data && response.data.success) {
          successCount++;
          // 更新本地设置值
          const updatedSetting = response.data.data;
          const index = settings.value.findIndex(s => s.id === setting.id);
          if (index !== -1) {
            settings.value[index] = updatedSetting;
          }
        } else {
          failCount++;
        }
      } catch (err) {
        console.error(`保存設置 ${setting.key} 失敗:`, err);
        failCount++;
      }
    }
    
    if (failCount === 0) {
      ElMessage.success(
        currentLanguage.value === 'zh' 
          ? `成功保存 ${successCount} 項設置` 
          : `Successfully saved ${successCount} settings`
      );
    } else {
      ElMessage.warning(
        currentLanguage.value === 'zh' 
          ? `保存完成：成功 ${successCount} 項，失敗 ${failCount} 項` 
          : `Save completed: ${successCount} succeeded, ${failCount} failed`
      );
    }
  } catch (err) {
    console.error('批量保存設置失敗:', err);
    ElMessage.error(
      currentLanguage.value === 'zh' 
        ? '批量保存設置失敗' 
        : 'Failed to save settings'
    );
  } finally {
    isSavingAll.value = false;
  }
};

// 初始化
onMounted(() => {
  // 从 localStorage 读取语言设置
  const savedLanguage = localStorage.getItem('app_language');
  if (savedLanguage === 'zh' || savedLanguage === 'en') {
    currentLanguage.value = savedLanguage;
  }
  
  loadStoreName();
  loadSettings();
});
</script>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: "Microsoft YaHei", sans-serif;
}

.settings-page {
  background-color: #f8f8f8;
  height: 100vh;
  width: 100vw;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: fixed;
  top: 0;
  left: 0;
}

/* 顶部标题栏 */
.header {
  background-color: #e63946;
  color: white;
  padding: 20px 30px;
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
  align-items: center;
  justify-content: center;
}

.header h1 {
  font-size: 24px;
  font-weight: bold;
  margin: 0;
  line-height: 1.2;
  display: flex;
  align-items: center;
  gap: 8px;
}

.store-name {
  font-size: 24px;
  font-weight: 500;
  line-height: 1.2;
}

.separator {
  font-size: 24px;
  font-weight: 500;
  line-height: 1.2;
}

.lang-switch-btn {
  position: absolute;
  right: 30px;
  top: 50%;
  transform: translateY(-50%);
  background-color: rgba(255, 255, 255, 0.2);
  border: 2px solid rgba(255, 255, 255, 0.5);
  color: white;
  padding: 8px 16px;
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

/* 设置容器 */
.settings-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  width: 100%;
}

.settings-wrapper {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px 40px;
  width: 100%;
}

.loading, .error {
  text-align: center;
  padding: 60px 20px;
  font-size: 16px;
  color: #666;
}

.error {
  color: #e63946;
}

.settings-content {
  max-width: 100%;
}

.settings-category {
  margin-bottom: 20px;
  background-color: white;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
}

.category-title {
  font-size: 18px;
  font-weight: bold;
  color: #333;
  margin-bottom: 15px;
  padding-bottom: 8px;
  border-bottom: 2px solid #e63946;
}

.settings-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.setting-item {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 15px;
  background-color: #f8f8f8;
  border-radius: 6px;
  border: 1px solid #e0e0e0;
}

.setting-info {
  flex: 1;
  min-width: 0;
}

.setting-key {
  font-size: 14px;
  font-weight: bold;
  color: #333;
  margin-bottom: 4px;
  word-break: break-word;
}

.setting-description {
  font-size: 12px;
  color: #666;
  word-break: break-word;
}

.setting-control {
  flex: 1;
  min-width: 200px;
  max-width: 400px;
}

.setting-input,
.setting-textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  font-family: inherit;
  transition: border-color 0.3s;
}

.setting-input:focus,
.setting-textarea:focus {
  outline: none;
  border-color: #e63946;
}

.setting-textarea {
  resize: vertical;
  min-height: 80px;
}

/* 开关样式 */
.switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 22px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #ccc;
  transition: 0.4s;
  border-radius: 24px;
}

.slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.4s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: #e63946;
}

input:checked + .slider:before {
  transform: translateX(26px);
}

.save-btn {
  padding: 8px 20px;
  background-color: #e63946;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.save-btn:hover:not(:disabled) {
  background-color: #d62839;
}

.save-btn:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}

/* 底部操作区 */
.footer-actions {
  width: 100%;
  background-color: white;
  box-shadow: 0 -3px 8px rgba(0, 0, 0, 0.1);
  flex-shrink: 0;
}

.footer-content {
  max-width: 1400px;
  margin: 0 auto;
  padding: 15px 40px;
  display: flex;
  gap: 15px;
  justify-content: center;
}

.save-all-btn {
  padding: 12px 40px;
  background-color: #e63946;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 16px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
  min-width: 150px;
}

.save-all-btn:hover:not(:disabled) {
  background-color: #d62839;
}

.save-all-btn:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}

.save-all-btn:active:not(:disabled) {
  transform: scale(0.98);
}
</style>
