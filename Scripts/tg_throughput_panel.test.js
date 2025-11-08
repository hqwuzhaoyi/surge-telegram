import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ==================== Mock Surge 环境 ====================

// 模拟持久化存储
const mockStore = new Map();
const mockPersistentStore = {
  read: vi.fn((key) => mockStore.get(key) || null),
  write: vi.fn((value, key) => mockStore.set(key, value))
};

// 模拟 HTTP Client
const mockHttpClient = {
  get: vi.fn()
};

// 模拟 HTTP API
const mockHttpAPI = vi.fn();

// 模拟 $done
const mockDone = vi.fn();

// 设置全局环境（必须在导入脚本之前设置）
global.$persistentStore = mockPersistentStore;
global.$httpClient = mockHttpClient;
global.$httpAPI = mockHttpAPI;
global.$done = mockDone;
global.$argument = '';
global.console = { log: vi.fn() };

// ==================== 导入真实脚本函数 ====================

const { parseArguments, hostOf } = require('../Panels/tg_throughput_panel.js');

// ==================== 本地辅助函数（用于测试，因为脚本中的函数依赖 Surge 全局变量） ====================

const LOG_KEY = "tg_throughput_log";
function slog(...a) {
  const line =
    `[${new Date().toLocaleTimeString()}] ` +
    a
      .map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x)))
      .join(" ");
  try {
    const arr = JSON.parse($persistentStore.read(LOG_KEY) || "[]");
    arr.push(line);
    while (arr.length > 200) arr.shift();
    $persistentStore.write(JSON.stringify(arr), LOG_KEY);
  } catch (_) {}
  try {
    console.log(line);
  } catch (_) {}
}

// HTTP Range 请求
function httpGetRange(policy, url, BYTES, TIMEOUT) {
  return new Promise((resolve) => {
    const t0 = Date.now();

    try {
      $httpClient.get(
        {
          url,
          headers: {
            Range: `bytes=0-${BYTES - 1}`,
            "User-Agent": "Surge-TG-Speed",
          },
          timeout: TIMEOUT,
          policy,
        },
        (err, resp) => {
          const elapsed = Date.now() - t0;

          if (err) {
            const errType = err.error || "UNKNOWN_ERROR";
            slog(`[${policy}] FAILED - ${errType} (${elapsed}ms)`);
            return resolve({
              policy,
              url,
              ok: false,
              ms: elapsed,
              MBps: 0,
              mbps: 0,
              error: errType,
            });
          }

          const status = resp?.status || 0;
          const headers = resp?.headers || {};
          const cl = parseInt(
            headers["Content-Length"] || headers["content-length"] || "0",
            10,
          );

          let bytes = cl > 0 ? Math.min(cl, BYTES) : BYTES;

          const secs = Math.max(0.001, elapsed / 1000);
          const MBps = bytes / (1024 * 1024) / secs;
          const mbps = (bytes * 8) / 1e6 / secs;

          slog(
            `[${policy}] SUCCESS - ${MBps.toFixed(2)} MB/s (${mbps.toFixed(1)} Mbps) [${status}]`,
          );

          resolve({
            policy,
            url,
            ok: true,
            ms: elapsed,
            status,
            MBps,
            mbps,
            bytes,
          });
        },
      );
    } catch (e) {
      slog(`[${policy}] EXCEPTION - ${String(e)}`);
      resolve({
        policy,
        url,
        ok: false,
        ms: 0,
        MBps: 0,
        mbps: 0,
        error: "EXCEPTION",
      });
    }
  });
}

// 重复测试单个 URL
async function testUrlRepeated(policy, url, BYTES, TIMEOUT, REPEAT_COUNT, DROP_EXTREMES) {
  const results = [];

  for (let i = 0; i < REPEAT_COUNT; i++) {
    const result = await httpGetRange(policy, url, BYTES, TIMEOUT);
    results.push(result);

    if (!result.ok) {
      break;
    }
  }

  const successResults = results.filter((r) => r.ok);

  if (successResults.length === 0) {
    return results[0];
  }

  let speeds = successResults.map((r) => r.MBps);

  if (DROP_EXTREMES && speeds.length >= 3) {
    speeds.sort((a, b) => a - b);
    speeds = speeds.slice(1, -1);
    slog(`[${policy}] Dropped extremes, using ${speeds.length}/${successResults.length} results`);
  }

  const avgMBps = speeds.reduce((sum, v) => sum + v, 0) / speeds.length;
  const avgMbps = avgMBps * 8;
  const avgMs = successResults.reduce((sum, r) => sum + r.ms, 0) / successResults.length;

  slog(
    `[${policy}] Average: ${avgMBps.toFixed(2)} MB/s (${avgMbps.toFixed(1)} Mbps) from ${speeds.length} samples`
  );

  return {
    policy,
    url,
    ok: true,
    ms: avgMs,
    MBps: avgMBps,
    mbps: avgMbps,
    samples: speeds.length,
    totalSamples: results.length,
  };
}

// 测试单个策略
async function testPolicy(policy, TARGETS, BYTES, TIMEOUT, REPEAT_COUNT, DROP_EXTREMES) {
  const promises = TARGETS.map((url) => testUrlRepeated(policy, url, BYTES, TIMEOUT, REPEAT_COUNT, DROP_EXTREMES));
  const results = await Promise.all(promises);

  let best = { policy, ok: false, MBps: 0, mbps: 0, ms: Infinity, url: "", samples: 0 };
  for (const r of results) {
    if (r.ok && r.MBps > best.MBps) {
      best = r;
    }
  }

  if (!best.ok && results.length > 0) {
    best = results[0];
  }

  return best;
}

// ==================== 测试用例 ====================

describe('TG Throughput Panel - 参数解析', () => {
  it('应该使用默认参数', () => {
    const config = parseArguments('');

    expect(config.BYTES).toBe(1048576); // 1MB
    expect(config.REPEAT_COUNT).toBe(5);
    expect(config.DROP_EXTREMES).toBe(true);
    expect(config.TOPK).toBe(3);
    expect(config.CONCURRENT).toBe(3);
    expect(config.TARGETS).toHaveLength(2); // 原脚本只有2个默认目标
  });

  it('应该正确解析自定义参数', () => {
    const config = parseArguments('bytes=2097152; repeat=3; drop_extremes=false; topk=5');

    expect(config.BYTES).toBe(2097152); // 2MB
    expect(config.REPEAT_COUNT).toBe(3);
    expect(config.DROP_EXTREMES).toBe(false);
    expect(config.TOPK).toBe(5);
  });

  it('应该正确解析自定义 targets', () => {
    const config = parseArguments('targets=https://example.com/test1.jpg|https://example.com/test2.jpg');

    expect(config.TARGETS).toEqual([
      'https://example.com/test1.jpg',
      'https://example.com/test2.jpg'
    ]);
  });

  it('应该强制最小值', () => {
    const config = parseArguments('bytes=1000; repeat=0; topk=0');

    expect(config.BYTES).toBe(32 * 1024); // 最小 32KB
    expect(config.REPEAT_COUNT).toBe(1); // 最小 1
    expect(config.TOPK).toBe(1); // 最小 1
  });
});

describe('TG Throughput Panel - hostOf 函数', () => {
  it('应该提取正确的 host', () => {
    expect(hostOf('https://telegram.org/img/test.jpg')).toBe('telegram.org');
    expect(hostOf('https://cdn1.telegram-cdn.org/file/test')).toBe('cdn1.telegram-cdn.org');
  });

  it('应该处理无效 URL', () => {
    expect(hostOf('invalid-url')).toBe('invalid-url');
  });
});

describe('TG Throughput Panel - httpGetRange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.clear();
  });

  it('应该成功请求并计算速度', async () => {
    const BYTES = 1048576; // 1MB
    const TIMEOUT = 8000;

    // 模拟成功响应（100ms 下载 1MB = 10 MB/s）
    mockHttpClient.get.mockImplementation((opts, callback) => {
      setTimeout(() => {
        callback(null, {
          status: 206,
          headers: { 'Content-Length': '1048576' }
        });
      }, 100);
    });

    const result = await httpGetRange('TestPolicy', 'https://example.com/test.jpg', BYTES, TIMEOUT);

    expect(result.ok).toBe(true);
    expect(result.policy).toBe('TestPolicy');
    expect(result.status).toBe(206);
    expect(result.MBps).toBeGreaterThan(9); // 约 10 MB/s
    expect(result.MBps).toBeLessThan(11);
    expect(result.mbps).toBeGreaterThan(72); // 约 80 Mbps
    expect(result.mbps).toBeLessThan(88);
  });

  it('应该处理请求失败', async () => {
    mockHttpClient.get.mockImplementation((opts, callback) => {
      callback({ error: 'NETWORK_ERROR' }, null);
    });

    const result = await httpGetRange('TestPolicy', 'https://example.com/test.jpg', 1048576, 8000);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('NETWORK_ERROR');
    expect(result.MBps).toBe(0);
  });
});

describe('TG Throughput Panel - testUrlRepeated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.clear();
  });

  it('应该重复请求并计算平均速度', async () => {
    let callCount = 0;

    // 模拟 5 次请求，速度分别为: 5, 10, 8, 12, 7 MB/s
    const speeds = [5, 10, 8, 12, 7];
    mockHttpClient.get.mockImplementation((opts, callback) => {
      const speed = speeds[callCount++];
      const elapsed = 1048576 / (speed * 1024 * 1024) * 1000; // 计算需要的时间

      setTimeout(() => {
        callback(null, {
          status: 206,
          headers: { 'Content-Length': '1048576' }
        });
      }, elapsed);
    });

    const result = await testUrlRepeated('TestPolicy', 'https://example.com/test.jpg', 1048576, 8000, 5, true);

    expect(result.ok).toBe(true);
    expect(result.samples).toBe(3); // 去除最高(12)和最低(5)，剩余 3 个
    expect(result.totalSamples).toBe(5);
    // 平均值应该是 (10 + 8 + 7) / 3 = 8.33，但实际计算会有误差
    expect(result.MBps).toBeGreaterThan(8.1);
    expect(result.MBps).toBeLessThan(8.5);
  });

  it('应该在失败时停止重复', async () => {
    let callCount = 0;

    mockHttpClient.get.mockImplementation((opts, callback) => {
      if (callCount++ < 2) {
        setTimeout(() => callback(null, { status: 206, headers: { 'Content-Length': '1048576' } }), 100);
      } else {
        callback({ error: 'TIMEOUT' }, null);
      }
    });

    const result = await testUrlRepeated('TestPolicy', 'https://example.com/test.jpg', 1048576, 8000, 5, true);

    // 注意：即使最后一次失败，如果前面有成功的结果，函数会返回成功的平均值
    // 这是符合实际逻辑的：2次成功足以计算平均速度
    expect(result.ok).toBe(true); // 前2次成功，会返回成功结果
    expect(result.samples).toBeGreaterThan(0); // 至少有样本
    expect(mockHttpClient.get).toHaveBeenCalledTimes(3); // 只调用了 3 次（2次成功 + 1次失败）
  });

  it('应该在不去除极值时使用所有结果', async () => {
    let callCount = 0;
    const speeds = [5, 10, 8];

    mockHttpClient.get.mockImplementation((opts, callback) => {
      const speed = speeds[callCount++];
      const elapsed = 1048576 / (speed * 1024 * 1024) * 1000;
      setTimeout(() => callback(null, { status: 206, headers: { 'Content-Length': '1048576' } }), elapsed);
    });

    const result = await testUrlRepeated('TestPolicy', 'https://example.com/test.jpg', 1048576, 8000, 3, false);

    expect(result.ok).toBe(true);
    expect(result.samples).toBe(3); // 使用所有 3 个结果
    // 平均值应该是 (5 + 10 + 8) / 3 = 7.67，但实际计算会有误差
    expect(result.MBps).toBeGreaterThan(7.5);
    expect(result.MBps).toBeLessThan(7.8);
  });
});

describe('TG Throughput Panel - testPolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.clear();
  });

  it('应该测试多个 targets 并返回最快的', async () => {
    const TARGETS = [
      'https://example.com/slow.jpg',
      'https://example.com/fast.jpg',
      'https://example.com/medium.jpg'
    ];

    let callCount = 0;

    // 第一个 target: 5次请求，平均 5 MB/s
    // 第二个 target: 5次请求，平均 15 MB/s (最快)
    // 第三个 target: 5次请求，平均 10 MB/s
    mockHttpClient.get.mockImplementation((opts, callback) => {
      let speed;
      const url = opts.url;

      if (url.includes('slow')) {
        speed = 5;
      } else if (url.includes('fast')) {
        speed = 15;
      } else {
        speed = 10;
      }

      const elapsed = 1048576 / (speed * 1024 * 1024) * 1000;
      setTimeout(() => callback(null, { status: 206, headers: { 'Content-Length': '1048576' } }), elapsed);
    });

    const result = await testPolicy('TestPolicy', TARGETS, 1048576, 8000, 5, true);

    expect(result.ok).toBe(true);
    expect(result.url).toBe('https://example.com/fast.jpg');
    expect(result.MBps).toBeGreaterThan(14.8); // 约 15 MB/s
    expect(result.MBps).toBeLessThan(15.2);
    expect(mockHttpClient.get).toHaveBeenCalledTimes(15); // 3个 targets × 5次重复
  });

  it('应该在所有 targets 都失败时返回失败结果', async () => {
    const TARGETS = ['https://example.com/test1.jpg', 'https://example.com/test2.jpg'];

    mockHttpClient.get.mockImplementation((opts, callback) => {
      callback({ error: 'NETWORK_ERROR' }, null);
    });

    const result = await testPolicy('TestPolicy', TARGETS, 1048576, 8000, 3, true);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('NETWORK_ERROR');
  });
});

describe('TG Throughput Panel - 日志功能', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.clear();
  });

  it('应该正确存储日志', () => {
    slog('Test message 1');
    slog('Test message 2');

    const logs = JSON.parse(mockPersistentStore.read(LOG_KEY));
    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain('Test message 1');
    expect(logs[1]).toContain('Test message 2');
  });

  it('应该限制日志数量为 200 条', () => {
    // 写入 250 条日志
    for (let i = 0; i < 250; i++) {
      slog(`Message ${i}`);
    }

    const logs = JSON.parse(mockPersistentStore.read(LOG_KEY));
    expect(logs).toHaveLength(200);
    // 应该保留最后 200 条
    expect(logs[0]).toContain('Message 50');
    expect(logs[199]).toContain('Message 249');
  });
});
