(() => {
  const root = document.querySelector('.landing');
  const { gsap, ScrollTrigger, SplitText } = window;
  if (!root || !gsap || !ScrollTrigger || !SplitText) return;
  gsap.registerPlugin(ScrollTrigger, SplitText);
  const find = (selector) => root.querySelector(selector);
  const media = gsap.matchMedia();
  media.add('(prefers-reduced-motion: no-preference)', () => {
    const desktop = matchMedia('(min-width: 761px)').matches;
    let introduced = false;
    const heading = SplitText.create(find('#home-title'), {
      type: 'lines', mask: 'lines', linesClass: 'split-line', autoSplit: true, aria: 'auto',
      onSplit(self) {
        if (introduced || find('.ribbon-hero').getBoundingClientRect().bottom < 0) return;
        return gsap.timeline({
          defaults: { ease: 'power3.out' }, onComplete: () => { introduced = true; },
        })
          .from(self.lines, { yPercent: 105, duration: .72, stagger: .09 }, 0)
          .from(find('.hero-copy p'), { y: 10, duration: .44 }, .27)
          .from('.ribbon-stack a', { x: desktop ? 25 : 8, y: 10, rotation: -1.5, duration: .55, stagger: .09 }, .22);
      },
    });
    gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: {
      trigger: '.workflow', start: 'top 82%', end: 'bottom 64%', scrub: .35, invalidateOnRefresh: true,
    } })
      .from('.path-fill', { scaleX: 0 }, 0)
      .from('.path-arrow', { x: () => -Math.max(0, find('.workflow-path').clientWidth - 6) }, 0);
    gsap.from('.workflow-step', { y: 16, duration: .54, stagger: .12, scrollTrigger: {
      trigger: '.workflow-grid', start: 'top 86%', once: true,
    } });
    gsap.timeline({ defaults: { ease: 'power2.out' }, scrollTrigger: {
      trigger: '.community', start: 'top 83%', once: true,
    } })
      .from('.community-photo', { y: 15, duration: .64 })
      .from('.community-copy', { y: 10, duration: .46 }, .18);
    gsap.from('.payment-methods > div', { y: 9, duration: .42, stagger: .1, scrollTrigger: {
      trigger: '.payment-methods', start: 'top 85%', once: true,
    } });
    return () => heading.revert();
  }, root);
})();
