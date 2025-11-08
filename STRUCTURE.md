# 仓库结构说明

本仓库采用标准 Surge 插件目录结构，参考了社区优秀项目（SurgeToolkit, NobyDa/Script 等）。

## 📁 目录结构

```
surge-telegram/
├── Modules/                         # Surge 模块配置
│   └── Telegram-Speed-Dual.sgmodule # 完整模块（延迟+吞吐）
│
├── Panels/                          # 面板脚本
│   ├── tg_latency_panel.js         # 延迟测速主脚本
│   ├── tg_debug_panel.js           # 延迟测速日志面板
│   ├── tg_throughput_panel.js      # 吞吐测速主脚本
│   └── tg_throughput_debug_panel.js # 吞吐测速日志面板
│
├── Scripts/                         # 开发和测试
│   ├── package.json                # npm 依赖配置
│   ├── pnpm-lock.yaml              # 依赖锁定文件
│   ├── vitest.config.js            # 测试框架配置
│   └── tg_throughput_panel.test.js # 单元测试
│
├── .gitignore                       # Git 忽略规则
└── README.md                        # 项目文档
```

## 📦 安装方式

### 方法一：使用模块（推荐）

```
https://raw.githubusercontent.com/YOUR_USERNAME/surge-telegram/main/Modules/Telegram-Speed-Dual.sgmodule
```

### 方法二：直接引用脚本

```ini
[Script]
tg-latency = type=generic,control-api=true,timeout=90,script-path=https://raw.githubusercontent.com/YOUR_USERNAME/surge-telegram/main/Panels/tg_latency_panel.js,argument=topk=5; concurrent=5
```

## 🏗️ 设计原则

1. **分离关注点**
   - Modules：模块配置文件
   - Panels：用户直接使用的面板脚本
   - Scripts：开发者工具和测试

2. **遵循社区规范**
   - 参考 SurgeToolkit 的清晰分类
   - 参考 NobyDa/Script 的模块组织
   - 使用标准的 .sgmodule 格式

3. **易于维护**
   - 每个脚本单一职责
   - 测试文件独立存放
   - 依赖管理清晰

## 🔄 与其他项目对比

| 项目 | 结构特点 | 本项目采用 |
|------|----------|------------|
| SurgeToolkit | Modules/ Panels/ Rules/ Scripts/ | ✅ 分类清晰 |
| yichahucha/surge | 扁平化，所有文件在根目录 | ❌ 不够清晰 |
| NobyDa/Script | 按工具分类（Surge/ QuantumultX/） | ⚠️ 简化版 |
| Tartarus2014 | 模块化 .sgmodule 文件 | ✅ 模块组织 |

## 📝 文件命名规范

- **模块文件**：`功能名称.sgmodule`
- **面板脚本**：`tg_功能_panel.js`
- **日志脚本**：`tg_功能_debug_panel.js`
- **测试文件**：`文件名.test.js`

## 🚀 未来扩展

如需添加新功能：

1. **新增面板脚本** → 放入 `Panels/`
2. **更新模块配置** → 修改 `Modules/Telegram-Speed-Dual.sgmodule`
3. **添加测试** → 放入 `Scripts/`
4. **更新文档** → 修改 `README.md`
