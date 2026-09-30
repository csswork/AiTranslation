/**
 * 宣传站脚本。
 *
 * 一条原则：不监听 scroll。视差交给 CSS 滚动驱动动画（跑在合成器线程上），
 * 这里剩下的三件事全部用 IntersectionObserver，主线程只在状态真正变化时才醒一下。
 *
 *   1. 导航吸顶状态 —— 顶部一个哨兵离开视口就给 .nav 打标记
 *   2. 演示视频 —— 快进视口时才创建 <video>，进入播放、离开暂停；
 *      文件还没放进来就静默留住占位层，不出现破图
 *   3. 淡入兜底 —— 浏览器不支持 animation-timeline: view() 时才接手
 *
 * 另外有配色切换：只在点击按钮、或系统切换明暗时才运行；
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

  /* ------------------------------------------------------------ 配色切换 */

  /*
   * 默认跟随系统，纯 CSS 完成（color-scheme: light dark + light-dark()）。
   * 手动切换后把选择写进 localStorage，<head> 里的内联脚本在首次绘制前读回来，
   * 所以刷新、换页都不会先闪一下另一套配色。
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
    try {
      if (root.dataset.theme) localStorage.setItem('theme', theme);
      else localStorage.removeItem('theme');
    } catch {
      /* 隐私模式等存不了：这一页里照样生效，只是不记住 */
    }
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

  if (frames.length && hasIO) {
    /* 进入视口播放，离开暂停。省电，也免得后台几段视频一起跑。 */
    const playback = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const video = entry.target;
          if (entry.isIntersecting) {
            const started = video.play();
            // 浏览器可能因为自动播放策略拒绝，静默吞掉即可
            if (started && typeof started.catch === 'function') started.catch(() => {});
          } else {
            video.pause();
          }
        }
      },
      { threshold: 0.25 },
    );

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
      video.preload = 'metadata';
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      video.setAttribute('aria-label', '功能演示');
      // 用户要求减少动效时不自动播放，改成给一套控件让他自己决定
      if (reduceMotion) video.controls = true;

      video.addEventListener(
        'loadeddata',
        () => {
          // 占位用的静态图让位给视频，两者不叠在一起
          body.querySelectorAll('img').forEach((img) => img.remove());
          frame.classList.add('has-media');
          video.classList.add('is-ready'); // 淡入，避免第一帧闪一下黑
          dropLoading();
          if (!reduceMotion) playback.observe(video);
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

    /* 离视口还有一屏的时候才开始加载，首屏不为下面的视频买单 */
    const lazy = new IntersectionObserver(
      (entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          attach(entry.target);
        }
      },
      { rootMargin: '300px 0px' },
    );

    frames.forEach((frame) => lazy.observe(frame));
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
