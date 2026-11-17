// pdf.js worker 入口：先补上标准构建需要的 API，再载入原样引入的 pdf.worker.mjs。
// 转出导出项，pdf.js 退回主线程「假 worker」时也能从这里拿到 WorkerMessageHandler。
import './compat.js';
export * from '../vendor/pdfjs/pdf.worker.mjs';
