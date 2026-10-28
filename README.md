# STL Checker

GitHub Pages で公開できる、完全クライアントサイドの簡易 STL チェッカーです。

## 主な機能

- Binary STL / ASCII STL の読み込み
- 三角形数
- ユニーク頂点数
- 外形寸法
- 推定体積
- 開放エッジ検出
- Non-manifold edge 検出
- 退化した三角形の検出
- 隣接面の方向不整合の簡易検出
- ファイルはアップロードせず、ブラウザ内だけで解析

## 注意

STL には単位情報がないため、画面では数値を mm として表示します。

このツールは簡易チェックです。以下は判定しません。

- 自己交差
- 最小肉厚
- オーバーハング
- サポート材の要否
- プリンタ固有のビルドボリューム
- スライサー固有のエラー
- 実際の造形成功可否

## GitHub Pages での公開

1. このフォルダ内の `index.html`, `styles.css`, `app.js` を GitHub リポジトリへアップロード
2. GitHub の `Settings`
3. `Pages`
4. `Build and deployment` → `Deploy from a branch`
5. Branch を `main`、Folder を `/(root)` に設定
6. Save

数分後、GitHub Pages の URL から利用できます。

## 構成

```text
stl-checker/
├── index.html
├── styles.css
├── app.js
└── README.md
```

## Figma でデザインする場合

Figma で見た目を先に作ることは可能です。ただし Figma の画面をそのまま Web アプリへ自動変換するのではなく、Figma を「デザイン仕様書」として使い、HTML/CSS 側へ反映するのがおすすめです。

特に次を Figma で決めると実装しやすくなります。

- 色
- 文字サイズ / ウェイト
- 余白
- カードの角丸
- ボタン
- PC / スマホ時のレイアウト
- OK / 注意 / エラーの表示ルール
