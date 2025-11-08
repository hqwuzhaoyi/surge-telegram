// tg_latency_panel.js
// 功能：并发测试所有可用策略的 Telegram 延迟（TTFB），实时更新面板显示
//
// 参数说明：
//   targets - 测试目标 URL，多个用 | 分隔（默认：Telegram 官网图片）
//   per_target_timeout_ms - 每个请求超时时间（默认：5000ms）
//   topk - 显示前 N 名，找到 N 个成功结果后自动停止（默认：5）
//   concurrent - 并发数（默认：5）
//   max_wait_ms - 最大等待时间，超时后停止（默认：60000ms）
//
// 实时更新：每完成一个节点测试，立即更新缓存，面板自动刷新显示进度
//
// 用法示例：
// argument=topk=5; concurrent=5; per_target_timeout_ms=5000
//
// 建议面板配置：
// [Script]
// tg-latency = type=generic,control-api=true,timeout=90,script-path=tg_latency_panel.js,argument=topk=5; concurrent=5
//
// [Panel]
// TG 延迟 = script-name=tg-latency,update-interval=5

// ---------- 基础工具 ----------
const LOG_KEY = "tg_latency_log";
const PANEL_KEY = "tg_latency_panel_cache";

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

// 更新面板缓存（用于实时显示）
function updatePanelCache(content, title) {
  try {
    const data = { content, title, timestamp: Date.now() };
    $persistentStore.write(JSON.stringify(data), PANEL_KEY);
  } catch (e) {
    slog("[Cache] Failed to update panel cache:", String(e));
  }
}

// 读取面板缓存
function readPanelCache() {
  try {
    const raw = $persistentStore.read(PANEL_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    // 缓存 5 分钟内有效
    if (Date.now() - data.timestamp < 5 * 60 * 1000) {
      return data;
    }
  } catch (e) {
    slog("[Cache] Failed to read panel cache:", String(e));
  }
  return null;
}

slog("=== TG Latency Panel Start ===");

// ---------- 解析参数 ----------
const ARGSTR = typeof $argument === "string" ? $argument : "";
slog("[Raw Argument]", ARGSTR);

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

slog("[Parsed Args]", ARG);

const SPLIT = (v) =>
  (v || "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

// 参数与默认值
const TARGETS = SPLIT(ARG.targets).length
  ? SPLIT(ARG.targets)
  : [
      "https://telegram.org/img/t_logo.png",
      "https://core.telegram.org/favicon.ico",
    ];
const TIMEOUT = Math.max(
  1000,
  parseInt(ARG.per_target_timeout_ms || "5000", 10),
);
const TOPK = Math.max(1, parseInt(ARG.topk || "5", 10));
const CONCURRENT = Math.max(1, parseInt(ARG.concurrent || "5", 10));
const MAX_WAIT_MS = Math.max(10000, parseInt(ARG.max_wait_ms || "60000", 10));

slog("[Config] Targets:", TARGETS);
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
      slog("[API] Total policies to test:", allPolicies.length);

      resolve(allPolicies);
    });
  });
}

// ---------- 单次请求（测 TTFB） ----------
function httpGetOnce(policy, url) {
  return new Promise((resolve) => {
    const t0 = Date.now();

    try {
      $httpClient.get(
        {
          url,
          headers: { Range: "bytes=0-0", "User-Agent": "Surge-TG-Test" },
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
              error: errType,
            });
          }

          const status = resp?.status || 0;
          slog(`[${policy}] SUCCESS - ${elapsed}ms [${status}]`);
          resolve({ policy, url, ok: true, ms: elapsed, status });
        },
      );
    } catch (e) {
      slog(`[${policy}] EXCEPTION - ${String(e)}`);
      resolve({
        policy,
        url,
        ok: false,
        ms: 0,
        error: "EXCEPTION",
      });
    }
  });
}

// ---------- 测试单个策略（多个 targets，并发测试，取最优） ----------
async function testPolicy(policy) {
  // 并发测试所有 targets
  const promises = TARGETS.map((url) => httpGetOnce(policy, url));

  // 等待所有测试完成
  const results = await Promise.all(promises);

  // 找到最佳结果（成功且耗时最短）
  let best = { policy, ok: false, ms: Infinity, url: "" };
  for (const r of results) {
    if (r.ok && r.ms < best.ms) {
      best = r;
    }
  }

  // 如果所有都失败，返回第一个失败结果
  if (!best.ok && results.length > 0) {
    best = results[0];
  }

  if (!isFinite(best.ms)) {
    best.ms = NaN;
  }

  return best;
}

// ---------- 格式化显示结果 ----------
function formatDisplay(results, total, completed, stopped) {
  // 排序：可用优先，按耗时升序
  const sorted = [...results].sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? -1 : 1;
    return (a.ms || Infinity) - (b.ms || Infinity);
  });

  const successCount = results.filter((r) => r.ok).length;
  const lines = sorted.slice(0, TOPK).map((r, i) => {
    const ms = isNaN(r.ms) ? "失败" : `${r.ms}ms`;
    const host = r.url ? hostOf(r.url) : "-";
    const status = r.ok ? r.status || "" : r.error || "ERR";
    return `${i + 1}. ${r.policy}  ${ms}  ${host} ${status ? `[${status}]` : ""}`;
  });

  const statusText = stopped
    ? `已找到 ${TOPK} 个可用节点`
    : `测试中 ${completed}/${total}`;

  return {
    title: `TG 延迟 (${successCount}/${completed}) ${statusText}`,
    content: lines.join("\n") || "测试中...",
  };
}

// ---------- 主流程 ----------
(async () => {
  slog("=== Main Start ===");

  // 先检查缓存，如果有有效缓存且不是主动触发，直接返回
  const cached = readPanelCache();
  if (cached) {
    slog("[Cache] Found valid cache, returning cached result");
    return $done({
      title: cached.title,
      content: cached.content,
      icon: "paperplane.fill",
      "icon-color": "#37AEE2",
    });
  }

  // 获取所有策略
  const policies = await getAllPolicies();

  if (!policies.length) {
    return $done({
      title: "TG 延迟测速（TTFB）",
      content: "未找到任何可用策略，请检查 Surge 配置",
      icon: "paperplane.fill",
      "icon-color": "#FF9500",
    });
  }

  slog(`Testing ${policies.length} policies with concurrency ${CONCURRENT}...`);

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

        const successCount = results.filter((r) => r.ok).length;
        slog(
          `[Worker${workerId}] [${p}] Completed: ${result.ok ? result.ms + "ms" : "FAILED"} (${successCount}/${TOPK} successful)`,
        );

        // 实时更新面板缓存
        const display = formatDisplay(results, policies.length, completed, stopped);
        updatePanelCache(display.content, display.title);
        slog(`[Panel] Updated cache: ${display.title}`);

        // 检查是否已收集到足够的成功结果
        if (successCount >= TOPK) {
          slog(`[Worker${workerId}] Found ${successCount} successful results (target: ${TOPK}), stopping...`);
          stopped = true;
        }
      } catch (e) {
        slog(`[Worker${workerId}] [${p}] Exception:`, String(e));
        results.push({ policy: p, ok: false, ms: NaN, error: String(e) });
        completed++;

        // 即使失败也更新面板
        const display = formatDisplay(results, policies.length, completed, stopped);
        updatePanelCache(display.content, display.title);
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
    slog(`[Main] Stopped due to timeout. Tested ${completed}/${policies.length} policies, ${successCount} successful.`);
  } else if (stopped) {
    slog(`[Main] Early stop: found ${successCount} successful results. Tested ${completed}/${policies.length} policies.`);
  } else {
    slog(`[Main] All ${policies.length} policies tested. ${successCount} successful.`);
  }

  // 最终排序
  results.sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? -1 : 1;
    return (a.ms || Infinity) - (b.ms || Infinity);
  });

  slog(`[Final] Total results: ${results.length}, showing top ${TOPK}`);

  // 构建最终输出
  const lines = results.slice(0, TOPK).map((r, i) => {
    const ms = isNaN(r.ms) ? "失败" : `${r.ms}ms`;
    const host = r.url ? hostOf(r.url) : "-";
    const status = r.ok ? r.status || "" : r.error || "ERR";
    return `${i + 1}. ${r.policy}  ${ms}  ${host} ${status ? `[${status}]` : ""}`;
  });

  slog("=== Main Complete ===");
  slog("[Output]", lines.join(" | "));

  const finalTitle = `TG 延迟测速 (${successCount}/${completed})`;
  const finalContent = lines.join("\n") || "无结果，请检查 targets/节点可用性";

  // 更新最终结果到缓存
  updatePanelCache(finalContent, finalTitle);

  $done({
    title: finalTitle,
    content: finalContent,
    icon: "paperplane.fill",
    "icon-color": "#37AEE2",
  });
})().catch((e) => {
  slog("Fatal error:", String(e.stack || e));
  $done({
    title: "TG 延迟测速（异常）",
    content: String((e && e.stack) || e),
    icon: "exclamationmark.triangle.fill",
    "icon-color": "#FF9500",
  });
});
