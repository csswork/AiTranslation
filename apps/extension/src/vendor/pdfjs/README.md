# pdf.js（第三方，勿手改）

来源：npm `pdfjs-dist@6.3.289`（Mozilla，Apache-2.0，见 `LICENSE`）。只供 `src/pdf/` 整份 PDF 翻译页使用。

保留的文件：`legacy/build/pdf.mjs`、`legacy/build/pdf.worker.mjs`（legacy 构建带兼容补丁，扩展最低支持 Chrome 116；标准构建依赖更新的 JS 特性）、`cmaps/`、`standard_fonts/`，
以及 `wasm/` 里 JPEG 2000 与 JBIG2 的纯 JS 解码回退（页面以 `useWasm: false` 加载，
不需要为扩展页面放开 `wasm-unsafe-eval`）。升级时整目录替换并同步本说明里的版本号。

2026-11-15：为处理 Chrome 商店 Red Titanium 可读性警告，改用同版本官方未压缩 legacy 文件，并保留对应 source map。所有上游文件均原样复制，没有解压后重新格式化或修改。npm tarball SHA-512：`ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw==`。
