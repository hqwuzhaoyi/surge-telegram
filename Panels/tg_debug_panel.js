// tg_debug_panel.js
// 用于查看 tg_latency_panel.js 的调试日志

const LOG_KEY = "tg_latency_log";
let arr = [];
try {
  arr = JSON.parse($persistentStore.read(LOG_KEY) || "[]");
} catch (_) {}

$done({
  title: "TG 延迟日志",
  content: arr.slice(-30).join("\n") || "暂无日志",
  icon: "text.justify",
  "icon-color": "#999",
});
