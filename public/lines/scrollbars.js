// Scroll bars show only while their box scrolls: this marks the box, lines.css draws the thumb for it.
// It runs in the head and listens on the whole page, so boxes drawn later are covered too.
(() => {
  const HIDE_AFTER = 900, timers = new WeakMap();
  addEventListener('scroll', e => {
    const box = e.target === document ? document.scrollingElement : e.target;
    if (!(box instanceof Element)) return;
    box.classList.add('is-scrolling');
    clearTimeout(timers.get(box));
    timers.set(box, setTimeout(() => box.classList.remove('is-scrolling'), HIDE_AFTER));
  }, { capture: true, passive: true });
})();
