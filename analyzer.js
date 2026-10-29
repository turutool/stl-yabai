/*
 * stl-yabai 解析ロジック（画面に依存しない部分）
 *
 * ★判定の基準値はすぐ下の THRESHOLDS だけを書き換えれば変更できます。
 *   各値の根拠は README の「判定基準と根拠」を参照。
 * ★このファイルは DOM を使いません。ブラウザでも Node.js でも動きます
 *   （tests/run.js から読み込んで自動テストしています）。
 */
(function (root) {
  "use strict";

  const THRESHOLDS = {
    buildVolume: [256, 256, 256], // mm  Bambu Lab A1 の造形範囲
    weldTolerance: 0.001,         // mm  この距離以内の頂点は同じ点とみなす
    maxDimTooSmallError: 1,       // mm  最大寸法がこれ未満 → 要修正（単位ミスの疑い）
    maxDimTooSmallWarn: 5,        // mm  最大寸法がこれ未満 → 要確認
    maxDimTooLargeWarn: 1000,     // mm  最大寸法がこれ超 → 要確認（m→mm の単位ミスの疑い）
    minThicknessError: 0.2,       // mm  最小寸法がこれ未満 → 要修正（スライスできない）
    minThicknessWarn: 0.8,        // mm  最小寸法がこれ未満 → 要確認（薄い板）
    minVolume: 1e-6,              // mm3 体積の絶対値がこれ以下 → 要修正（厚みなし）
    degenerateArea: 1e-9,         // mm2 面積がこれ以下の三角形は「つぶれた面」
    heavyTriangles: 1000000       // 三角形数がこれ超 → 要確認（データが重い）
  };

  /* ---------- 読み込み ---------- */
  function parseSTL(buffer) {
    const len = buffer.byteLength;
    if (len >= 84) {
      const dv = new DataView(buffer);
      const n = dv.getUint32(80, true);
      // バイナリSTLはヘッダが "solid" で始まることもあるので、サイズの一致を最優先で判定
      if (84 + 50 * n === len) {
        const tri = new Float32Array(n * 9);
        for (let i = 0; i < n; i++) {
          const o = 84 + 50 * i + 12; // 法線(12byte)は読み飛ばす
          for (let k = 0; k < 9; k++) tri[i * 9 + k] = dv.getFloat32(o + k * 4, true);
        }
        return { tri, format: "binary" };
      }
    }
    const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(len, 256)))
      .trimStart().toLowerCase();
    if (head.startsWith("solid")) {
      const text = new TextDecoder().decode(new Uint8Array(buffer));
      const re = /\bvertex\s+([+\-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+\-]?\d+)?)\s+([+\-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+\-]?\d+)?)\s+([+\-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+\-]?\d+)?)/gi;
      const a = [];
      let m;
      while ((m = re.exec(text)) !== null) a.push(+m[1], +m[2], +m[3]);
      if (a.length >= 9 && a.length % 9 === 0) return { tri: Float32Array.from(a), format: "ascii" };
      if (a.length > 0) throw new Error("ASCII STLの頂点数が不正です（3の倍数になっていません）。");
    }
    throw new Error("STLとして読み込めませんでした（壊れているか、STL以外のファイルです）。");
  }

  /* ---------- 解析 ---------- */
  function analyzeSTL(buffer, T) {
    T = Object.assign({}, THRESHOLDS, T || {});
    const { tri, format } = parseSTL(buffer);
    const nTri = tri.length / 9;

    // 1) 頂点の結合。STLは三角形ごとに角の座標を持つので、同じ位置の点を1つにまとめる
    const inv = 1 / T.weldTolerance;
    const ids = new Map();
    const pos = [];
    const idx = new Uint32Array(nTri * 3);
    let nonFinite = false;
    for (let i = 0; i < nTri * 3; i++) {
      const x = tri[i * 3], y = tri[i * 3 + 1], z = tri[i * 3 + 2];
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) { nonFinite = true; }
      const key = Math.round(x * inv) + "," + Math.round(y * inv) + "," + Math.round(z * inv);
      let id = ids.get(key);
      if (id === undefined) { id = pos.length / 3; ids.set(key, id); pos.push(x, y, z); }
      idx[i] = id;
    }
    ids.clear();
    const nV = pos.length / 3;

    // 2) 外形寸法
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < nV; i++) for (let k = 0; k < 3; k++) {
      const v = pos[i * 3 + k];
      if (v < mn[k]) mn[k] = v;
      if (v > mx[k]) mx[k] = v;
    }
    const size = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];

    // 3) 辺の集計・体積・つぶれた面・独立した塊（union-find）
    const parent = new Int32Array(nV);
    for (let i = 0; i < nV; i++) parent[i] = i;
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
    const used = new Uint8Array(nV);
    const edgeCount = new Map(); // 辺 → その辺を使う面の数
    const edgeDir = new Map();   // 辺 → 向きの合計（+1/-1）。逆向きで共有されていれば0
    let signed6 = 0, degenerate = 0;

    for (let t = 0; t < nTri; t++) {
      const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
      const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
      const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
      const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const area = 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (area <= T.degenerateArea) degenerate++;
      // 頂点の結合で「つぶれて」同じ点になった面は、辺の集計から除く（除かないと開いた辺と誤判定する）。
      // 面積が小さいだけの面は、隣の面とつながっているので集計に残す。
      if (a === b || b === c || c === a) { if (area > T.degenerateArea) degenerate++; continue; }
      // ↑ 結合でつぶれた面は面積も小さいので、上の判定ですでに数えている（念のための保険）
      signed6 += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
      used[a] = used[b] = used[c] = 1;
      union(a, b);
      union(b, c);
      const e = [a, b, b, c, c, a];
      for (let k = 0; k < 6; k += 2) {
        const p = e[k], q = e[k + 1];
        const key = (p < q ? p : q) * nV + (p < q ? q : p);
        edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
        edgeDir.set(key, (edgeDir.get(key) || 0) + (p < q ? 1 : -1));
      }
    }
    let boundary = 0, nonManifold = 0, inconsistent = 0;
    for (const [k, c] of edgeCount) {
      if (c === 1) boundary++;
      else if (c > 2) nonManifold++;
      else if (edgeDir.get(k) !== 0) inconsistent++;
    }
    const roots = new Set();
    for (let i = 0; i < nV; i++) if (used[i]) roots.add(find(i));
    const shells = roots.size;
    const volume = signed6 / 6; // 符号付き。負なら面が全部裏返っている
    const minDim = Math.min(size[0], size[1], size[2]);
    const maxDim = Math.max(size[0], size[1], size[2]);

    // 4) 判定。level: "error"(要修正) / "warn"(要確認) / "ok"
    //    group: "size"(サイズ・単位) / "water"(水密性) / "degenerate" / "orientation" / "shell"
    const findings = [];
    // tip は「Blenderで作った人向け」の補足。画面では折りたたんで表示し、他のソフトで作った人の邪魔にならないようにする
    const add = (group, level, title, detail, tip) => findings.push({ group, level, title, detail, tip });
    const f1 = (v) => v.toFixed(1), f3 = (v) => v.toFixed(3);

    if (nonFinite) add("size", "error", "座標が不正", "数値でない座標（NaN・無限大）が含まれています。");

    // --- サイズ・単位
    if (maxDim < T.maxDimTooSmallError) {
      add("size", "error", "サイズが小さすぎます",
        `最大寸法が ${f3(maxDim)} mm です。書き出し時の単位の取り違え（m・cm・inchとmm）の疑いがあります。モデリングソフトの単位設定と書き出し設定を確認してください。`,
        "Blenderの場合：STLの書き出し設定で「シーンの単位」がONになっていないか確認します（ONだと1/1000の大きさで書き出されます）。");
    } else if (maxDim < T.maxDimTooSmallWarn) {
      add("size", "warn", "サイズがかなり小さいです", `最大寸法 ${f3(maxDim)} mm。意図したサイズか確認してください。`);
    } else if (maxDim > T.maxDimTooLargeWarn) {
      add("size", "warn", "サイズが大きすぎます", `最大寸法 ${maxDim.toFixed(0)} mm。単位の取り違え（m と mm）の疑いがあります。`);
    }
    const over = size.some((s, i) => s > T.buildVolume[i]);
    if (over && maxDim <= T.maxDimTooLargeWarn) {
      add("size", "error", "A1の造形範囲を超えています",
        `${size.map(f1).join(" × ")} mm ＞ ${T.buildVolume.join(" × ")} mm。向きを変えると収まる場合があります。`);
    }
    if (minDim < T.minThicknessError) {
      add("size", "error", "薄すぎてスライスできません",
        `最小寸法が ${f3(minDim)} mm です。厚みのない面や極薄の板は、スライサーが層を作れません。`);
    } else if (minDim < T.minThicknessWarn) {
      add("size", "warn", "薄い形状です", `最小寸法 ${minDim.toFixed(2)} mm。壁としては薄めなので、強度と造形できるかを確認してください。`);
    }
    if (Math.abs(volume) <= T.minVolume) {
      add("size", "error", "体積がゼロです", `体積 ${volume.toFixed(4)} mm³。面だけで厚みがない可能性があります。`);
    }
    if (!findings.some((f) => f.group === "size")) {
      add("size", "ok", "サイズ・単位", `${size.map(f1).join(" × ")} mm（A1の造形範囲内）`);
    }

    // --- 水密性
    if (boundary > 0 || nonManifold > 0) {
      const parts = [];
      if (boundary > 0) parts.push(`開いた辺 ${boundary} 本（穴・面の欠け）`);
      if (nonManifold > 0) parts.push(`3枚以上の面が共有する辺 ${nonManifold} 本`);
      add("water", "error", "モデルが閉じていません", parts.join("、") + "。スライサーが自動で埋めても形が変わることがあります。元のモデルが閉じた立体（ソリッド）になっているか確認して、書き出し直してください。");
    } else {
      add("water", "ok", "水密性", "閉じた形状です。");
    }

    // --- つぶれた面
    if (degenerate > 0) add("degenerate", "warn", "つぶれた面があります", `${degenerate} 枚。重複した点や、つぶれた面を整理（頂点の結合・不要な面の削除）して、書き出し直してください。`,
      "Blenderの場合：編集モードで全選択し、メッシュ → クリーンアップ →「距離でマージ」を実行します。");
    else add("degenerate", "ok", "つぶれた面", "ありません。");

    // --- 面の向き
    if (inconsistent > 0) {
      add("orientation", "warn", "面の向きがそろっていません", `向きが不整合な辺 ${inconsistent} 本。一部の面の向き（法線）が裏返っています。元のモデルで、面の向きを外側にそろえてから書き出し直してください。`,
        "Blenderの場合：編集モードで全選択し、Shift+N（法線を外側に揃える）を実行します。");
    } else if (volume < -T.minVolume) {
      add("orientation", "warn", "全体の向きが逆です", `体積が負（${volume.toFixed(1)} mm³）。面がすべて裏返っています。元のモデルで、面の向き（法線）を外側にそろえてから書き出し直してください。`,
        "Blenderの場合：編集モードで全選択し、Shift+N（法線を外側に揃える）を実行します。");
    } else {
      add("orientation", "ok", "面の向き", "そろっています。");
    }

    // --- 独立した塊
    if (shells > 1) add("shell", "warn", "独立した塊が複数あります", `${shells} 個。意図した数か確認してください。重なった立方体などは「結合」で1つにします。`);
    else if (shells === 1) add("shell", "ok", "独立した塊", "1個です。");

    if (nTri > T.heavyTriangles) {
      add("size", "warn", "データが重いです", `三角形 ${nTri.toLocaleString()} 枚。スライスに時間がかかります。必要なら面を間引いてください。`);
    }

    const rank = { ok: 0, warn: 1, error: 2 };
    const worst = findings.reduce((m, f) => Math.max(m, rank[f.level]), 0);
    return {
      verdict: ["ok", "warn", "error"][worst],
      findings,
      stats: {
        format, triangles: nTri, vertices: nV, size, min: mn, max: mx, volume,
        boundary, nonManifold, inconsistent, degenerate, shells, bytes: buffer.byteLength
      }
    };
  }

  const api = { THRESHOLDS, parseSTL, analyzeSTL };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StlYabai = api;
})(typeof window !== "undefined" ? window : globalThis);
