(function () {
  const canvas    = document.getElementById('vine-canvas');
  const ctx       = canvas.getContext('2d');
  const offscreen = document.createElement('canvas');
  const off       = offscreen.getContext('2d');

  let W, H, vines = [], animStart = 0, loopDuration = 14000;

  const PEAK_ALPHA    = 0.22;
  const HOLD_DURATION = 4000;
  const FADE_DURATION = 7000;
  const MAX_DEPTH     = 8;

  class RNG {
    constructor(s) { this.s = s >>> 0; }
    next() {
      this.s = Math.imul(this.s ^ (this.s >>> 13), 0x45d9f3b);
      this.s = Math.imul(this.s ^ (this.s >>> 7),  0x119de1f3);
      this.s ^= (this.s >>> 17);
      return (this.s >>> 0) / 4294967296;
    }
  }

  function bezierPt(t, x0, y0, cx1, cy1, cx2, cy2, x1, y1) {
    const u = 1 - t;
    return {
      x: u*u*u*x0 + 3*u*u*t*cx1 + 3*u*t*t*cx2 + t*t*t*x1,
      y: u*u*u*y0 + 3*u*u*t*cy1 + 3*u*t*t*cy2 + t*t*t*y1,
    };
  }

  // Warm olive-brown matching app palette: trunk ≈ #464128, tip ≈ #5a6934
  function vineColor(depth) {
    const t = depth / MAX_DEPTH;
    return `rgb(${Math.round(90-t*20)},${Math.round(105-t*40)},${Math.round(52-t*12)})`;
  }

  class Seg {
    constructor(x, y, inAngle, outAngle, depth, startTime, rng) {
      this.depth = depth;
      this.startTime = startTime;
      this.children = [];

      const wobble    = (rng.next() - 0.5) * 0.28;
      const exitAngle = Math.max(-Math.PI + 0.05, Math.min(0.30, outAngle + wobble));

      const len = (34 + depth * 17) * (0.75 + rng.next() * 0.5);

      this.x  = x;  this.y  = y;
      this.ex = x + Math.cos(exitAngle) * len;
      this.ey = y + Math.sin(exitAngle) * len;

      // C1 continuity: cx1 aligns with inAngle, cx2 aligns with exitAngle
      const sagDir = rng.next() > 0.5 ? 1 : -1;
      const sagAmt = rng.next() * 0.15;
      const perpX  = -Math.sin(exitAngle);
      const perpY  =  Math.cos(exitAngle);

      this.cx1 = x       + Math.cos(inAngle)   * len * 0.40;
      this.cy1 = y       + Math.sin(inAngle)   * len * 0.40;
      this.cx2 = this.ex - Math.cos(exitAngle) * len * 0.40 + perpX * len * sagAmt * sagDir;
      this.cy2 = this.ey - Math.sin(exitAngle) * len * 0.40 + perpY * len * sagAmt * sagDir;

      this.len       = len;
      this.duration  = len * (30 - depth * 1.8);
      this.exitAngle = exitAngle;

      const t    = depth / MAX_DEPTH;
      this.width = Math.max(0.75, t * t * 22);

      const N = 32;
      this.pts = [];
      for (let i = 0; i <= N; i++)
        this.pts.push(bezierPt(i/N, x, y, this.cx1, this.cy1, this.cx2, this.cy2, this.ex, this.ey));

      if (depth > 0) {
        const nextOut = exitAngle + (rng.next() - 0.5) * 0.22;
        this.children.push(new Seg(this.ex, this.ey, exitAngle, nextOut, depth - 1, startTime + this.duration, rng));

        if (rng.next() > 0.25 && depth > 1) {
          const dir    = rng.next() > 0.5 ? 1 : -1;
          const bOut   = exitAngle + dir * (0.45 + rng.next() * 0.35);
          const bStart = startTime + this.duration * (0.45 + rng.next() * 0.35);
          this.children.push(new Seg(this.ex, this.ey, exitAngle, bOut, depth - 2, bStart, rng));
        }

        if (rng.next() > 0.50 && depth > 3) {
          const dir    = rng.next() > 0.5 ? 1 : -1;
          const bOut   = exitAngle + dir * (0.3 + rng.next() * 0.3);
          const bStart = startTime + this.duration * (0.65 + rng.next() * 0.25);
          this.children.push(new Seg(this.ex, this.ey, exitAngle, bOut, depth - 3, bStart, rng));
        }

        if (rng.next() > 0.45 && depth <= 4) {
          const dir    = rng.next() > 0.5 ? 1 : -1;
          const bOut   = exitAngle + dir * (0.5 + rng.next() * 0.4);
          const bStart = startTime + this.duration * (0.55 + rng.next() * 0.3);
          this.children.push(new Seg(this.ex, this.ey, exitAngle, bOut, Math.max(0, depth - 2), bStart, rng));
        }
      }
    }

    draw(ctx, elapsed) {
      if (elapsed < this.startTime) return;
      const progress = Math.min(1, (elapsed - this.startTime) / this.duration);
      if (progress > 0) {
        const end = Math.max(1, Math.round(progress * (this.pts.length - 1)));

        // Taper width along the segment: thick at base, thin at tip
        // endW matches the next segment's startW for seamless joints
        const endDepth = Math.max(0, this.depth - 1);
        const endW     = Math.max(0.4, Math.pow(endDepth / MAX_DEPTH, 2) * 22);
        const startW   = this.width;

        ctx.strokeStyle = vineColor(this.depth);
        ctx.lineCap     = 'round';
        ctx.lineJoin    = 'round';

        // Draw in 7 sub-steps — enough for a smooth taper, cheap enough to run at 60fps
        const STEPS = 7;
        for (let s = 0; s < STEPS; s++) {
          const i0 = Math.floor(s       / STEPS * end);
          const i1 = Math.floor((s + 1) / STEPS * end);
          if (i1 <= i0) continue;
          const t       = s / (STEPS - 1);
          ctx.lineWidth = startW + (endW - startW) * t;
          ctx.beginPath();
          ctx.moveTo(this.pts[i0].x, this.pts[i0].y);
          for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(this.pts[i].x, this.pts[i].y);
          ctx.stroke();
        }
      }
      for (const c of this.children) c.draw(ctx, elapsed);
    }

    maxTime() {
      let m = this.startTime + this.duration;
      for (const c of this.children) m = Math.max(m, c.maxTime());
      return m;
    }
  }

  function buildVines() {
    vines = [];
    const seeds = [
      { x: 0,        y: H,        a: -Math.PI * 0.32, depth: 8, seed: 101 },
      { x: W,        y: H,        a: -Math.PI * 0.68, depth: 8, seed: 202 },
      { x: W * 0.18, y: H,        a: -Math.PI * 0.38, depth: 7, seed: 303, delay: 300 },
      { x: W * 0.82, y: H,        a: -Math.PI * 0.62, depth: 7, seed: 404, delay: 300 },
      { x: W * 0.34, y: H,        a: -Math.PI * 0.44, depth: 6, seed: 505, delay: 180 },
      { x: W * 0.66, y: H,        a: -Math.PI * 0.56, depth: 6, seed: 606, delay: 180 },
      { x: W * 0.50, y: H,        a: -Math.PI * 0.50, depth: 6, seed: 707, delay: 450 },
      { x: W * 0.10, y: H,        a: -Math.PI * 0.40, depth: 5, seed: 808, delay: 600 },
      { x: W * 0.90, y: H,        a: -Math.PI * 0.60, depth: 5, seed: 909, delay: 600 },
      { x: W * 0.26, y: H,        a: -Math.PI * 0.46, depth: 5, seed: 1010, delay: 400 },
      { x: W * 0.74, y: H,        a: -Math.PI * 0.54, depth: 5, seed: 1111, delay: 400 },
      { x: 0,        y: H * 0.68, a: -Math.PI * 0.12, depth: 6, seed: 1212, delay: 500 },
      { x: W,        y: H * 0.68, a: -Math.PI * 0.88, depth: 6, seed: 1313, delay: 500 },
      { x: 0,        y: H * 0.42, a: -Math.PI * 0.08, depth: 5, seed: 1414, delay: 750 },
      { x: W,        y: H * 0.42, a: -Math.PI * 0.92, depth: 5, seed: 1515, delay: 750 },
      { x: W * 0.50, y: H,        a: -Math.PI * 0.36, depth: 5, seed: 1616, delay: 650 },
    ];

    for (const s of seeds) {
      const rng = new RNG((s.seed * 2654435761) >>> 0);
      vines.push(new Seg(s.x, s.y, s.a, s.a, s.depth, s.delay || 0, rng));
    }

    loopDuration = Math.max(13000, Math.max(...vines.map(v => v.maxTime())) + 600);
  }

  function draw(ts) {
    const elapsed    = ts - animStart;
    const fadeStart  = loopDuration + HOLD_DURATION;
    const totalCycle = fadeStart + FADE_DURATION;

    ctx.clearRect(0, 0, W, H);
    off.clearRect(0, 0, W, H);

    for (const v of vines) v.draw(off, elapsed);

    let alpha = PEAK_ALPHA;
    if (elapsed >= fadeStart) {
      if (elapsed >= totalCycle) { animStart = ts; requestAnimationFrame(draw); return; }
      alpha = PEAK_ALPHA * (1 - (elapsed - fadeStart) / FADE_DURATION);
    }

    ctx.globalAlpha = alpha;
    ctx.drawImage(offscreen, 0, 0);
    ctx.globalAlpha = 1;

    requestAnimationFrame(draw);
  }

  function resize() {
    W = canvas.width  = offscreen.width  = window.innerWidth;
    H = canvas.height = offscreen.height = window.innerHeight;
    buildVines();
    animStart = performance.now();
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
})();
