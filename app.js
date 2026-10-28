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
    const analysis = analyzeSTL(buffer);
    renderResults(analysis);
    resultSection.classList.remove("hidden");
  } catch (error) {
    console.error(error);
    alert(`STLを解析できませんでした。\n${error.message}`);
  } finally {
    loadingSection.classList.add("hidden");
  }
}

function analyzeSTL(buffer) {
  const triangles = isBinarySTL(buffer)
    ? parseBinarySTL(buffer)
    : parseASCIISTL(buffer);

  if (!triangles.length) {
    throw new Error("三角形を読み取れませんでした。STL形式を確認してください。");
  }

  return inspectMesh(triangles);
}

function isBinarySTL(buffer) {
  if (buffer.byteLength < 84) return false;

  const view = new DataView(buffer);
  const triangleCount = view.getUint32(80, true);
  const expectedLength = 84 + triangleCount * 50;

  // Binary STLはヘッダが "solid" で始まる場合もあるため、サイズ一致を優先。
  if (expectedLength === buffer.byteLength) return true;

  // ASCIIらしい場合はASCIIとして扱う。
  const head = new TextDecoder().decode(buffer.slice(0, Math.min(512, buffer.byteLength)));
  return !/^\s*solid\b/i.test(head) || !/\bfacet\b/i.test(head);
}

function parseBinarySTL(buffer) {
  const view = new DataView(buffer);
  const triangleCount = view.getUint32(80, true);
  const triangles = [];
  let offset = 84;

  if (84 + triangleCount * 50 > buffer.byteLength) {
    throw new Error("Binary STLのデータ長が不正です。");
  }

  for (let i = 0; i < triangleCount; i++) {
    offset += 12; // normal
    const vertices = [];

    for (let v = 0; v < 3; v++) {
      const x = view.getFloat32(offset, true);
      const y = view.getFloat32(offset + 4, true);
      const z = view.getFloat32(offset + 8, true);
      offset += 12;
      vertices.push([x, y, z]);
    }

    offset += 2; // attribute byte count
    triangles.push(vertices);
  }

  return triangles;
}

function parseASCIISTL(buffer) {
  const text = new TextDecoder().decode(buffer);
  const vertexRegex = /\bvertex\s+([+\-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+\-]?\d+)?)\s+([+\-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+\-]?\d+)?)\s+([+\-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+\-]?\d+)?)/gi;

  const vertices = [];
  let match;
  while ((match = vertexRegex.exec(text)) !== null) {
    vertices.push([Number(match[1]), Number(match[2]), Number(match[3])]);
  }

  if (vertices.length % 3 !== 0) {
    throw new Error("ASCII STLの頂点数が不正です。");
  }

  const triangles = [];
  for (let i = 0; i < vertices.length; i += 3) {
    triangles.push([vertices[i], vertices[i + 1], vertices[i + 2]]);
  }

  return triangles;
}

function inspectMesh(triangles) {
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity]
  };

  let coordinateScale = 1;
  for (const tri of triangles) {
    for (const v of tri) {
      coordinateScale = Math.max(
        coordinateScale,
        Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])
      );
    }
  }

  // 浮動小数点誤差を吸収するため座標を量子化して頂点同一性を判定。
  // モデルのスケールに対して十分小さい相対許容値を利用。
  const tolerance = Math.max(coordinateScale * 1e-7, 1e-7);

  const vertexMap = new Map();
  const edgeMap = new Map();
  let degenerateTriangles = 0;
  let signedVolumeTimes6 = 0;

  function vertexKey(v) {
    return [
      Math.round(v[0] / tolerance),
      Math.round(v[1] / tolerance),
      Math.round(v[2] / tolerance)
    ].join(",");
  }

  function getVertexId(v) {
    const key = vertexKey(v);
    if (!vertexMap.has(key)) {
      vertexMap.set(key, vertexMap.size);
    }
    return vertexMap.get(key);
  }

  for (const triangle of triangles) {
    const [a, b, c] = triangle;

    for (const v of triangle) {
      for (let axis = 0; axis < 3; axis++) {
        bounds.min[axis] = Math.min(bounds.min[axis], v[axis]);
        bounds.max[axis] = Math.max(bounds.max[axis], v[axis]);
      }
    }

    const ids = [getVertexId(a), getVertexId(b), getVertexId(c)];

    const area2 = vectorLength(cross(subtract(b, a), subtract(c, a)));
    const areaThreshold = Math.max(coordinateScale * coordinateScale * 1e-12, 1e-18);

    if (
      ids[0] === ids[1] ||
      ids[1] === ids[2] ||
      ids[2] === ids[0] ||
      area2 <= areaThreshold
    ) {
      degenerateTriangles++;
    }

    signedVolumeTimes6 += dot(a, cross(b, c));

    const directedEdges = [
      [ids[0], ids[1]],
      [ids[1], ids[2]],
      [ids[2], ids[0]]
    ];

    for (const [from, to] of directedEdges) {
      const low = Math.min(from, to);
      const high = Math.max(from, to);
      const key = `${low}:${high}`;

      if (!edgeMap.has(key)) {
        edgeMap.set(key, {
          count: 0,
          forward: 0,
          backward: 0
        });
      }

      const edge = edgeMap.get(key);
      edge.count++;

      if (from === low && to === high) edge.forward++;
      else edge.backward++;
    }
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  let orientationIssues = 0;

  for (const edge of edgeMap.values()) {
    if (edge.count === 1) boundaryEdges++;
    if (edge.count > 2) nonManifoldEdges++;

    // 閉じたmanifold edgeなら2面が逆方向に共有するのが期待値。
    if (edge.count === 2 && (edge.forward === 2 || edge.backward === 2)) {
      orientationIssues++;
    }
  }

  const dimensions = bounds.max.map((maxValue, i) => maxValue - bounds.min[i]);
  const volume = Math.abs(signedVolumeTimes6) / 6;

  return {
    triangleCount: triangles.length,
    vertexCount: vertexMap.size,
    dimensions,
    volume,
    boundaryEdges,
    nonManifoldEdges,
    degenerateTriangles,
    orientationIssues,
    tolerance
  };
}

function renderResults(data) {
  setText("triangleCount", data.triangleCount.toLocaleString());
  setText("vertexCount", data.vertexCount.toLocaleString());
  setText(
    "dimensions",
    data.dimensions.map((v) => formatNumber(v)).join(" × ") + " mm"
  );
  setText("volume", `${formatNumber(data.volume)} mm³`);

  setText("boundaryEdges", data.boundaryEdges.toLocaleString());
  setText("nonManifoldEdges", data.nonManifoldEdges.toLocaleString());
  setText("degenerateTriangles", data.degenerateTriangles.toLocaleString());
  setText("orientationIssues", data.orientationIssues.toLocaleString());

  const watertightState =
    data.boundaryEdges === 0 && data.nonManifoldEdges === 0 ? "ok" : "error";

  const degenerateState =
    data.degenerateTriangles === 0 ? "ok" : "warn";

  const orientationState =
    data.orientationIssues === 0 ? "ok" : "warn";

  setCheckState(
    "watertightCheck",
    watertightState,
    watertightState === "ok" ? "問題なし" : "要修正"
  );

  setCheckState(
    "degenerateCheck",
    degenerateState,
    degenerateState === "ok" ? "問題なし" : "要確認"
  );

  setCheckState(
    "orientationCheck",
    orientationState,
    orientationState === "ok" ? "問題なし" : "要確認"
  );

  let overallState = "ok";
  let title = "大きな問題は見つかりませんでした";
  let message =
    "この簡易チェックでは、水密性・Non-manifold・退化面・面方向に大きな問題は検出されませんでした。";

  if (data.boundaryEdges > 0 || data.nonManifoldEdges > 0) {
    overallState = "error";
    title = "修正が必要な可能性があります";
    message =
      "穴が開いている、またはNon-manifoldな箇所が検出されました。Blender等でメッシュを確認してください。";
  } else if (data.degenerateTriangles > 0 || data.orientationIssues > 0) {
    overallState = "warn";
    title = "確認を推奨します";
    message =
      "水密性には大きな問題が見つかりませんでしたが、退化面または面方向の不整合が検出されました。";
  }

  const overallCard = document.getElementById("overallCard");
  overallCard.className = `overall-card ${overallState}`;
  document.getElementById("overallIcon").textContent =
    overallState === "ok" ? "✓" : overallState === "warn" ? "!" : "×";
  setText("overallTitle", title);
  setText("overallMessage", message);
}

function setCheckState(id, state, label) {
  const card = document.getElementById(id);
  card.className = `check-card ${state}`;
  card.querySelector(".status-badge").textContent = label;
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function vectorLength(v) {
  return Math.hypot(v[0], v[1], v[2]);
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
