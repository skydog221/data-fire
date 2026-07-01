# Config Helper

Scratch Extension 配置存储 SDK

### 介绍

这个 SDK 提供了一套类似 localStorage 的键值对(KV)**存储**接口
通常用于储存特定配置信息，比如 APIKEY，BASEURL 等

1. 支持将 KV 以舞台注释的形式**持久化**保存到 Scratch工程 中

2. 支持多人协作的实时配置共享

### 使用方法

```JavaScript
// 初始化存储实例
const storage = new ScratchConfigStorage(runtime, 'witCat.dollyPro', '多莉Pro');

// 创建/更新配置项
storage.setItem('hideExtraBlocks', true);
storage.setItem('version', '1.0.0');
storage.setItem('userPreferences', { theme: 'dark', language: 'zh-cn' });

// 读取配置项
const hideBlocks = storage.getItem('hideExtraBlocks', false);
const version = storage.getItem('version', '0.0.0');
const prefs = storage.getItem('userPreferences', {});

// 检查配置项是否存在
if (storage.hasItem('hideExtraBlocks')) {
  // ...
}

// 删除配置项
storage.removeItem('version');

// 获取所有键名
const allKeys = storage.keys();

// 清空所有配置
storage.clear();

```

### 鸣谢

基于舞台注释的信息储存方法 [@Arkos](https://github.com/Arkos123) [@DollyProTeam](https://github.com/Gandi-IDE/custom-extension/tree/main/extensions/DollyPro)

将相关方法打包为 Class [@skydog221](https://github.com/skydog221)
