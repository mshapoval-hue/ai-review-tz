let selectedFile = null;

const $ = (id) => document.getElementById(id);

const dropzone = $("dropzone");
const fileInput = $("file-input");
const startBtn = $("start-review");

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
  if (!file) {
    resetAll();
    return;
  }

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

function buildDemoReport() {
  return `# AI-ревью ТЗ

Итог: ЕСТЬ ЗАМЕЧАНИЯ
Блокеры: 0
Существенные: 4
Рекомендации: 3

## Что исправить

1. Цели и критерии успеха
Для части целей не заданы проверяемые критерии достижения.
Что сделать: зафиксировать измеримые критерии или способ их согласования.

2. Качество распознавания документов
Не определен критерий, по которому качество распознавания считается недостаточным.
Что сделать: определить метрику и порог качества.

## Рекомендации

1. Разделить составные требования на атомарные там, где это упростит приемку.

ДЕМО-РЕЖИМ: этот отчет сформирован интерфейсом, а не MWS-ботом.`;
}

async function runDemo() {
  if (!selectedFile) return;

  $("upload-card").classList.add("hidden");
  $("progress-card").classList.remove("hidden");
  $("progress-file-name").textContent = selectedFile.name;

  const delays = [650, 900, 1200, 1000, 800];
  for (let i = 0; i < 5; i++) {
    setStep(i);
    await new Promise(resolve => setTimeout(resolve, delays[i]));
  }

  document.querySelectorAll(".step").forEach(step => {
    step.classList.remove("active");
    step.classList.add("done");
  });

  $("progress-card").classList.add("hidden");
  $("result-section").classList.remove("hidden");
  $("result-file-name").textContent = selectedFile.name;
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
startBtn.addEventListener("click", runDemo);

$("download-report").addEventListener("click", () => {
  const blob = new Blob([buildDemoReport()], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stem = (selectedFile?.name || "TZ").replace(/\.docx$/i, "");
  a.href = url;
  a.download = `${stem}_AI-review-demo.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});
