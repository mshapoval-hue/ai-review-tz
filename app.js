let selectedFile = null;

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const fileInput = $("file-input");
const startBtn = $("start-review");

const BRIDGE_URL = "http://127.0.0.1:8766";
const CONFIG_URL = "./config.json";

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function setStatus(text, type = "") {
  const el = $("status-text");
  el.textContent = text;
  el.className = `status-text ${type}`.trim();
}

function acceptFile(file) {
  if (!file) return resetAll();

  if (!file.name.toLowerCase().endsWith(".docx")) {
    selectedFile = null;
    startBtn.disabled = true;
    setStatus("Поддерживается только формат DOCX", "error");
    return;
  }

  selectedFile = file;
  $("file-name").textContent = file.name;
  $("file-meta").textContent = `DOCX · ${formatSize(file.size)}`;
  $("selected-file").classList.remove("hidden");
  $("drop-title").textContent = file.name;
  $("drop-subtitle").textContent = formatSize(file.size);
  dropzone.classList.add("has-file");
  startBtn.disabled = false;
  setStatus("Файл выбран", "success");
}

function setStep(activeIndex) {
  document.querySelectorAll(".step").forEach((step, index) => {
    step.classList.toggle("done", index < activeIndex);
    step.classList.toggle("active", index === activeIndex);
  });
}

function resetAll() {
  selectedFile = null;
  fileInput.value = "";
  startBtn.disabled = true;

  $("selected-file").classList.add("hidden");
  $("progress-card").classList.add("hidden");
  $("result-section").classList.add("hidden");
  $("upload-card").classList.remove("hidden");

  $("drop-title").textContent = "Перетащите ТЗ сюда";
  $("drop-subtitle").textContent = "или нажмите, чтобы выбрать файл";
  dropzone.classList.remove("has-file");
  setStatus("Готово к загрузке");
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать DOCX"));
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.readAsDataURL(file);
  });
}

function renderReport(report, fileName) {
  $("progress-card").classList.add("hidden");
  $("result-section").classList.remove("hidden");
  $("result-file-name").textContent = fileName;

  const reportContainer = document.querySelector(".report");
  reportContainer.innerHTML = "";

  const pre = document.createElement("pre");
  pre.style.whiteSpace = "pre-wrap";
  pre.style.wordBreak = "break-word";
  pre.style.fontFamily = "inherit";
  pre.style.fontSize = "14px";
  pre.style.lineHeight = "1.55";
  pre.textContent = report;
  reportContainer.appendChild(pre);

  const blockerMatch = report.match(/Блокеры:\s*(\d+)/i);
  const majorMatch = report.match(/Существенные:\s*(\d+)/i);
  const minorMatch = report.match(/Рекомендации:\s*(\d+)/i);

  $("blockers-count").textContent = blockerMatch?.[1] ?? "—";
  $("major-count").textContent = majorMatch?.[1] ?? "—";
  $("minor-count").textContent = minorMatch?.[1] ?? "—";
}

async function runReview() {
  if (!selectedFile) return;

  const currentFile = selectedFile;
  $("upload-card").classList.add("hidden");
  $("progress-card").classList.remove("hidden");
  $("progress-file-name").textContent = currentFile.name;
  setStep(0);

  try {
    setStep(1);
    const base64 = await fileToBase64(currentFile);

    setStep(2);
    const response = await fetch(`${BRIDGE_URL}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: currentFile.name,
        fileBase64: base64,
        configUrl: new URL(CONFIG_URL, window.location.href).href
      })
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || `Bridge вернул HTTP ${response.status}`);
    }

    setStep(4);
    renderReport(data.report, currentFile.name);
  } catch (error) {
    $("progress-card").classList.add("hidden");
    $("upload-card").classList.remove("hidden");
    setStatus(
      `Ошибка: ${error.message}. Проверьте, что AI Review Bridge запущен.`,
      "error"
    );
  }
}

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") fileInput.click();
});
dropzone.addEventListener("dragover", (e) => e.preventDefault());
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  acceptFile(e.dataTransfer.files?.[0] || null);
});

fileInput.addEventListener("change", (e) => acceptFile(e.target.files?.[0] || null));
$("clear-file").addEventListener("click", resetAll);
$("new-review").addEventListener("click", resetAll);
startBtn.addEventListener("click", runReview);

$("download-report").addEventListener("click", () => {
  const report = document.querySelector(".report")?.innerText || "";
  const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stem = (selectedFile?.name || "TZ").replace(/\.docx$/i, "");
  a.href = url;
  a.download = `${stem}_AI-review.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

fetch(`${BRIDGE_URL}/health`)
  .then(r => r.json())
  .then(data => {
    if (data.ok) setStatus("AI Review Bridge подключен", "success");
  })
  .catch(() => {
    setStatus("Перед проверкой запустите AI Review Bridge");
  });
