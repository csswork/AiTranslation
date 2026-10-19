/**
 * 宣传站脚本。
 *
 * 一条原则：不监听 scroll。视差交给 CSS 滚动驱动动画（跑在合成器线程上），
 * 翻页是 CSS Scroll Snap。这里剩下的四件事全部用 IntersectionObserver，主线程只在状态真正变化时才醒一下。
 *
 *   1. 导航吸顶状态 —— 顶部一个哨兵离开视口就给 .nav 打标记
 *   2. 演示视频 —— 离视口一屏时才创建 <video>，大半进入视口才从头播放，离开或切走标签页就暂停；
 *      文件还没放进来就静默留住占位层，不出现破图
 *   3. 全屏分页 —— 右侧圆点与导航高亮跟着当前屏走
 *   4. 淡入兜底 —— 浏览器不支持 animation-timeline: view() 时才接手
 *
 * 另外有安装按钮：装不了 Chrome 扩展的浏览器改去安装说明；
 * 账户入口：载入时读取一次用户端的登录状态；
 * 配色切换：只在点击按钮、或系统切换明暗时才运行；
 * 以及首屏示意图的译文逐段流出：载入时跑一次，几秒后就结束。
 */
(() => {
  'use strict';

  const reduceMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasIO = 'IntersectionObserver' in window;

  /* ------------------------------------------------------------ 导航吸顶 */

  const nav = document.querySelector('.nav');
  const sentinel = document.querySelector('[data-nav-sentinel]');
  if (nav && sentinel && hasIO) {
    new IntersectionObserver(
      ([entry]) => {
        nav.dataset.stuck = entry.isIntersecting ? 'false' : 'true';
      },
      { threshold: 0 },
    ).observe(sentinel);
  }

  /* ------------------------------------------------------------ 安装按钮 */

  /*
   * 网页无法替用户安装扩展（Chrome 2018 年起取消了站外内联安装），只能把人送到 Chrome 应用商店详情页，
   * 由用户自己点「添加至 Chrome」。首屏按钮在 HTML 里默认就指向商店（没有脚本也能用），这里只处理例外：
   * Firefox、Safari 等装不了 Chrome 扩展，手机上的 Chrome 也不支持扩展——这些情况改为跳到页面下方的
   * 安装说明，并在按钮下方提示换用电脑上的 Chromium 内核浏览器（Chrome、Edge、Brave、Opera…）。
   */
  const isChromium = (() => {
    const brands = navigator.userAgentData && navigator.userAgentData.brands;
    if (brands && brands.length) return brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/.test(b.brand));
    return /\b(Chrome|Chromium|CriOS|Edg)\//.test(navigator.userAgent) && !/\bFirefox\//.test(navigator.userAgent);
  })();
  const isMobile = (navigator.userAgentData && navigator.userAgentData.mobile) || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (!isChromium || isMobile) {
    document.querySelectorAll('[data-install]').forEach((button) => {
      button.href = '#install';
      button.removeAttribute('target');
      button.removeAttribute('rel');
    });
    const installNote = document.querySelector('[data-install-note]');
    if (installNote) installNote.hidden = false;
  }

  /* ------------------------------------------------------------ 账户入口 */

  /*
   * 登录与账户页面在 VPS 用户端（apps/backend）。这里只带 credentials 读取它的登录状态：
   * 官网与用户端同属一个站点，浏览器会附上用户端的会话 Cookie；服务端按来源白名单返回 CORS。
   * 未登录显示「登录」（登录后回到当前页面），已登录显示用户名并链接到账户页；
   * 用户端未配置或读取失败时入口保持隐藏，不出现无法打开的链接。
   * 生产环境的用户端（app.huaci.app）上线后，在这里填入地址，并把它加入 vercel.json 的 connect-src。
   */
  const ACCOUNT_ORIGIN = ['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://localhost:8787' : '';
  const accountLink = document.querySelector('[data-account]');
  if (accountLink) {
    accountLink.addEventListener('click', (event) => {
      if (!accountLink.classList.contains('is-login') || event.defaultPrevented || event.button !== 0
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (accountLink.getAttribute('aria-busy') === 'true') { event.preventDefault(); return; }
      accountLink.setAttribute('aria-busy', 'true');
      accountLink.setAttribute('aria-disabled', 'true');
    });
    window.addEventListener('pageshow', () => {
      accountLink.removeAttribute('aria-busy');
      accountLink.removeAttribute('aria-disabled');
    });
  }
  if (accountLink && ACCOUNT_ORIGIN && window.fetch) {
    fetch(`${ACCOUNT_ORIGIN}/api/web/session`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((state) => {
        if (state.signedIn) {
          // 首字母圆标 + 用户名（与用户端页头相同的结构）；用 textContent，不拼接 HTML
          const avatar = document.createElement('span');
          avatar.className = 'account-avatar';
          avatar.setAttribute('aria-hidden', 'true');
          avatar.textContent = (state.username[0] || '?').toUpperCase();
          const name = document.createElement('span');
          name.className = 'account-name';
          name.textContent = state.username;
          accountLink.replaceChildren(avatar, name);
          accountLink.classList.replace('is-login', 'is-user');
          accountLink.title = state.username;
          accountLink.href = state.accountUrl;
        } else {
          const login = new URL(state.loginUrl);
          login.searchParams.set('return', location.href);
          accountLink.href = login.href;
        }
        accountLink.hidden = false;
      })
      .catch(() => {
        /* 用户端没启动或网络不通：保持隐藏 */
      });
  }

  /* ------------------------------------------------------------ 配色切换 */

  /*
   * 默认跟随系统，纯 CSS 完成（color-scheme: light dark + light-dark()）。
   * 手动切换后把选择写进 theme Cookie，<head> 里的内联脚本在首次绘制前读回来，
   * 所以刷新、换页都不会先闪一下另一套配色。偏好存在与用户端共用的 theme Cookie 里。
   * 切到和系统一致的那一套时清掉记录：等于回到「跟随系统」，以后系统怎么变就怎么变。
   */
  const root = document.documentElement;
  const toggle = document.querySelector('[data-theme-toggle]');
  const systemDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  // theme-color 有深浅两条、各带 media。手动选了配色时两条都改成那一套，
  // 否则浏览器地址栏会按系统取色、和页面对不上；回到跟随系统时还原
  const themeMetas = [...document.querySelectorAll('meta[name="theme-color"]')];
  const metaColor = {};
  themeMetas.forEach((meta) => {
    meta.dataset.auto = meta.content;
    metaColor[meta.media.includes('light') ? 'light' : 'dark'] = meta.content;
  });

  // 配色偏好与用户端（app.huaci.app）共用 theme Cookie：在 huaci.app 上写到父域，两个站点看到同一份；
  // 其他主机（本地、预览部署）只写本主机。以前存在 localStorage 的选择迁移过来一次。
  const cookieDomain = /(^|\.)huaci\.app$/.test(location.hostname) ? '; Domain=huaci.app' : '';
  const cookieAttrs = `; Path=/; SameSite=Lax${cookieDomain}${location.protocol === 'https:' ? '; Secure' : ''}`;
  const writeThemeCookie = (theme) => {
    document.cookie = theme ? `theme=${theme}; Max-Age=31536000${cookieAttrs}` : `theme=; Max-Age=0${cookieAttrs}`;
  };
  try {
    const legacy = localStorage.getItem('theme');
    if (legacy) {
      if (!/(?:^|; )theme=/.test(document.cookie) && (legacy === 'light' || legacy === 'dark')) writeThemeCookie(legacy);
      localStorage.removeItem('theme');
    }
  } catch {
    /* 存储不可用：只用 Cookie */
  }

  const systemTheme = () => (systemDark && systemDark.matches ? 'dark' : 'light');
  const currentTheme = () => root.dataset.theme || systemTheme();

  const syncThemeUi = () => {
    if (toggle) {
      const label = currentTheme() === 'dark' ? '切换到浅色' : '切换到深色';
      toggle.setAttribute('aria-label', label);
      toggle.title = label;
    }
    const forced = root.dataset.theme;
    themeMetas.forEach((meta) => {
      meta.content = (forced && metaColor[forced]) || meta.dataset.auto;
    });
  };

  const setTheme = (theme) => {
    if (theme === systemTheme()) delete root.dataset.theme;
    else root.dataset.theme = theme;
    writeThemeCookie(root.dataset.theme || null);
    syncThemeUi();
  };

  if (toggle) {
    toggle.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      // 支持 View Transitions 的浏览器里两套配色交叉淡入，其余直接切
      if (document.startViewTransition && !reduceMotion) {
        const transition = document.startViewTransition(() => setTheme(next));
        // 页面在后台、或连点把上一次顶掉时，过渡会被跳过、ready 随之 reject。
        // 配色照样已经切好了，只是没有淡入，吞掉即可，别在控制台留未处理的错误
        transition.ready.catch(() => {});
      } else {
        setTheme(next);
      }
    });
  }
  // 跟随系统时系统切了明暗：图标由 CSS 自己换，这里只更新按钮文字
  if (systemDark && systemDark.addEventListener) systemDark.addEventListener('change', syncThemeUi);
  syncThemeUi();

  /* ------------------------------------------------ 首屏示意图：译文逐段流出 */

  /*
   * 拖选、弹窗淡入是 CSS 动画（styles.css「首屏示意图」），这里只接最后一步：
   * 等弹窗淡入播完，把译文像接口流式返回那样一小段一小段放出来，光标跟在最后一个字后面。
   * 光标位置按浏览器实际排出的字宽算（getComputedTextLength），换了字体也不会错位。
   * 拿不到弹窗的淡入动画（减少动效、浏览器太老、脚本来得太晚）就什么都不做，译文保持整段。
   */
  const preview = document.querySelector('.pv');
  const previewPopup = preview && preview.querySelector('.pv-popup');
  const popIn =
    previewPopup && typeof previewPopup.getAnimations === 'function'
      ? previewPopup.getAnimations().find((a) => a.animationName === 'pv-pop-in')
      : null;

  if (popIn && popIn.playState !== 'finished') {
    const lines = [...preview.querySelectorAll('.pv-stream')];
    const caret = preview.querySelector('.pv-caret');
    const texts = lines.map((line) => line.textContent);
    const CARET_GAP = 7.5; // 光标离最后一个字的距离，与原稿一致
    const CARET_RISE = 13; // 光标顶端在基线之上多少

    const placeCaret = (line) => {
      if (!caret || !line) return;
      const x = Number(line.getAttribute('x')) + line.getComputedTextLength() + CARET_GAP;
      caret.setAttribute('x', x.toFixed(1));
      caret.setAttribute('y', String(Number(line.getAttribute('y')) - CARET_RISE));
    };
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // 弹窗这时还是透明的，清空这一步看不见
    lines.forEach((line) => {
      line.textContent = '';
    });
    placeCaret(lines[0]);

    popIn.finished
      .then(async () => {
        await sleep(280); // 弹窗出现后停一拍，像在等接口的第一个字
        preview.classList.add('is-typing');
        for (let i = 0; i < lines.length; i++) {
          const text = texts[i];
          let shown = 0;
          while (shown < text.length) {
            // 流式接口一次吐 1～3 个字、间隔也不均匀，比匀速的打字机更像真的
            shown = Math.min(text.length, shown + 1 + Math.floor(Math.random() * 3));
            lines[i].textContent = text.slice(0, shown);
            placeCaret(lines[i]);
            await sleep(45 + Math.random() * 55);
          }
        }
      })
      .catch(() => {
        /* 动画被取消（元素被隐藏等）：交给 finally 补全 */
      })
      .finally(() => {
        // 无论怎样结束，都把译文补全、光标放回末尾，绝不停在半截
        lines.forEach((line, i) => {
          line.textContent = texts[i];
        });
        placeCaret(lines[lines.length - 1]);
        preview.classList.remove('is-typing');
      });
  }

  /* -------------------------------------------------------------- 演示视频 */

  const frames = document.querySelectorAll('.frame[data-video]');

  // 用户开了「省流量」：不预先拉视频、不自动播放，给一套控件让他自己点
  const saveData = Boolean(navigator.connection && navigator.connection.saveData);
  const manual = reduceMotion || saveData;

  if (frames.length && hasIO) {
    /*
     * 播放只在演示真正到位时发生：大半个展示框进入视口（全屏分页里就是这一屏停稳）才开始，
     * 每次进来都从头播，让人看到完整的一遍；离开视口或切到别的标签页立刻暂停。
     */
    const visible = new Set();
    const play = (video) => {
      const started = video.play();
      // 浏览器可能因为自动播放策略拒绝，静默吞掉即可
      if (started && typeof started.catch === 'function') started.catch(() => {});
    };
    const playback = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const video = entry.target;
          if (entry.isIntersecting) {
            visible.add(video);
            video.currentTime = 0;
            if (!document.hidden) play(video);
          } else {
            visible.delete(video);
            video.pause();
          }
        }
      },
      { threshold: 0.6 },
    );
    document.addEventListener('visibilitychange', () => {
      visible.forEach((video) => (document.hidden ? video.pause() : play(video)));
    });

    /**
     * 挂上视频。文件不存在时（用户还没把录屏放进 assets/）
     * error 事件会把它摘掉，CSS 里的 .ph 占位层原样留着。
     *
     * 等待期间压一层转圈：视频是滚到视口附近才开始拉的，
     * 这一两秒里如果什么都不给，展示框就是一块空白。
     */
    const attach = (frame) => {
      const src = frame.dataset.video;
      const body = frame.querySelector('.frame-body');
      if (!src || !body) return;

      const loading = document.createElement('div');
      loading.className = 'frame-loading';
      loading.setAttribute('aria-hidden', 'true');
      loading.innerHTML = '<span class="ring"></span>';
      body.appendChild(loading);

      const dropLoading = () => {
        loading.classList.add('is-gone');
        loading.addEventListener('transitionend', () => loading.remove(), { once: true });
        // 万一 transitionend 没来（元素被隐藏等），兜一个底
        setTimeout(() => loading.remove(), 800);
      };

      const video = document.createElement('video');
      video.muted = true; // 必须在 play() 之前，否则自动播放会被拦
      video.loop = true;
      video.playsInline = true;
      // 已经离这一屏只差一屏了：正常情况直接拉够能播的数据；省流量时只拿首帧和时长
      video.preload = manual ? 'metadata' : 'auto';
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      video.setAttribute('aria-label', '功能演示');
      // 减少动效或省流量时不自动播放，改成给一套控件让用户自己决定
      if (manual) video.controls = true;

      video.addEventListener(
        'loadeddata',
        () => {
          // 占位用的静态图让位给视频，两者不叠在一起
          body.querySelectorAll('img').forEach((img) => img.remove());
          frame.classList.add('has-media');
          video.classList.add('is-ready'); // 淡入，避免第一帧闪一下黑
          dropLoading();
          if (!manual) playback.observe(video);
        },
        { once: true },
      );

      video.addEventListener(
        'error',
        () => {
          video.remove();
          dropLoading();
        },
        { once: true },
      );

      video.src = src;
      body.appendChild(video);
    };

    /* 离视口还有一屏的时候才开始加载（全屏分页里就是「下一屏」），首屏不为下面的视频买单 */
    const lazy = new IntersectionObserver(
      (entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          attach(entry.target);
        }
      },
      { rootMargin: '0px 0px 100% 0px' },
    );

    frames.forEach((frame) => lazy.observe(frame));
  }

  /* ---------------------------------------------------------- 全屏分页 */

  /*
   * 翻页本身是 CSS Scroll Snap，这里只做两件辅助的事：
   *   · 右侧圆点：每屏一个，标签取这屏自己的标题（各语言页面已经译好），点了滚过去；
   *   · 当前位置：哪一屏占住视口中线，就点亮它的圆点和导航里对应的链接。
   * 都靠 IntersectionObserver，状态变了才运行。
   */
  const slides = [...document.querySelectorAll('[data-slide]')];
  const foot = document.querySelector('.foot');
  if (document.body.classList.contains('fullpage') && slides.length && hasIO) {
    // 导航在窄屏上会折成两行，页脚高度随语言变：实测后写进 CSS 变量，翻页落点和最后一屏才准。
    // 同时检查有没有哪一屏比视口还高（长语言、矮窗口）：有就改成就近吸附（styles.css 的 snap-loose）
    if ('ResizeObserver' in window) {
      const html = document.documentElement;
      const update = () => {
        const navHeight = nav ? nav.offsetHeight : 0;
        if (nav) html.style.setProperty('--nav-h', `${navHeight}px`);
        if (foot) html.style.setProperty('--foot-h', `${foot.offsetHeight}px`);
        const room = window.innerHeight - navHeight + 2;
        html.classList.toggle('snap-loose', slides.some((slide) => slide.offsetHeight > room));
      };
      const measure = new ResizeObserver(update);
      [nav, foot, ...slides].forEach((el) => el && measure.observe(el));
      window.addEventListener('load', update, { once: true }); // 字体与图片到齐后再量一次
    }

    const pager = document.createElement('div');
    pager.className = 'pager';
    const dots = slides.map((slide) => {
      const heading = slide.querySelector('h1, h2, h3');
      const label = heading ? heading.textContent.replace(/\s+/g, ' ').trim() : '';
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.dataset.label = label;
      dot.setAttribute('aria-label', label);
      dot.addEventListener('click', () => {
        slide.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      });
      pager.appendChild(dot);
      return dot;
    });
    document.body.appendChild(pager);

    // 屏 → 导航链接：功能的四屏都算「功能」
    const navLinks = [...document.querySelectorAll('.nav-links a[href^="#"]')];
    const linkFor = (slide) => {
      const section = slide.closest('[id]');
      return section ? navLinks.find((a) => a.getAttribute('href') === `#${section.id}`) : null;
    };

    const current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = slides.indexOf(entry.target);
          dots.forEach((dot, i) => dot.setAttribute('aria-current', String(i === index)));
          const link = linkFor(entry.target);
          navLinks.forEach((a) => {
            if (a === link) a.setAttribute('aria-current', 'true');
            else a.removeAttribute('aria-current');
          });
        }
      },
      // 只看视口中间一条 1% 高的带子：哪屏压在中线上，哪屏就是当前屏（高度为 0 的根区域判不出相交）
      { rootMargin: '-49% 0px -50% 0px', threshold: 0 },
    );
    slides.forEach((slide) => current.observe(slide));
  }

  /* ---------------------------------------------------------- 淡入兜底 */

  /* 支持滚动驱动动画的浏览器里，淡入全由 CSS 完成，这里什么都不做。 */
  const supportsScrollTimeline =
    window.CSS && typeof CSS.supports === 'function' && CSS.supports('animation-timeline: view()');

  if (!supportsScrollTimeline && !reduceMotion) {
    const reveals = document.querySelectorAll('.reveal');
    if (!reveals.length) return;

    if (!hasIO) {
      // 连 IntersectionObserver 都没有：直接显示，绝不把内容留在 opacity: 0
      reveals.forEach((el) => el.classList.add('is-in'));
      return;
    }

    const fade = new IntersectionObserver(
      (entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target); // 一次性，滚回去不重放
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );

    reveals.forEach((el) => fade.observe(el));
  }
})();
