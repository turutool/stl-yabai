# stl-yabai

A lightweight browser-based STL checker for 3D printing.

STLファイルをブラウザ上で読み込み、3Dプリント前の基本的なメッシュ不備を簡易チェック。

## Features

- Binary STL / ASCII STL の読み込み
- 水密性の簡易チェック
- 開放エッジの検出
- Non-manifold edge の検出
- 退化した三角形の検出
- 面方向の不整合の簡易チェック
- 三角形数
- ユニーク頂点数
- 外形寸法
- 推定体積

## Usage

1. Webアプリを開く。
2. STLファイルをドラッグ＆ドロップ、またはファイル選択から読み込み。
3. 解析結果を確認。
4. 問題が検出された場合は、Blenderなどの3D編集ソフトでモデルを確認・修正。

## Privacy

STLファイルは使用中のブラウザ内で解析。
STLデータそのものをGitHubや外部サーバーへアップロード・保存する処理はなし。

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
