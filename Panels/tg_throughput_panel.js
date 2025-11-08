// tg_throughput_panel.js
// 功能：并发测试所有可用策略的 Telegram 吞吐速度，智能提前停止，在面板排序显示
//
// 参数说明：
//   targets - 测试目标 URL，多个用 | 分隔（默认：Telegram 官网图片）
//   bytes - 下载字节数（默认：1048576 = 1MB）
//   per_target_timeout_ms - 每个请求超时时间（默认：8000ms）
//   repeat - 每个 target 重复请求次数（默认：5）
//   drop_extremes - 是否去除最高最低值（默认：true）
//   topk - 显示前 N 名，找到 N 个成功结果后自动停止（默认：3）
//   concurrent - 并发数（默认：3）
//   max_wait_ms - 最大等待时间，超时后停止（默认：60000ms）
//
// 智能停止：找到 topk 个成功节点后立即停止，无需等待所有节点测试完成
// 重复请求：对每个 target 重复请求多次，去除异常值后计算平均速度
//
// 用法示例：
// argument=topk=3; concurrent=3; bytes=1048576; repeat=5; drop_extremes=true
//
// 建议面板配置：
// [Script]
// tg-speed = type=generic,control-api=true,timeout=120,script-path=tg_throughput_panel.js,argument=topk=3; concurrent=3; bytes=1048576; repeat=5
//
// [Panel]
// TG 速度 = script-name=tg-speed,update-interval=600

// ---------- 基础工具 ----------
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

slog("=== TG Throughput Panel Start ===");

// ---------- 解析参数 ----------
const ARGSTR = typeof $argument === "string" ? $argument : "";
const ARG = Object.fromEntries(
  ARGSTR.split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((kv) => {
      const i = kv.indexOf("=");
      return i > 0
        ? [kv.slice(0, i).trim(), kv.slice(i + 1).trim()]
        : [kv.trim(), ""];
    }),
);

const SPLIT = (v) =>
  (v || "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

// 参数与默认值
// 默认使用公开的大文件资源测速（通过 Range 下载指定大小）
// 这些是稳定的公开资源，可以用来测试到 CDN 的速度
const TARGETS = SPLIT(ARG.targets).length
  ? SPLIT(ARG.targets)
  : [
      "https://telegram.org/img/SiteAndroid.jpg",
      "https://telegram.org/img/SiteiOs.jpg",
    ];
const BYTES = Math.max(32 * 1024, parseInt(ARG.bytes || "1048576", 10)); // 默认 1MB
const TIMEOUT = Math.max(
  2000,
  parseInt(ARG.per_target_timeout_ms || "8000", 10),
);
const REPEAT_COUNT = Math.max(1, parseInt(ARG.repeat || "5", 10)); // 默认重复 5 次
const DROP_EXTREMES = ARG.drop_extremes !== "false"; // 默认去除极值
const TOPK = Math.max(1, parseInt(ARG.topk || "3", 10));
const CONCURRENT = Math.max(1, parseInt(ARG.concurrent || "3", 10));
const MAX_WAIT_MS = Math.max(10000, parseInt(ARG.max_wait_ms || "60000", 10));

slog("[Config] Targets:", TARGETS);
slog("[Config] Bytes per request:", (BYTES / 1024 / 1024).toFixed(2) + "MB");
slog("[Config] Repeat count:", REPEAT_COUNT);
slog("[Config] Drop extremes:", DROP_EXTREMES);
slog(
  "[Config] Total per target:",
  ((BYTES * REPEAT_COUNT) / 1024 / 1024).toFixed(2) + "MB",
);
slog("[Config] Timeout:", TIMEOUT + "ms");
slog("[Config] TopK:", TOPK);
slog("[Config] Concurrent:", CONCURRENT);
slog("[Config] Max Wait:", MAX_WAIT_MS + "ms");

function hostOf(u) {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}

// ---------- 获取所有可用策略 ----------
async function getAllPolicies() {
  return await new Promise((resolve) => {
    $httpAPI("GET", "/v1/policies", null, (res) => {
      slog(
        "[API] /v1/policies response:",
        JSON.stringify(res).substring(0, 300),
      );

      const proxies = res?.proxies || [];
      const policyGroups = res?.["policy-groups"] || [];
      const allPolicies = [...policyGroups, ...proxies];

      slog(
        "[API] Found",
        proxies.length,
        "proxies and",
        policyGroups.length,
        "policy groups",
      );
      slog("[API] Total policies:", allPolicies.length);

      resolve(allPolicies);
    });
  });
}

// ---------- 单次下载测速 ----------
function httpGetRange(policy, url) {
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

          // 实际下载的字节数
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

// ---------- 重复测试单个 URL，计算平均速度 ----------
async function testUrlRepeated(policy, url) {
  const results = [];

  // 重复请求 REPEAT_COUNT 次
  for (let i = 0; i < REPEAT_COUNT; i++) {
    const result = await httpGetRange(policy, url);
    results.push(result);

    // 如果请求失败，不继续重复
    if (!result.ok) {
      break;
    }
  }

  // 统计成功的请求
  const successResults = results.filter((r) => r.ok);

  if (successResults.length === 0) {
    // 全部失败，返回第一个失败结果
    return results[0];
  }

  // 提取速度数组
  let speeds = successResults.map((r) => r.MBps);

  // 如果启用去除极值，且有足够的数据点
  if (DROP_EXTREMES && speeds.length >= 3) {
    speeds.sort((a, b) => a - b);
    // 去除最高和最低值
    speeds = speeds.slice(1, -1);
    slog(
      `[${policy}] Dropped extremes, using ${speeds.length}/${successResults.length} results`,
    );
  }

  // 计算平均速度
  const avgMBps = speeds.reduce((sum, v) => sum + v, 0) / speeds.length;
  const avgMbps = avgMBps * 8;
  const avgMs =
    successResults.reduce((sum, r) => sum + r.ms, 0) / successResults.length;

  slog(
    `[${policy}] Average: ${avgMBps.toFixed(2)} MB/s (${avgMbps.toFixed(1)} Mbps) from ${speeds.length} samples`,
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

// ---------- 测试单个策略（多个 targets，并发测试，取最优） ----------
async function testPolicy(policy) {
  // 并发测试所有 targets（每个 target 会重复请求）
  const promises = TARGETS.map((url) => testUrlRepeated(policy, url));

  // 等待所有测试完成
  const results = await Promise.all(promises);

  // 找到最佳结果（成功且速度最快）
  let best = {
    policy,
    ok: false,
    MBps: 0,
    mbps: 0,
    ms: Infinity,
    url: "",
    samples: 0,
  };
  for (const r of results) {
    if (r.ok && r.MBps > best.MBps) {
      best = r;
    }
  }

  // 如果所有都失败，返回第一个失败结果
  if (!best.ok && results.length > 0) {
    best = results[0];
  }

  return best;
}

// ---------- 主流程 ----------
(async () => {
  slog("=== Main Start ===");

  // 获取所有策略
  const policies = await getAllPolicies();

  if (!policies.length) {
    return $done({
      title: "TG 吞吐测速",
      content: "未找到任何可用策略，请检查 Surge 配置",
      icon: "speedometer",
      "icon-color": "#FF9500",
    });
  }

  slog(`Testing ${policies.length} policies with concurrency ${CONCURRENT}...`);
  slog(
    `Data usage: ~${((policies.length * TARGETS.length * BYTES * REPEAT_COUNT) / 1024 / 1024).toFixed(2)}MB (max)`,
  );

  // 并发测试所有策略
  const results = [];
  let completed = 0;
  let stopped = false;
  const queue = [...policies];

  // 工作池
  const workers = new Array(CONCURRENT).fill(null).map(async (_, workerId) => {
    while (queue.length > 0 && !stopped) {
      const p = queue.shift();
      if (!p) break;

      const index = policies.indexOf(p) + 1;
      slog(`[Worker${workerId}] [${index}/${policies.length}] Testing: ${p}`);

      try {
        const result = await testPolicy(p);
        results.push(result);
        completed++;
        slog(
          `[Worker${workerId}] [${p}] Completed: ${result.ok ? result.MBps.toFixed(2) + " MB/s" : "FAILED"}`,
        );

        // 检查是否已收集到足够的成功结果
        const successCount = results.filter((r) => r.ok).length;
        if (successCount >= TOPK) {
          slog(
            `[Worker${workerId}] Found ${successCount} successful results, stopping...`,
          );
          stopped = true;
        }
      } catch (e) {
        slog(`[Worker${workerId}] [${p}] Exception:`, String(e));
        results.push({
          policy: p,
          ok: false,
          MBps: 0,
          mbps: 0,
          ms: NaN,
          error: String(e),
        });
        completed++;
      }
    }
    slog(`[Worker${workerId}] Finished`);
  });

  // 创建超时 Promise
  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => {
      slog(`[Timeout] Max wait time ${MAX_WAIT_MS}ms reached, stopping...`);
      stopped = true;
      resolve("timeout");
    }, MAX_WAIT_MS);
  });

  // 等待所有工作完成 或 超时
  const raceResult = await Promise.race([
    Promise.all(workers).then(() => "completed"),
    timeoutPromise,
  ]);

  const successCount = results.filter((r) => r.ok).length;
  if (raceResult === "timeout") {
    slog(
      `[Main] Stopped due to timeout. Tested ${completed}/${policies.length} policies, ${successCount} successful.`,
    );
  } else if (stopped) {
    slog(
      `[Main] Early stop: found ${successCount} successful results. Tested ${completed}/${policies.length} policies.`,
    );
  } else {
    slog(
      `[Main] All ${policies.length} policies tested. ${successCount} successful.`,
    );
  }

  // 最终排序：可用优先，按速度降序
  results.sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? -1 : 1;
    return b.MBps - a.MBps;
  });

  // 构建最终输出
  const lines = results.slice(0, TOPK).map((r, i) => {
    if (!r.ok) {
      const err = r.error || "ERR";
      return `${i + 1}. ${r.policy}  失败 [${err}]`;
    }
    const host = r.url ? hostOf(r.url) : "-";
    const rate = `${r.MBps.toFixed(2)} MB/s (${r.mbps.toFixed(1)} Mbps)`;
    const sampleInfo = r.samples ? ` [${r.samples}×]` : "";
    return `${i + 1}. ${r.policy}  ${rate}${sampleInfo}`;
  });

  slog("=== Main Complete ===");

  $done({
    title: `TG 吞吐测速（${(BYTES / 1024 / 1024).toFixed(1)}MB×${REPEAT_COUNT}）`,
    content: lines.join("\n") || "无结果，请检查 targets/节点可用性",
    icon: "speedometer",
    "icon-color": "#FF9F0A",
  });
})().catch((e) => {
  slog("Fatal error:", String(e.stack || e));
  $done({
    title: "TG 吞吐测速（异常）",
    content: String((e && e.stack) || e),
    icon: "exclamationmark.triangle.fill",
    "icon-color": "#FF9500",
  });
});
