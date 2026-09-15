(() => {
  const R = globalThis.AITrRules;
  const el = {
    list: document.getElementById('list'),
    empty: document.getElementById('empty'),
    count: document.getElementById('count'),
    clearAll: document.getElementById('clearAll'),
    addRule: document.getElementById('addRule'),
    options: document.getElementById('options'),
  };

  let rules = {};

  const formatDate = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };

  /** 正在编辑的规则 id；同一时刻只允许编辑一条。 */
  let editingId = null;
  /**
   * 正在新增：{ host } —— host 为 null 表示「新站点」，需要同时填域名。
   * 与编辑互斥，避免两个输入框同时开着。
   */
  let adding = null;

  const isEditingOrAdding = () => Boolean(editingId || adding);

  /**
   * 选择器写进去之前必须验一次：非法选择器会被 applyRules 的 try/catch
   * 静默跳过，整条规则失效且没有任何提示。
   */
  function invalidSelector(value) {
    if (!value) return '选择器不能为空';
    try {
      document.querySelector(value);
    } catch {
      return '这不是合法的 CSS 选择器';
    }
    return null;
  }

  /**
   * 把用户填的域名整理成存储用的形式。
   * 允许直接粘贴完整网址或带路径、端口的写法。
   */
  function normalizeHostInput(value) {
    let text = String(value || '').trim();
    if (!text) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
      try {
        text = new URL(text).hostname;
      } catch {
        return null;
      }
    } else {
      text = text.split('/')[0];
    }
    text = text.replace(/:\d+$/, '');
    if (!text || /\s/.test(text)) return null;
    return R.hostKey(text);
  }

  const button = (text, className, onClick) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = className;
    node.textContent = text;
    node.addEventListener('click', onClick);
    return node;
  };

  function displayRow(host, rule) {
    const row = document.createElement('div');
    row.className = 'rule';

    const main = document.createElement('div');
    main.className = 'rule-main';
    const selector = document.createElement('div');
    selector.className = 'rule-selector';
    selector.textContent = rule.selector;
    main.appendChild(selector);

    const date = document.createElement('span');
    date.className = 'rule-date';
    date.textContent = formatDate(rule.createdAt);

    row.append(
      main,
      date,
      button('编辑', 'btn ghost small', () => {
        editingId = rule.id;
        adding = null;
        render();
      }),
      button('删除', 'btn ghost small', async () => {
        rules = await R.removeRule(host, rule.id);
        render();
      })
    );
    return row;
  }

  function editRow(host, rule) {
    const row = document.createElement('div');
    row.className = 'rule editing';

    const main = document.createElement('div');
    main.className = 'rule-main';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rule-input';
    input.value = rule.selector;
    input.spellcheck = false;
    input.setAttribute('aria-label', 'CSS 选择器');

    const error = document.createElement('div');
    error.className = 'rule-error';
    error.hidden = true;

    main.append(input, error);

    // 出错时只更新这行提示，不重绘——重绘会重建输入框，用户刚输入的内容就没了
    const fail = (message) => {
      error.textContent = message;
      error.hidden = false;
      input.focus();
    };

    const cancel = () => {
      editingId = null;
      render();
    };

    const save = async () => {
      const value = input.value.trim();
      const problem = invalidSelector(value);
      if (problem) return fail(problem);
      const result = await R.updateRule(host, rule.id, value);
      if (!result.ok) return fail(result.error);
      rules = result.rules;
      editingId = null;
      render();
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        save();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    });

    row.append(
      main,
      button('保存', 'btn small', save),
      button('取消', 'btn ghost small', cancel)
    );
    // 进入编辑就把光标放进去，省一次点击
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
    return row;
  }

  /**
   * 新增规则的表单行。
   * @param {string|null} host 为 null 时表示新站点，额外要求填域名
   */
  function addRow(host) {
    const row = document.createElement('div');
    row.className = 'rule editing adding';

    const main = document.createElement('div');
    main.className = 'rule-main';

    let hostInput = null;
    if (host === null) {
      hostInput = document.createElement('input');
      hostInput.type = 'text';
      hostInput.className = 'rule-input';
      hostInput.placeholder = '域名，例如 example.com（也可直接粘贴网址）';
      hostInput.spellcheck = false;
      hostInput.setAttribute('aria-label', '域名');
      main.appendChild(hostInput);
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rule-input';
    input.placeholder = 'CSS 选择器，例如 div#main > article.post > p';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'CSS 选择器');
    main.appendChild(input);

    const error = document.createElement('div');
    error.className = 'rule-error';
    error.hidden = true;
    main.appendChild(error);

    // 同上：出错不重绘，否则已填的域名和选择器都会被清空
    const fail = (message, field) => {
      error.textContent = message;
      error.hidden = false;
      (field || input).focus();
    };

    const cancel = () => {
      adding = null;
      render();
    };

    const submit = async () => {
      const targetHost = host === null ? normalizeHostInput(hostInput.value) : host;
      if (!targetHost) return fail('请填写有效的域名', hostInput);
      const value = input.value.trim();
      const problem = invalidSelector(value);
      if (problem) return fail(problem);

      const result = await R.addRule(targetHost, value);
      if (!result) return fail('无法添加这条规则');
      if (result.full) {
        return fail(`${targetHost} 的规则已达上限（${R.MAX_RULES_PER_HOST} 条）`);
      }
      if (!result.added) return fail('这个网站下已经有相同的选择器');

      rules = result.rules;
      adding = null;
      render();
    };

    for (const field of [hostInput, input].filter(Boolean)) {
      field.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          submit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      });
    }

    row.append(main, button('添加', 'btn small', submit), button('取消', 'btn ghost small', cancel));
    queueMicrotask(() => (hostInput || input).focus());
    return row;
  }

  function render() {
    const hosts = Object.keys(rules).sort();
    const total = hosts.reduce((sum, host) => sum + rules[host].length, 0);

    el.count.textContent = total
      ? `${hosts.length} 个网站，共 ${total} 条规则`
      : '';
    // 正在填新站点表单时别显示空状态，否则「还没有任何规则」会压在表单旁边
    el.empty.hidden = total > 0 || Boolean(adding);
    el.clearAll.hidden = total === 0;
    el.addRule.disabled = isEditingOrAdding();

    const cards = hosts.map((host) => {
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

        head.append(
          name,
          badge,
          button('添加', 'btn ghost small', () => {
            editingId = null;
            adding = { host };
            render();
          }),
          removeHost
        );
        card.appendChild(head);

        for (const rule of rules[host]) {
          card.appendChild(
            editingId === rule.id ? editRow(host, rule) : displayRow(host, rule)
          );
        }
        if (adding && adding.host === host) card.appendChild(addRow(host));
        return card;
      });

    // 新站点的表单单独成一张卡片，放在最前面
    if (adding && adding.host === null) {
      const card = document.createElement('section');
      card.className = 'host';
      const head = document.createElement('div');
      head.className = 'host-head';
      const name = document.createElement('span');
      name.className = 'host-name';
      name.textContent = '新增规则';
      head.appendChild(name);
      card.append(head, addRow(null));
      cards.unshift(card);
    }

    el.list.replaceChildren(...cards);
  }

  el.addRule.addEventListener('click', () => {
    editingId = null;
    adding = { host: null };
    render();
  });

  el.clearAll.addEventListener('click', async () => {
    if (!confirm('清空全部网站的元素翻译规则？此操作无法撤销。')) return;
    rules = await R.clearAll();
    render();
  });

  el.options.addEventListener('click', () => chrome.runtime.openOptionsPage());

  // 在网页上新增规则后，这个页面若开着应当立即反映出来
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !changes[R.STORE_KEY]) return;
    // 正在编辑或新增时不要重绘：输入框会被重建，已输入的内容就没了
    if (isEditingOrAdding()) return;
    rules = await R.loadRules();
    render();
  });

  (async () => {
    rules = await R.loadRules();
    render();
  })();
})();
