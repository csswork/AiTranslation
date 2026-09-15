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
     */
    const attach = (frame) => {
      const src = frame.dataset.video;
      const body = frame.querySelector('.frame-body');
      if (!src || !body) return;

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
          if (!reduceMotion) playback.observe(video);
        },
        { once: true },
      );

      video.addEventListener(
        'error',
        () => {
          video.remove();
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
