# Telegram 测速面板

Surge 面板脚本，用于测试所有可用节点的 Telegram 性能，包括延迟（TTFB）和吞吐量（MB/s）。

## ✨ 特性

- ✅ **延迟测速**：测试首包响应时间（TTFB），单位毫秒（ms）
- ✅ **吞吐测速**：测试下载速度，单位 MB/s 和 Mbps
- ✅ 并发测试所有可用节点
- ✅ 实时更新面板显示进度
- ✅ 找到 N 个可用节点后自动停止
- ✅ 智能缓存机制，避免重复测试
- ✅ 详细日志记录

## 📦 安装

### 方法一：使用模块（推荐）

在 Surge 中添加模块：

```
https://raw.githubusercontent.com/hqwuzhaoyi/surge-telegram/main/Modules/Telegram-Speed-Dual.sgmodule
```

### 方法二：手动配置

复制以下配置到 Surge 配置文件：

```ini
[Script]
# 延迟测速
tg-latency = type=generic,control-api=true,timeout=90,script-path=https://raw.githubusercontent.com/hqwuzhaoyi/surge-telegram/main/Panels/tg_latency_panel.js,argument=topk=5; concurrent=5; per_target_timeout_ms=5000; max_wait_ms=60000
tg-latency-debug = type=generic,timeout=5,script-path=https://raw.githubusercontent.com/hqwuzhaoyi/surge-telegram/main/Panels/tg_debug_panel.js

# 吞吐测速
tg-throughput = type=generic,control-api=true,timeout=120,script-path=https://raw.githubusercontent.com/hqwuzhaoyi/surge-telegram/main/Panels/tg_throughput_panel.js,argument=topk=3; concurrent=3; bytes=1048576; repeat=5; drop_extremes=true
tg-throughput-debug = type=generic,timeout=5,script-path=https://raw.githubusercontent.com/hqwuzhaoyi/surge-telegram/main/Panels/tg_throughput_debug_panel.js

[Panel]
TG 延迟 = script-name=tg-latency,update-interval=5
TG 吞吐 = script-name=tg-throughput,update-interval=-1
TG 延迟日志 = script-name=tg-latency-debug,update-interval=-1
TG 吞吐日志 = script-name=tg-throughput-debug,update-interval=-1
```

## 📖 使用说明

### 延迟测速

1. **点击"TG 延迟"面板** → 开始测试所有节点
2. **面板每 5 秒自动刷新** → 显示实时测试进度
3. **找到 5 个可用节点后** → 自动停止测试
4. **如有问题** → 点击"TG 延迟日志"查看详细日志

### 吞吐测速

1. **点击"TG 吞吐"面板** → 开始测试所有节点
2. **等待测试完成** → 显示速度结果（MB/s 和 Mbps）
3. **找到 3 个可用节点后** → 自动停止测试
4. **如有问题** → 点击"TG 吞吐日志"查看详细日志

**⚠️ 注意**：吞吐测速会消耗流量，每次测试约 `节点数 × 目标数 × 下载大小 × 重复次数`

## ⚙️ 参数说明

### 延迟测速参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `topk` | 5 | 显示前 N 名，找到 N 个成功节点后停止 |
| `concurrent` | 5 | 并发测试数量（建议 3-10） |
| `per_target_timeout_ms` | 5000 | 单个请求超时时间（毫秒） |
| `max_wait_ms` | 60000 | 最大等待时间（毫秒） |
| `targets` | 默认 | 测试目标 URL，多个用 `\|` 分隔 |

### 吞吐测速参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `topk` | 3 | 显示前 N 名，找到 N 个成功节点后停止 |
| `concurrent` | 3 | 并发测试数量（建议 2-5） |
| `bytes` | 1048576 | 下载字节数（默认 1MB） |
| `repeat` | 5 | 每个目标重复测试次数 |
| `drop_extremes` | true | 是否去除最高最低值 |
| `per_target_timeout_ms` | 8000 | 单个请求超时时间（毫秒） |
| `max_wait_ms` | 60000 | 最大等待时间（毫秒） |
| `targets` | 默认 | 测试目标 URL，多个用 `\|` 分隔 |

## 🎯 参数调优

### 延迟测速

#### 快速测速（节点多时）

```
topk=3; concurrent=10; per_target_timeout_ms=3000; max_wait_ms=30000
```

#### 精确测速（节点少时）

```
topk=5; concurrent=3; per_target_timeout_ms=8000; max_wait_ms=120000
```

### 吞吐测速

#### 快速测速（省流量）

```
topk=3; concurrent=3; bytes=524288; repeat=3; drop_extremes=true
```
- 下载 512KB × 3 次
- 流量消耗小

#### 精确测速（更准确）

```
topk=3; concurrent=2; bytes=2097152; repeat=5; drop_extremes=true
```
- 下载 2MB × 5 次
- 结果更准确，但消耗流量大

## 🔍 工作原理

### 延迟测速原理

1. **TTFB 测试**
   - 使用 HTTP Range 请求只下载第一个字节：`Range: bytes=0-0`
   - 测量从发起请求到收到首包的时间
   - 单位：毫秒（ms）

2. **实时更新**
   - 每完成一个节点测试，立即更新缓存
   - 面板每 5 秒自动刷新，读取最新缓存
   - 测试中可以看到实时进度

3. **智能停止**
   - 找到 N 个可用节点后自动停止
   - 节省时间和流量

### 吞吐测速原理

1. **下载测试**
   - 下载指定大小的数据块：`Range: bytes=0-{BYTES-1}`
   - 计算速度：`速度 (MB/s) = 数据大小 (MB) / 耗时 (秒)`
   - 单位：MB/s 和 Mbps

2. **重复测试**
   - 每个目标重复测试多次（默认 5 次）
   - 去除最高最低值，计算平均速度
   - 提高测试准确性

3. **智能停止**
   - 找到 N 个可用节点后自动停止
   - 避免消耗过多流量

## 📊 两种测速对比

| 特性 | 延迟测速 | 吞吐测速 |
|------|----------|----------|
| **测试目标** | 响应速度 | 下载速度 |
| **单位** | ms（毫秒） | MB/s、Mbps |
| **流量消耗** | 极小（几 KB） | 大（几 MB） |
| **测试时间** | 快（几秒） | 慢（几十秒） |
| **刷新频率** | 5 秒 | 手动 |
| **适用场景** | 日常使用 | 详细测速 |

**建议**：
- 日常使用：只开启延迟测速
- 详细分析：同时开启两个测速

## ❓ 常见问题

### Q: 为什么只显示 1 个节点？

**A:** 检查以下几点：
1. 确认 `topk` 参数是否正确（应该 ≥ 3）
2. 确认 `concurrent` 参数是否正确（应该 ≥ 3）
3. 确认 `timeout` 是否足够（延迟 60-90秒，吞吐 120秒）
4. 查看对应的日志面板，确认是否有错误

### Q: 延迟测速很慢怎么办？

**A:** 增加并发数和减少超时时间：
```
concurrent=10; per_target_timeout_ms=3000; max_wait_ms=30000
```

### Q: 吞吐测速消耗多少流量？

**A:** 流量消耗计算：
```
流量 = 节点数 × 目标数 × 下载大小 × 重复次数
例如：20个节点 × 2个目标 × 1MB × 5次 = 200MB
```

建议：
- 减少 `bytes`：512KB（524288）
- 减少 `repeat`：3 次
- 减少 `topk`：只测前 3 名

### Q: 面板不更新怎么办？

**A:**
1. 延迟测速：面板每 5 秒自动刷新
2. 吞吐测速：手动点击面板刷新（`update-interval=-1`）
3. 查看日志确认测试是否在运行

### Q: 吞吐测速为什么设置为手动刷新？

**A:** 因为：
- 吞吐测速消耗流量大
- 测试时间长（几十秒到几分钟）
- 不适合自动刷新

建议需要时手动点击测试。

## 📁 仓库结构

```
surge-telegram/
├── Modules/                         # Surge 模块
│   └── Telegram-Speed-Dual.sgmodule # 完整模块配置
├── Panels/                          # 面板脚本
│   ├── tg_latency_panel.js         # 延迟测速脚本
│   ├── tg_debug_panel.js           # 延迟测速日志
│   ├── tg_throughput_panel.js      # 吞吐测速脚本
│   └── tg_throughput_debug_panel.js # 吞吐测速日志
├── Scripts/                         # 测试和工具
│   ├── tg_throughput_panel.test.js # 单元测试
│   ├── vitest.config.js            # 测试配置
│   ├── package.json                # 依赖配置
│   └── pnpm-lock.yaml              # 依赖锁定
└── README.md                        # 本文档
```

## 🔧 开发

### 运行测试

```bash
pnpm install
pnpm test
```

### 测试覆盖率

```bash
pnpm test:coverage
```

## 📝 许可

MIT License

## 🙏 致谢

- Surge 开发团队提供强大的脚本功能
- 参考了社区中优秀的 Surge 脚本项目
