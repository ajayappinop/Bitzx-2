import { useEffect, useRef } from 'react';
import { useTheme } from '@/context/ThemeContext';

/**
 * Hero interactive backdrop — liquid nebula: soft orbs, sparks, cursor ripples.
 * No grids, checker patterns, or constellation lines.
 */
export default function HeroInteractiveBg() {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const { isLight } = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return undefined;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return undefined;

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduceMotion = mq.matches;
    const onMotion = () => {
      reduceMotion = mq.matches;
    };
    mq.addEventListener('change', onMotion);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let raf = 0;
    let t0 = performance.now();

    const pointer = { x: 0.5, y: 0.38, tx: 0.5, ty: 0.38, active: false };
    /** @type {{ x: number, y: number, vx: number, vy: number, r: number, cr: number, cg: number, cb: number, a: number, wobble: number }[]} */
    let orbs = [];
    /** @type {{ x: number, y: number, vx: number, vy: number, r: number, life: number, max: number, cr: number, cg: number, cb: number }[]} */
    let sparks = [];
    /** @type {{ x: number, y: number, life: number, max: number }[]} */
    let ripples = [];
    let lastRipple = 0;

    // Delta India–inspired: graphite base + orange / blue / green orbs
    const baseFill = isLight ? '#f3f4f6' : '#101013';
    const veilRgb = isLight ? '243,244,246' : '16,16,19';
    const washScale = isLight ? 1.6 : 1;

    const PALETTE = [
      { r: 254, g: 108, b: 2 },   // brand orange (Delta India)
      { r: 56, g: 149, b: 237 },  // secondary blue
      { r: 0, g: 168, b: 118 },   // positive green
    ];

    const spawnSparks = (count) => {
      for (let i = 0; i < count; i++) {
        const c = PALETTE[i % PALETTE.length];
        sparks.push({
          x: Math.random() * w,
          y: h + Math.random() * 40,
          vx: (Math.random() - 0.5) * 0.4,
          vy: -(0.35 + Math.random() * 0.85),
          r: 1 + Math.random() * 2.2,
          life: 0,
          max: 4 + Math.random() * 5,
          cr: c.r,
          cg: c.g,
          cb: c.b,
        });
      }
    };

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      w = Math.max(1, Math.floor(rect.width));
      h = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Few large blooms, placed far apart (corners / edges — not clustered center)
      const slots = [
        { x: 0.14, y: 0.22 },
        { x: 0.86, y: 0.26 },
        { x: 0.18, y: 0.78 },
        { x: 0.84, y: 0.74 },
        { x: 0.5, y: 0.12 },
        { x: 0.5, y: 0.88 },
      ];
      const count = Math.min(5, slots.length);
      const minR = Math.min(w, h) * 0.28;
      const maxR = Math.min(w, h) * 0.48;
      orbs = Array.from({ length: count }, (_, i) => {
        const c = PALETTE[i % PALETTE.length];
        const slot = slots[i];
        return {
          x: slot.x * w + (Math.random() - 0.5) * w * 0.06,
          y: slot.y * h + (Math.random() - 0.5) * h * 0.05,
          vx: (Math.random() - 0.5) * 0.12,
          vy: (Math.random() - 0.5) * 0.1,
          r: minR + Math.random() * (maxR - minR),
          cr: c.r,
          cg: c.g,
          cb: c.b,
          a: 0.035 + Math.random() * 0.025,
          wobble: Math.random() * Math.PI * 2,
        };
      });
      sparks = [];
      spawnSparks(6);
    };

    const onPointer = (e) => {
      const rect = wrap.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        pointer.active = false;
        return;
      }
      pointer.tx = (clientX - rect.left) / rect.width;
      pointer.ty = (clientY - rect.top) / rect.height;
      pointer.active = true;

      const now = performance.now();
      if (!reduceMotion && now - lastRipple > 160) {
        lastRipple = now;
        ripples.push({
          x: pointer.tx * w,
          y: pointer.ty * h,
          life: 0,
          max: 1.15 + Math.random() * 0.4,
        });
        if (ripples.length > 8) ripples.shift();
        // Burst a few sparks at cursor
        for (let i = 0; i < 3; i++) {
          const c = PALETTE[i % PALETTE.length];
          sparks.push({
            x: pointer.tx * w + (Math.random() - 0.5) * 24,
            y: pointer.ty * h + (Math.random() - 0.5) * 24,
            vx: (Math.random() - 0.5) * 1.4,
            vy: (Math.random() - 0.5) * 1.4 - 0.3,
            r: 1.4 + Math.random() * 2,
            life: 0,
            max: 1.6 + Math.random(),
            cr: c.r,
            cg: c.g,
            cb: c.b,
          });
        }
      }
    };
    const onLeave = () => {
      pointer.active = false;
    };

    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('pointerdown', onPointer, { passive: true });
    window.addEventListener('touchmove', onPointer, { passive: true });
    document.addEventListener('pointerleave', onLeave);

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const draw = (now) => {
      const t = (now - t0) / 1000;
      pointer.x += (pointer.tx - pointer.x) * 0.08;
      pointer.y += (pointer.ty - pointer.y) * 0.08;
      const px = pointer.x * w;
      const py = pointer.y * h;

      ctx.clearRect(0, 0, w, h);

      // Theme-matched base (cool mist in light, deep canvas in dark)
      ctx.fillStyle = baseFill;
      ctx.fillRect(0, 0, w, h);

      // Wide, soft brand washes — spread to edges, low intensity
      const washes = [
        {
          x: 0.12 + Math.sin(t * 0.12) * 0.03,
          y: 0.2 + Math.cos(t * 0.1) * 0.03,
          r: 0.72,
          c0: `rgba(254, 108, 2,${0.07 * washScale})`,
        },
        {
          x: 0.9 + Math.cos(t * 0.11) * 0.03,
          y: 0.24 + Math.sin(t * 0.09) * 0.03,
          r: 0.68,
          c0: `rgba(77,138,255,${0.05 * washScale})`,
        },
        {
          x: 0.5 + Math.sin(t * 0.07) * 0.04,
          y: 0.82 + Math.cos(t * 0.08) * 0.02,
          r: 0.75,
          c0: `rgba(0, 168, 118,${0.045 * washScale})`,
        },
      ];
      for (const wash of washes) {
        const g = ctx.createRadialGradient(
          wash.x * w,
          wash.y * h,
          0,
          wash.x * w,
          wash.y * h,
          wash.r * Math.max(w, h),
        );
        g.addColorStop(0, wash.c0);
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }

      if (!reduceMotion) {
        // Liquid orbs — slow drift, gentle separation, soft glow (no hot white core)
        for (let i = 0; i < orbs.length; i++) {
          const o = orbs[i];
          const dx = px - o.x;
          const dy = py - o.y;
          const dist = Math.hypot(dx, dy) || 1;
          if (pointer.active && dist < 380) {
            const f = (1 - dist / 380) * 0.035;
            o.vx -= (dx / dist) * f;
            o.vy -= (dy / dist) * f;
          }

          // Keep blooms from clustering
          for (let j = i + 1; j < orbs.length; j++) {
            const b = orbs[j];
            const sx = o.x - b.x;
            const sy = o.y - b.y;
            const sd = Math.hypot(sx, sy) || 1;
            const minSep = (o.r + b.r) * 0.55;
            if (sd < minSep) {
              const push = ((minSep - sd) / minSep) * 0.02;
              o.vx += (sx / sd) * push;
              o.vy += (sy / sd) * push;
              b.vx -= (sx / sd) * push;
              b.vy -= (sy / sd) * push;
            }
          }

          o.vx += Math.sin(t * 0.28 + o.wobble) * 0.006;
          o.vy += Math.cos(t * 0.24 + o.wobble) * 0.005;
          o.vx *= 0.99;
          o.vy *= 0.99;
          o.x += o.vx;
          o.y += o.vy;

          // Soft bounds — nudge back instead of wrapping tightly
          if (o.x < o.r * 0.2) o.vx += 0.02;
          if (o.x > w - o.r * 0.2) o.vx -= 0.02;
          if (o.y < o.r * 0.2) o.vy += 0.02;
          if (o.y > h - o.r * 0.2) o.vy -= 0.02;

          const pulse = 1 + Math.sin(t * 0.7 + o.wobble) * 0.04;
          const rr = o.r * pulse;
          const g = ctx.createRadialGradient(o.x, o.y, rr * 0.05, o.x, o.y, rr);
          g.addColorStop(0, `rgba(${o.cr},${o.cg},${o.cb},${o.a * 0.85})`);
          g.addColorStop(0.35, `rgba(${o.cr},${o.cg},${o.cb},${o.a * 0.4})`);
          g.addColorStop(0.7, `rgba(${o.cr},${o.cg},${o.cb},${o.a * 0.12})`);
          g.addColorStop(1, 'transparent');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(o.x, o.y, rr, 0, Math.PI * 2);
          ctx.fill();
        }

        // Subtle rising sparks (fewer, dimmer)
        if (sparks.length < 10 && Math.random() < 0.02) spawnSparks(1);
        sparks = sparks.filter((s) => {
          s.life += 0.016;
          if (s.life >= s.max) return false;
          s.x += s.vx;
          s.y += s.vy;
          s.vy -= 0.003;
          const p = s.life / s.max;
          const alpha = (1 - p) * 0.35;
          const glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 5);
          glow.addColorStop(0, `rgba(${s.cr},${s.cg},${s.cb},${alpha})`);
          glow.addColorStop(1, 'transparent');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * 5, 0, Math.PI * 2);
          ctx.fill();
          return true;
        });

        // Soft expanding ripples
        ripples = ripples.filter((r) => {
          r.life += 0.016;
          const p = r.life / r.max;
          if (p >= 1) return false;
          const radius = 24 + p * 220;
          const alpha = (1 - p) * 0.12;
          const ring = ctx.createRadialGradient(r.x, r.y, radius * 0.78, r.x, r.y, radius);
          ring.addColorStop(0, 'transparent');
          ring.addColorStop(0.75, `rgba(254, 108, 2,${alpha * 0.4})`);
          ring.addColorStop(0.94, `rgba(0, 168, 118,${alpha})`);
          ring.addColorStop(1, 'transparent');
          ctx.fillStyle = ring;
          ctx.beginPath();
          ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
          ctx.fill();
          return true;
        });

        if (pointer.active) {
          const bloom = ctx.createRadialGradient(px, py, 0, px, py, 260);
          bloom.addColorStop(0, 'rgba(254, 108, 2,0.05)');
          bloom.addColorStop(0.35, 'rgba(0, 168, 118,0.03)');
          bloom.addColorStop(1, 'transparent');
          ctx.fillStyle = bloom;
          ctx.fillRect(px - 260, py - 260, 520, 520);
        }
      } else {
        for (const o of orbs) {
          const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
          g.addColorStop(0, `rgba(${o.cr},${o.cg},${o.cb},${o.a * 0.7})`);
          g.addColorStop(1, 'transparent');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Soft veil so copy stays clear
      const veil = ctx.createRadialGradient(w * 0.5, h * 0.34, 0, w * 0.5, h * 0.34, Math.max(w, h) * 0.4);
      veil.addColorStop(0, `rgba(${veilRgb},${isLight ? 0.18 : 0.28})`);
      veil.addColorStop(0.55, `rgba(${veilRgb},${isLight ? 0.05 : 0.08})`);
      veil.addColorStop(1, 'transparent');
      ctx.fillStyle = veil;
      ctx.fillRect(0, 0, w, h);

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mq.removeEventListener('change', onMotion);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('touchmove', onPointer);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, [isLight]);

  return (
    <div ref={wrapRef} className="absolute inset-0 z-0 overflow-hidden" aria-hidden>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="hero-fade-top pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#101013]/70 to-transparent" />
      <div className="hero-fade-bottom pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#101013]/95 to-transparent" />
    </div>
  );
}
