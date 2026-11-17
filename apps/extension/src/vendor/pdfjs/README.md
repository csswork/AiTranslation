# pdf.js（第三方，勿手改）

来源：npm `pdfjs-dist@6.3.289`（Mozilla，Apache-2.0，见 `LICENSE`）。只供 `src/pdf/` 整份 PDF 翻译页使用。

保留的文件：标准构建 `build/pdf.mjs`、`build/pdf.worker.mjs` 及其 source map、`cmaps/`、`standard_fonts/`。
标准构建会直接调用几项比扩展最低版本（Chrome 128）更新的内置 API，由扩展自己的 `src/pdf/compat.js` 在缺少时补上；
worker 入口是 `src/pdf/worker.mjs`（先载入补丁再载入本目录的 `pdf.worker.mjs`）。
不保留 `wasm/`：页面以 `useWasm: false` 加载，不放开 `wasm-unsafe-eval`；JPEG 2000 与 JBIG2 图片因此不解码，不影响文字提取。
升级时整目录替换并同步本说明里的版本号。

2026-11-15：为处理 Chrome 商店 Red Titanium 可读性警告，改用同版本官方未压缩 legacy 文件，并保留对应 source map。所有上游文件均原样复制，没有解压后重新格式化或修改。

2026-11-17：2.3.0 草稿再次被 Red Titanium 拒审，点名 legacy `pdf.mjs` 里打包的 core-js 垫片（拼接 `'java' + SCRIPT + ':'` 的旧 IE 兼容代码）。改用同版本标准构建（不含 core-js），删去单行压缩的 `wasm/*_nowasm_fallback.js`，扩展最低版本提升到 Chrome 128。npm tarball SHA-512：`ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw==`。
