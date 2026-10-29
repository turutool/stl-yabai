# stl-yabai

A lightweight browser-based STL checker for 3D printing.

STLファイルをブラウザ上で読み込み、3Dプリント前の基本的なメッシュ不備を簡易チェック。

## Features

- Binary STL / ASCII STL の読み込み
- サイズ・単位のチェック（極端に小さい／大きい、A1の造形範囲256mm、極薄で層ができない）
- 水密性の簡易チェック（開放エッジ・Non-manifold edge）
- つぶれた面（面積ほぼ0の三角形）の検出
- 面の向き（一部の裏返り・全体の裏返り）の検出
- 独立した塊（シェル）の数
- 三角形数・ユニーク頂点数・外形寸法・推定体積

## Usage

1. Webアプリを開く。
2. STLファイルをドラッグ＆ドロップ、またはファイル選択から読み込み。
3. 解析結果を確認。
4. 問題が検出された場合は、Blenderなどの3D編集ソフトでモデルを確認・修正。

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `index.html` / `styles.css` | 画面 |
| `app.js` | 画面の操作と結果表示 |
| `analyzer.js` | 解析ロジックと**判定基準（`THRESHOLDS`）** |
| `tests/run.js` | 自動テスト（`node tests/run.js`） |

## 判定基準と根拠

基準値は `analyzer.js` 冒頭の `THRESHOLDS` だけで変更できます。
根拠は、Blender（3D Print Toolbox）とBambu Studioで同じデータを実際に読み込んで確認した結果です（2026-10）。

| 判定 | 項目 | 条件 | 根拠 |
| --- | --- | --- | --- |
| 要修正 | 開放エッジ／Non-manifold | 1本でもあれば | 穴あき。Bambu Studioは警告を出し、自動で埋めるが形が変わることがある |
| 要修正 | 最大寸法が小さすぎる | 1mm未満 | Blenderで「シーンの単位」をONのまま書き出すと1/1000になる（20mm→0.02mm）。Bambu Studioは「小さすぎます」と出す |
| 要修正 | 最小寸法が薄すぎる | 0.2mm未満 | 0.05mmの板は読み込めてもスライスで「レイヤーが検出されません」エラーになった |
| 要修正 | 体積ゼロ | 1e-6 mm³以下 | 厚みゼロの平面は「体積が0」として削除された |
| 要修正 | 造形範囲超え | 256×256×256mm超 | A1の仕様 |
| 要確認 | 薄い形状 | 最小寸法0.8mm未満 | ノズル径0.4mmの2周分の目安。壁厚の強度判定ではない |
| 要確認 | 面の向き | 一部の面が裏返り／全体が裏返り | Bambu Studioは警告を出さずに通る（出力も同じだった）。Blender側の不備を早く見つけるため警告のみ |
| 要確認 | 独立した塊が2個以上 | — | 重なった立方体・入れ子。スライサーは警告なしで通る。意図した数かの確認用 |
| 要確認 | つぶれた面／サイズが極端／データが重い | — | `THRESHOLDS` 参照 |

「要確認」は印刷自体は通る可能性がありますが、意図どおりか人が見る項目です。

## 変更・テストの手順

1. `analyzer.js` の `THRESHOLDS` を編集。
2. `node tests/run.js` を実行し、全テスト合格を確認（Node.jsがあれば動きます）。
3. 実際のSTL（問題なし／ありの両方）で画面を確認してからコミット。

## Privacy

STLファイルは使用中のブラウザ内で解析。
STLデータそのものをGitHubや外部サーバーへアップロード・保存する実装はなし。

## Limitations

このツールは、3Dプリント前の簡易チェックを目的としており、以下の項目は現在判定なし。

- 自己交差
- 最小肉厚
- オーバーハング
- サポート材の必要性
- プリンター固有の造形可能サイズ
- スライサー固有のエラー
- 実際の造形成功可否

STL形式には単位情報が含まれないため、寸法表示では数値をmmとする。
「問題なし」と表示された場合でも、必ず造形が成功するわけではない。
そのため、必要に応じてBlender、スライサー、その他のメッシュ検証ツールでも確認を推奨。

## Development

This project is a small independent utility intended for educational and personal fabrication workflows.
The project was developed with assistance from generative AI tools. Generated code has been reviewed and adapted for this project.

## License

No open-source license is currently granted for this repository.
The licensing status of this project may be updated in the future.
