/** 点数只作展示；计费与精确余额均由服务器处理。兼容升级前的数字缓存。 */
(() => {
  globalThis.AITrCredits = {
    format(value) {
      return new Intl.NumberFormat(AITrI18n.locale(), {
        minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false,
      }).format(Number(value) || 0);
    },
    available(credits) {
      // 显示为 0.00 时也可能剩有可用额度，不能拿舍入后的显示值作判断。
      return typeof credits?.available === 'boolean' ? credits.available : Number(credits?.balance || 0) > 0;
    },
  };
})();
