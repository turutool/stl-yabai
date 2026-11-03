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
    heavyTriangles: 1000000,      // 三角形数がこれ超 → 要確認（データが重い）
    // --- 局所的な細さ（2026-11 にBambu Studio A1・ノズル0.4mmで実測：0.4mm以下の部分は消える/エラー、0.5mmはゆがんで通る）
    nozzle: 0.4,                  // mm  ノズル径（表示用。基準値はこの実測に合わせた値を下に直接置く）
    thinError: 0.45,              // mm  この厚み未満の部分が一定量ある → 要修正（0.4mmは消え、0.5mmは通ったため、その間に置く）
    thinWarn: 0.8,                // mm  この厚み未満の部分が一定量ある → 要確認（暫定。実機で折れないか未確認）
    thinAreaFraction: 0.005,      // 表面積のこの割合以上が細ければ指摘する（ごく小さな先端などで騒がないため）
    thinSamples: 4000,            // 測る点の数（表面積に比例して配る）
    thinMaxTriangles: 600000,     // 三角形数がこれ超なら、細さの測定は行わない（時間がかかるため）
    // --- 接地面積（最下面から1層目の高さで切った断面の面積。球を下にして置いた形などを拾う）
    firstLayer: 0.2,              // mm  1層目の高さ
    minContactArea: 25,           // mm2 これ未満 → 要確認（暫定。実機ではがれるか未確認）
    contactMinMaxDim: 10          // mm  最大寸法がこれ以上のモデルだけ接地面積を見る（小さなモデルで騒がないため）
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


  /* ---------- 局所的な細さ：表面の点から内側へ線を伸ばし、反対側の面までの距離を測る ---------- */
  function buildBVH(tri, n) {
    const LEAF = 4, maxNodes = 2 * n + 1;
    const bmin = new Float32Array(n * 3), bmax = new Float32Array(n * 3), cen = new Float32Array(n * 3);
    for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) {
      const a = tri[t * 9 + k], b = tri[t * 9 + 3 + k], c = tri[t * 9 + 6 + k];
      bmin[t * 3 + k] = Math.min(a, b, c);
      bmax[t * 3 + k] = Math.max(a, b, c);
      cen[t * 3 + k] = (a + b + c) / 3;
    }
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    const box = new Float32Array(maxNodes * 6);
    const left = new Int32Array(maxNodes).fill(-1), right = new Int32Array(maxNodes).fill(-1);
    const start = new Int32Array(maxNodes), count = new Int32Array(maxNodes);
    let nodes = 1;
    const stN = [0], stS = [0], stC = [n];
    while (stN.length) {
      const nd = stN.pop(), s0 = stS.pop(), c0 = stC.pop();
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity;
      for (let i = s0; i < s0 + c0; i++) {
        const t = order[i];
        if (bmin[t * 3] < x0) x0 = bmin[t * 3]; if (bmin[t * 3 + 1] < y0) y0 = bmin[t * 3 + 1]; if (bmin[t * 3 + 2] < z0) z0 = bmin[t * 3 + 2];
        if (bmax[t * 3] > x1) x1 = bmax[t * 3]; if (bmax[t * 3 + 1] > y1) y1 = bmax[t * 3 + 1]; if (bmax[t * 3 + 2] > z1) z1 = bmax[t * 3 + 2];
        const a = cen[t * 3], b = cen[t * 3 + 1], c = cen[t * 3 + 2];
        if (a < cx0) cx0 = a; if (a > cx1) cx1 = a; if (b < cy0) cy0 = b; if (b > cy1) cy1 = b; if (c < cz0) cz0 = c; if (c > cz1) cz1 = c;
      }
      box.set([x0, y0, z0, x1, y1, z1], nd * 6);
      start[nd] = s0; count[nd] = c0;
      if (c0 <= LEAF) continue;
      const ex = cx1 - cx0, ey = cy1 - cy0, ez = cz1 - cz0;
      const axis = ex >= ey && ex >= ez ? 0 : (ey >= ez ? 1 : 2);
      const mid = (axis === 0 ? cx0 + cx1 : axis === 1 ? cy0 + cy1 : cz0 + cz1) / 2;
      let i = s0, j = s0 + c0 - 1;
      while (i <= j) {
        if (cen[order[i] * 3 + axis] < mid) i++;
        else { const tmp = order[i]; order[i] = order[j]; order[j] = tmp; j--; }
      }
      let split = i;
      if (split === s0 || split === s0 + c0) split = s0 + (c0 >> 1); // 分けられないときは半分に割る
      const l = nodes++, r = nodes++;
      left[nd] = l; right[nd] = r;
      stN.push(l, r); stS.push(s0, split); stC.push(split - s0, s0 + c0 - split);
    }
    return { box, left, right, start, count, order };
  }

  // 光線の最も近い交点までの距離（なければ Infinity）。skip は自分自身の三角形。
  function rayHit(bvh, tri, ox, oy, oz, dx, dy, dz, skip, stack) {
    const { box, left, right, start, count, order } = bvh;
    const ix = 1 / (dx === 0 ? 1e-30 : dx), iy = 1 / (dy === 0 ? 1e-30 : dy), iz = 1 / (dz === 0 ? 1e-30 : dz);
    let best = Infinity, sp = 0;
    stack[sp++] = 0;
    while (sp > 0) {
      const nd = stack[--sp], b = nd * 6;
      let t0 = (box[b] - ox) * ix, t1 = (box[b + 3] - ox) * ix;
      let tmin = Math.min(t0, t1), tmax = Math.max(t0, t1);
      t0 = (box[b + 1] - oy) * iy; t1 = (box[b + 4] - oy) * iy;
      tmin = Math.max(tmin, Math.min(t0, t1)); tmax = Math.min(tmax, Math.max(t0, t1));
      t0 = (box[b + 2] - oz) * iz; t1 = (box[b + 5] - oz) * iz;
      tmin = Math.max(tmin, Math.min(t0, t1)); tmax = Math.min(tmax, Math.max(t0, t1));
      if (tmax < Math.max(tmin, 0) || tmin > best) continue;
      if (left[nd] < 0) {
        for (let i = start[nd]; i < start[nd] + count[nd]; i++) {
          const t = order[i];
          if (t === skip) continue;
          const o = t * 9;
          const e1x = tri[o + 3] - tri[o], e1y = tri[o + 4] - tri[o + 1], e1z = tri[o + 5] - tri[o + 2];
          const e2x = tri[o + 6] - tri[o], e2y = tri[o + 7] - tri[o + 1], e2z = tri[o + 8] - tri[o + 2];
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (Math.abs(det) < 1e-14) continue;
          const id = 1 / det;
          const tx = ox - tri[o], ty = oy - tri[o + 1], tz = oz - tri[o + 2];
          const u = (tx * px + ty * py + tz * pz) * id;
          if (u < 0 || u > 1) continue;
          const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
          const v = (dx * qx + dy * qy + dz * qz) * id;
          if (v < 0 || u + v > 1) continue;
          const tt = (e2x * qx + e2y * qy + e2z * qz) * id;
          if (tt > 1e-9 && tt < best) best = tt;
        }
      } else { stack[sp++] = left[nd]; stack[sp++] = right[nd]; }
    }
    return best;
  }

  // 表面積に比例して点を配り、各点の「内側への厚み」を測る。flip は面の向きが全部逆のとき true。
  function measureThickness(tri, n, flip, T) {
    const cum = new Float64Array(n);
    let total = 0;
    for (let t = 0; t < n; t++) {
      const o = t * 9;
      const e1x = tri[o + 3] - tri[o], e1y = tri[o + 4] - tri[o + 1], e1z = tri[o + 5] - tri[o + 2];
      const e2x = tri[o + 6] - tri[o], e2y = tri[o + 7] - tri[o + 1], e2z = tri[o + 8] - tri[o + 2];
      const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
      total += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
      cum[t] = total;
    }
    if (!(total > 0)) return null;
    const bvh = buildBVH(tri, n);
    const stack = new Int32Array(128);
    const M = T.thinSamples, eps = 2e-4, sign = flip ? -1 : 1;
    let seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    let valid = 0, err = 0, warn = 0, minT = Infinity;
    for (let m = 0; m < M; m++) {
      const target = (m + 0.5) / M * total;
      let lo = 0, hi = n - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < target) lo = mid + 1; else hi = mid; }
      const t = lo, o = t * 9;
      const e1x = tri[o + 3] - tri[o], e1y = tri[o + 4] - tri[o + 1], e1z = tri[o + 5] - tri[o + 2];
      const e2x = tri[o + 6] - tri[o], e2y = tri[o + 7] - tri[o + 1], e2z = tri[o + 8] - tri[o + 2];
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len < 1e-12) continue;
      nx = sign * nx / len; ny = sign * ny / len; nz = sign * nz / len;
      let u = rnd(), v = rnd();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const px = tri[o] + u * e1x + v * e2x, py = tri[o + 1] + u * e1y + v * e2y, pz = tri[o + 2] + u * e1z + v * e2z;
      // 法線の真下に1本＋斜め45度の8本を撃ち、「面に垂直な方向に直した距離」の最大を厚みとする。
      // 細かい凹凸で法線が大きく傾いた面でも、隣の凸に当たって細いと誤判定しないため（斜めの光線が反対側まで届く）。
      // 平らな板や円柱の細い肢では、真下の1本が最大になり、厚みがそのまま出る。
      let ux, uy, uz;
      if (Math.abs(nx) < 0.9) { ux = 0; uy = nz; uz = -ny; } else { ux = -nz; uy = 0; uz = nx; }
      const ul = Math.sqrt(ux * ux + uy * uy + uz * uz); ux /= ul; uy /= ul; uz /= ul;
      const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
      let thick = -1;
      for (let j = 0; j < 9; j++) {
        let dx = -nx, dy = -ny, dz = -nz, cs = 1;
        if (j > 0) {
          const ph = (j - 1) * Math.PI / 4, c = Math.SQRT1_2;
          dx = -nx * c + c * (Math.cos(ph) * ux + Math.sin(ph) * vx);
          dy = -ny * c + c * (Math.cos(ph) * uy + Math.sin(ph) * vy);
          dz = -nz * c + c * (Math.cos(ph) * uz + Math.sin(ph) * vz);
          cs = c;
        }
        const d = rayHit(bvh, tri, px - nx * eps, py - ny * eps, pz - nz * eps, dx, dy, dz, t, stack);
        if (isFinite(d) && d * cs + eps > thick) thick = d * cs + eps;
      }
      if (thick < 0) continue; // 反対側がない（開いた形）。この点は数えない
      valid++;
      if (thick < minT) minT = thick;
      if (thick < T.thinError) err++;
      if (thick < T.thinWarn) warn++;
    }
    if (valid === 0) return null;
    return { valid, minT, errFrac: err / valid, warnFrac: warn / valid };
  }

  // 最下面から高さ h で水平に切った断面の面積（接地面積の目安）。輪郭線の外積の合計で求める。
  function sliceArea(tri, n, z0) {
    let sum = 0;
    for (let t = 0; t < n; t++) {
      const o = t * 9;
      let up = null, down = null;
      for (let e = 0; e < 3; e++) {
        const a = o + e * 3, b = o + ((e + 1) % 3) * 3;
        const za = tri[a + 2], zb = tri[b + 2];
        const aBelow = za < z0, bBelow = zb < z0;
        if (aBelow === bBelow) continue;
        const k = (z0 - za) / (zb - za);
        const pt = [tri[a] + k * (tri[b] - tri[a]), tri[a + 1] + k * (tri[b + 1] - tri[a + 1])];
        if (aBelow) up = pt; else down = pt; // 下から上へ越える辺／上から下へ越える辺
      }
      if (up && down) sum += 0.5 * (up[0] * down[1] - down[0] * up[1]);
    }
    return Math.abs(sum);
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
    //    group: "size"(サイズ・単位) / "water"(水密性) / "degenerate" / "orientation" / "shell" / "thin"(細い部分) / "contact"(接地面積)
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

    // --- 局所的な細さ・接地面積（反対側の面までの距離を測る。向きがそろっていないと測れない）
    let thin = null, contactArea = null, thinNote = null;
    if (inconsistent > 0) thinNote = "面の向きがそろっていないため、細さと接地面積は未判定です。向きを直してから、もう一度確認してください。";
    else if (nTri > T.thinMaxTriangles) thinNote = `三角形が ${nTri.toLocaleString()} 枚と多いため、細さの測定は省略しました。必要なら面を間引いてから確認してください。`;
    else if (nonFinite) thinNote = "座標が不正なため未判定です。";
    if (thinNote) {
      add("thin", "warn", "細さを判定できません", thinNote);
      add("contact", "warn", "接地面積を判定できません", thinNote);
    } else {
      thin = measureThickness(tri, nTri, volume < 0, T);
      const pct = (f) => (f * 100).toFixed(1) + "%";
      if (thin && thin.errFrac >= T.thinAreaFraction) {
        add("thin", "error", "細すぎる部分があります",
          `厚みが ${T.thinError} mm 未満の部分が、表面の約 ${pct(thin.errFrac)} あります（最小 ${thin.minT.toFixed(2)} mm）。ノズル ${T.nozzle} mm より細い部分は、スライサーで消えるか、印刷できません。向きを変えても直りません。元のモデルで細い部分を ${T.thinWarn} mm より太くしてください。`,
          "Blenderの場合：細い部分の頂点を選んで拡大（S）するか、ソリッド化モディファイアで厚みを付けます。");
      } else if (thin && thin.warnFrac >= T.thinAreaFraction) {
        add("thin", "warn", "細めの部分があります",
          `厚みが ${T.thinWarn} mm 未満の部分が、表面の約 ${pct(thin.warnFrac)} あります（最小 ${thin.minT.toFixed(2)} mm）。スライスはできても、形がゆがんだり、印刷中に折れたりするおそれがあります。可能なら ${T.thinWarn} mm より太くしてください。`);
      } else {
        add("thin", "ok", "細い部分", thin ? `最小 ${thin.minT.toFixed(2)} mm（${T.thinWarn} mm 未満の部分はほぼありません）。` : "測定できる面がありませんでした。");
      }
      const h = size[2];
      if (maxDim >= T.contactMinMaxDim && h > 2 * T.firstLayer) {
        contactArea = sliceArea(tri, nTri, mn[2] + T.firstLayer);
        if (contactArea < T.minContactArea) {
          add("contact", "warn", "床に接する面積が小さいです",
            `最下面から ${T.firstLayer} mm の高さの断面積が約 ${contactArea.toFixed(1)} mm² です（目安 ${T.minContactArea} mm² 以上）。このSTLの向きのまま置くと、1層目がうまく付かず、印刷中にはがれるおそれがあります。スライサーはこの状態を警告しません。向きを変えるか、サポートやブリムを使ってください。`);
        } else {
          add("contact", "ok", "接地面積", `約 ${contactArea.toFixed(1)} mm²。`);
        }
      } else {
        add("contact", "ok", "接地面積", "小さなモデルのため判定しません。");
      }
    }

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
        boundary, nonManifold, inconsistent, degenerate, shells, bytes: buffer.byteLength,
        thinMin: thin ? thin.minT : null, thinErrorFrac: thin ? thin.errFrac : null, thinWarnFrac: thin ? thin.warnFrac : null,
        contactArea
      }
    };
  }

  const api = { THRESHOLDS, parseSTL, analyzeSTL };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StlYabai = api;
})(typeof window !== "undefined" ? window : globalThis);
