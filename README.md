# stl-yabai

A lightweight browser-based STL checker for 3D printing.

STLファイルをブラウザ上で読み込み、3Dプリント前に確認しておきたい基本的なメッシュ不備を簡易チェックします。

## Features

現在、以下の項目を確認できます。

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

1. Webアプリを開きます。
2. STLファイルをドラッグ＆ドロップ、またはファイル選択から読み込みます。
3. 解析結果を確認します。
4. 問題が検出された場合は、Blenderなどの3D編集ソフトでモデルを確認・修正してください。

## Privacy

STLファイルは使用中のブラウザ内で解析されます。

STLデータそのものをGitHubや外部サーバーへアップロード・保存する処理は実装していません。

## Limitations

このツールは、3Dプリント前の簡易チェックを目的としています。

以下の項目は現在判定していません。

- 自己交差
- 最小肉厚
- オーバーハング
- サポート材の必要性
- プリンター固有の造形可能サイズ
- スライサー固有のエラー
- 実際の造形成功可否

また、STL形式には単位情報が含まれないため、寸法表示では数値をmmとして扱っています。

「問題なし」と表示された場合でも、造形成功を保証するものではありません。必要に応じてBlender、スライサー、その他のメッシュ検証ツールでも確認してください。

## Development

This project is a small independent utility intended for educational and personal fabrication workflows.

The project was developed with assistance from generative AI tools. Generated code has been reviewed and adapted for this project.

## License

No open-source license is currently granted for this repository.

The licensing status of this project may be updated in the future.
