(() => {
  const R = globalThis.AITrRules;
  const el = {
    list: document.getElementById('list'),
    empty: document.getElementById('empty'),
    count: document.getElementById('count'),
    clearAll: document.getElementById('clearAll'),
    options: document.getElementById('options'),
  };

  let rules = {};

  const formatDate = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };

  function render() {
    const hosts = Object.keys(rules).sort();
    const total = hosts.reduce((sum, host) => sum + rules[host].length, 0);

    el.count.textContent = total
      ? `${hosts.length} 个网站，共 ${total} 条规则`
      : '';
    el.empty.hidden = total > 0;
    el.clearAll.hidden = total === 0;

    el.list.replaceChildren(
      ...hosts.map((host) => {
        const card = document.createElement('section');
        card.className = 'host';

        const head = document.createElement('div');
        head.className = 'host-head';

        const name = document.createElement('span');
        name.className = 'host-name';
        name.textContent = host;

        const badge = document.createElement('span');
        badge.className = 'host-count';
        badge.textContent = `${rules[host].length} 条`;

        const removeHost = document.createElement('button');
        removeHost.type = 'button';
        removeHost.className = 'btn danger small';
        removeHost.textContent = '删除整站';
        removeHost.addEventListener('click', async () => {
          if (!confirm(`删除 ${host} 下的全部 ${rules[host].length} 条规则？`)) return;
          rules = await R.removeHost(host);
          render();
        });

        head.append(name, badge, removeHost);
        card.appendChild(head);

        for (const rule of rules[host]) {
          const row = document.createElement('div');
          row.className = 'rule';

          const main = document.createElement('div');
          main.className = 'rule-main';
          const label = document.createElement('div');
          label.className = 'rule-label';
          label.textContent = rule.label;
          const selector = document.createElement('div');
          selector.className = 'rule-selector';
          selector.textContent = rule.selector;
          main.append(label, selector);

          const date = document.createElement('span');
          date.className = 'rule-date';
          date.textContent = formatDate(rule.createdAt);

          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'btn ghost small';
          remove.textContent = '删除';
          remove.addEventListener('click', async () => {
            rules = await R.removeRule(host, rule.id);
            render();
          });

          row.append(main, date, remove);
          card.appendChild(row);
        }
        return card;
      })
    );
  }

  el.clearAll.addEventListener('click', async () => {
    if (!confirm('清空全部网站的元素翻译规则？此操作无法撤销。')) return;
    rules = await R.clearAll();
    render();
  });

  el.options.addEventListener('click', () => chrome.runtime.openOptionsPage());

  // 在网页上新增规则后，这个页面若开着应当立即反映出来
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !changes[R.STORE_KEY]) return;
    rules = await R.loadRules();
    render();
  });

  (async () => {
    rules = await R.loadRules();
    render();
  })();
})();
