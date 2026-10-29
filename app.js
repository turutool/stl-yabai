const fileInput = document.getElementById("fileInput");
const selectButton = document.getElementById("selectButton");
const dropZone = document.getElementById("dropZone");
const fileSummary = document.getElementById("fileSummary");
const fileNameEl = document.getElementById("fileName");
const fileSizeEl = document.getElementById("fileSize");
const loadingSection = document.getElementById("loadingSection");
const resultSection = document.getElementById("resultSection");
const checkAnotherButton = document.getElementById("checkAnotherButton");

selectButton.addEventListener("click", (e) => {
  e.stopPropagation();
  fileInput.click();
});

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

["dragenter", "dragover"].forEach((type) => {
  dropZone.addEventListener(type, (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach((type) => {
  dropZone.addEventListener(type, (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
  });
});

dropZone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files?.[0];
  if (file) handleFile(file);
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) handleFile(file);
});

checkAnotherButton.addEventListener("click", resetApp);

function resetApp() {
  fileInput.value = "";
  fileSummary.classList.add("hidden");
  loadingSection.classList.add("hidden");
  resultSection.classList.add("hidden");
  dropZone.closest(".upload-card").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function handleFile(file) {
  if (!file.name.toLowerCase().endsWith(".stl")) {
    alert("STLファイルを選択してください。");
    return;
  }

  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = formatBytes(file.size);
  fileSummary.classList.remove("hidden");
  resultSection.classList.add("hidden");
  loadingSection.classList.remove("hidden");

  // 描画を更新してから解析開始
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

  try {
    const buffer = await file.arrayBuffer();
    const analysis = StlYabai.analyzeSTL(buffer);
    renderResults(analysis);
    resultSection.classList.remove("hidden");
  } catch (error) {
    console.error(error);
    alert(`STLを解析できませんでした。\n${error.message}`);
  } finally {
    loadingSection.classList.add("hidden");
  }
}


/* ---------- 結果の表示 ----------
 * 解析ロジックは analyzer.js にあります。ここは画面に出すだけです。 */

const LABEL = { ok: "問題なし", warn: "要確認", error: "要修正" };
const MARK = { ok: "✓", warn: "!", error: "×" };
const RANK = { ok: 0, warn: 1, error: 2 };

// どのカードに、どの指摘を表示するか
const CARDS = {
  size: "sizeCheck",
  water: "watertightCheck",
  degenerate: "degenerateCheck",
  orientation: "orientationCheck",
  shell: "shellCheck"
};

function renderResults(data) {
  const s = data.stats;
  setText("triangleCount", s.triangles.toLocaleString());
  setText("vertexCount", s.vertices.toLocaleString());
  setText("dimensions", s.size.map((v) => formatNumber(v)).join(" × ") + " mm");
  setText("volume", `${formatNumber(Math.abs(s.volume))} mm³`);

  setText("minDimension", `${formatNumber(Math.min(...s.size))} mm`);
  setText("volumeCheck", `${formatNumber(s.volume)} mm³`);
  setText("boundaryEdges", s.boundary.toLocaleString());
  setText("nonManifoldEdges", s.nonManifold.toLocaleString());
  setText("degenerateTriangles", s.degenerate.toLocaleString());
  setText("orientationIssues", s.inconsistent.toLocaleString());
  setText("shellCount", s.shells.toLocaleString());

  // カードごとに、いちばん重い指摘の状態を表示
  for (const [group, cardId] of Object.entries(CARDS)) {
    const items = data.findings.filter((f) => f.group === group);
    const worst = items.reduce((w, f) => (RANK[f.level] > RANK[w.level] ? f : w), items[0]);
    const card = document.getElementById(cardId);
    card.className = `check-card ${worst.level}`;
    card.querySelector(".status-badge").textContent = LABEL[worst.level];
    const note = card.querySelector(".check-finding");
    note.textContent = items.filter((f) => f.level !== "ok").map((f) => `${f.title}：${f.detail}`).join(" ");
    note.classList.toggle("hidden", !note.textContent);
  }

  // 総合判定
  const titles = {
    ok: "大きな問題は見つかりませんでした",
    warn: "確認を推奨します",
    error: "このまま印刷せず、修正してください"
  };
  const problems = data.findings.filter((f) => f.level !== "ok")
    .sort((a, b) => RANK[b.level] - RANK[a.level]);
  const messages = {
    ok: "この簡易チェックでは、サイズ・水密性・つぶれた面・面の向き・独立した塊に問題は検出されませんでした。ただし、造形の成功を保証するものではありません。スライサーのプレビューも確認してください。",
    warn: "印刷はできる可能性がありますが、意図どおりか確認してください。 " + problems.map((f) => f.title).join("、") + "。",
    error: "印刷に失敗するおそれがあります。 " + problems.filter((f) => f.level === "error").map((f) => f.title).join("、") + "。"
  };
  document.getElementById("overallCard").className = `overall-card ${data.verdict}`;
  document.getElementById("overallIcon").textContent = MARK[data.verdict];
  setText("overallTitle", titles[data.verdict]);
  setText("overallMessage", messages[data.verdict]);
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Math.abs(value) >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
  return value.toLocaleString(undefined, { maximumSignificantDigits: 4 });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}
