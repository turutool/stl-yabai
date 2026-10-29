/*
 * 自動テスト： node tests/run.js
 * Blenderで作ったテストデータ（OK_01〜06 / NG_01〜07）と同じ形のSTLをコードで生成し、
 * analyzer.js の判定が期待どおりか確認します。基準値を変えたときはこれを実行してください。
 * 期待値は 2026-10 に Blender の 3D Print Toolbox と Bambu Studio で確認した結果に合わせています。
 */
const { analyzeSTL } = require("../analyzer.js");

/* ---------- STL生成ヘルパー ---------- */
function toBinary(tris) {
  const buf = new ArrayBuffer(84 + 50 * tris.length);
  const dv = new DataView(buf);
  new TextEncoder().encodeInto("solid test", new Uint8Array(buf, 0, 80)); // ヘッダがsolidで始まる例
  dv.setUint32(80, tris.length, true);
  tris.forEach((t, i) => {
    let o = 84 + 50 * i + 12;
    for (const v of t) for (const c of v) { dv.setFloat32(o, c, true); o += 4; }
  });
  return buf;
}
function toAscii(tris) {
  let s = "solid t\n";
  for (const t of tris) {
    s += "facet normal 0 0 0\n outer loop\n";
    for (const v of t) s += `  vertex ${v[0]} ${v[1]} ${v[2]}\n`;
    s += " endloop\nendfacet\n";
  }
  return new TextEncoder().encode(s + "endsolid t\n").buffer;
}
const quad = (a, b, c, d) => [[a, b, c], [a, c, d]];
function boxFaces(x0, y0, z0, x1, y1, z1) {
  const v = [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  const f = { bottom: [0,3,2,1], top: [4,5,6,7], front: [0,1,5,4], back: [3,7,6,2], left: [0,4,7,3], right: [1,2,6,5] };
  const out = {};
  for (const k in f) out[k] = quad(...f[k].map((i) => v[i]));
  return out;
}
const box = (...a) => Object.values(boxFaces(...a)).flat();
const flip = (tris) => tris.map(([a, b, c]) => [a, c, b]);

/* ---------- テスト ---------- */
const cases = [];
const t = (name, tris, expect, extra) => cases.push({ name, tris, expect, extra });

t("OK_01 立方体 20mm", box(0, 0, 0, 20, 20, 20), { verdict: "ok", shells: 1, boundary: 0 });
t("OK_02 厚み1.2mmの箱（上が開いた形）", (() => {
  // 外箱の上面を無くし、内側に空間を作って縁でつなぐ
  const o = boxFaces(0,0,0,20,20,20), i = boxFaces(1.2,1.2,1.2,18.8,18.8,20);
  // 縁（上面のリング）は4つの台形
  const R = [
    ...quad([0,0,20],[20,0,20],[18.8,1.2,20],[1.2,1.2,20]),
    ...quad([20,0,20],[20,20,20],[18.8,18.8,20],[18.8,1.2,20]),
    ...quad([20,20,20],[0,20,20],[1.2,18.8,20],[18.8,18.8,20]),
    ...quad([0,20,20],[0,0,20],[1.2,1.2,20],[1.2,18.8,20]),
  ];
  const outer = ["bottom","front","back","left","right"].flatMap((k) => o[k]);
  const inner = flip(["bottom","front","back","left","right"].flatMap((k) => i[k]));
  return [...outer, ...inner, ...R];
})(), { verdict: "ok", shells: 1, boundary: 0, inconsistent: 0 });
t("OK_03 板 20×20×1.2mm", box(0, 0, 0, 20, 20, 1.2), { verdict: "ok" }); // 1.2mm ≥ 薄板の警告しきい値0.8mm
t("OK_04 重なった箱を結合した形（1塊）", [...box(0,0,0,20,20,20)], { verdict: "ok" });
t("OK_05 面の向きを直した立方体", box(0, 0, 0, 20, 20, 20), { verdict: "ok" });
t("OK_面積ゼロの面が1枚あるが閉じた立方体（誤判定しないこと）", (() => {
  const f = boxFaces(0, 0, 0, 20, 20, 20);
  const A = [0,0,20], B = [20,0,20], C = [20,20,20], D = [0,20,20], M = [10,0,20];
  const top = [[A,B,M], [M,B,C], [M,C,D], [M,D,A]];
  return [...f.bottom, ...f.front, ...f.back, ...f.left, ...f.right, ...top];
})(), { verdict: "warn", boundary: 0, nonManifold: 0, inconsistent: 0, degenerate: 1 });

t("NG_01 1/1000に縮んだ立方体（0.02mm）", box(0, 0, 0, 0.02, 0.02, 0.02), { verdict: "error", level: ["size", "error"] });
t("NG_02 上面のない箱（開いた辺4本）", (() => {
  const f = boxFaces(0, 0, 0, 20, 20, 20);
  return [...f.bottom, ...f.front, ...f.back, ...f.left, ...f.right];
})(), { verdict: "error", boundary: 4 });
t("NG_03 厚みゼロの平面", quad([0,0,0],[20,0,0],[20,20,0],[0,20,0]), { verdict: "error" });
t("NG_04 重なった2つの立方体", [...box(0,0,0,20,20,20), ...box(10,0,0,30,20,20)], { verdict: "warn", shells: 2 });
t("NG_05 全面反転した立方体", flip(box(0, 0, 0, 20, 20, 20)), { verdict: "warn", level: ["orientation", "warn"], negVolume: true });
t("NG_06 上面だけ反転した立方体", (() => {
  const f = boxFaces(0, 0, 0, 20, 20, 20);
  return [...f.bottom, ...f.front, ...f.back, ...f.left, ...f.right, ...flip(f.top)];
})(), { verdict: "warn", inconsistent: 4 });
t("NG_07 厚み0.05mmの板", box(0, 0, 0, 20, 20, 0.05), { verdict: "error", level: ["size", "error"] });
t("入れ子の立方体（内側も閉じている）", [...box(0,0,0,20,20,20), ...box(5,5,5,15,15,15)], { verdict: "warn", shells: 2 });
t("造形範囲オーバー 300mm", box(0, 0, 0, 300, 20, 20), { verdict: "error", level: ["size", "error"] });
t("単位ミス 25000mm（m→mm）", box(0, 0, 0, 20000, 20000, 20000), { verdict: "warn", level: ["size", "warn"] });

// SAMPLES_DIR=出力先 node tests/run.js で、テスト用STLをファイルとしても書き出せます（画面での動作確認用）
if (process.env.SAMPLES_DIR) {
  const fs = require("fs");
  fs.mkdirSync(process.env.SAMPLES_DIR, { recursive: true });
  for (const c of cases) {
    const name = c.name.split(" ")[0].replace(/[^\w]/g, "") || "case";
    fs.writeFileSync(`${process.env.SAMPLES_DIR}/${name}.stl`, Buffer.from(toBinary(c.tris)));
  }
}
let fail = 0;
function check(label, cond, detail) {
  if (!cond) { fail++; console.log("  ✗ " + label + (detail ? "  → " + detail : "")); }
}
for (const c of cases) {
  for (const [fmt, enc] of [["binary", toBinary], ["ascii", toAscii]]) {
    const r = analyzeSTL(enc(c.tris));
    const s = r.stats;
    const before = fail;
    const e = c.expect;
    check("verdict", r.verdict === e.verdict, `期待 ${e.verdict} / 実際 ${r.verdict}`);
    for (const k of ["shells", "boundary", "nonManifold", "inconsistent", "degenerate"]) {
      if (k in e) check(k, s[k] === e[k], `期待 ${e[k]} / 実際 ${s[k]}`);
    }
    if (e.level) {
      const f = r.findings.find((x) => x.group === e.level[0] && x.level === e.level[1]);
      check(`${e.level[0]}:${e.level[1]} の指摘があること`, !!f);
    }
    if (e.negVolume) check("体積が負", s.volume < 0, String(s.volume));
    if (fail === before) console.log(`  ✓ [${fmt}] ${c.name}  → ${r.verdict}`);
    else console.log(`    ^ [${fmt}] ${c.name}\n      ${r.findings.map((x) => x.level + ":" + x.title).join(" / ")}`);
  }
}
// 壊れたファイル
for (const [name, buf] of [["空ファイル", new ArrayBuffer(0)], ["ゴミ", new Uint8Array(200).fill(7).buffer]]) {
  let threw = false; try { analyzeSTL(buf); } catch (_) { threw = true; }
  check(`${name} は読み込みエラーになる`, threw);
  console.log(`  ${threw ? "✓" : "✗"} ${name} → エラー`);
}
console.log(fail === 0 ? "\n全テスト合格" : `\n失敗 ${fail} 件`);
process.exit(fail ? 1 : 0);
