const LOG_KEY = "tg_debug_log";
let arr = [];
try {
  arr = JSON.parse($persistentStore.read(LOG_KEY) || "[]");
} catch (_) {}
$done({
  title: "TG 调试日志",
  content: arr.slice(-20).join("\n") || "暂无日志",
  icon: "text.justify",
  "icon-color": "#999",
});
