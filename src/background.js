/**
 * Procedural space background generator.
 * Renders once to an offscreen canvas and caches it.
 */

// Seeded random for reproducible backgrounds
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function generateBackground(w, h, dpr = 1) {
  const offscreen = document.createElement('canvas');
  offscreen.width = Math.round(w * dpr);
  offscreen.height = Math.round(h * dpr);
  const ctx = offscreen.getContext('2d');
  ctx.scale(dpr, dpr);

  const rand = mulberry32(42);

  // Base gradient: deep space
  const bg = ctx.createLinearGradient(0, 0, w * 0.3, h);
  bg.addColorStop(0, '#0d0d1a');
  bg.addColorStop(0.4, '#1a1a2e');
  bg.addColorStop(0.7, '#16213e');
  bg.addColorStop(1, '#0f0f23');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Nebula clouds (soft radial gradients)
  const nebulae = [
    { x: w * 0.2, y: h * 0.3, r: Math.max(w, h) * 0.35, color: [90, 40, 120] },
    { x: w * 0.75, y: h * 0.6, r: Math.max(w, h) * 0.3, color: [30, 60, 120] },
    { x: w * 0.5, y: h * 0.15, r: Math.max(w, h) * 0.25, color: [120, 50, 80] },
    { x: w * 0.85, y: h * 0.2, r: Math.max(w, h) * 0.2, color: [40, 80, 100] },
    { x: w * 0.1, y: h * 0.8, r: Math.max(w, h) * 0.22, color: [60, 30, 90] },
  ];

  for (const neb of nebulae) {
    const grad = ctx.createRadialGradient(neb.x, neb.y, 0, neb.x, neb.y, neb.r);
    const [r, g, b] = neb.color;
    grad.addColorStop(0, `rgba(${r},${g},${b},0.12)`);
    grad.addColorStop(0.4, `rgba(${r},${g},${b},0.05)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  // Dust / faint cloud wisps
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 6; i++) {
    const cx = rand() * w;
    const cy = rand() * h;
    const rx = 80 + rand() * 200;
    const ry = 30 + rand() * 80;
    const angle = rand() * Math.PI;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    const dustGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    const hue = 200 + rand() * 60;
    dustGrad.addColorStop(0, `hsla(${hue}, 40%, 50%, 0.04)`);
    dustGrad.addColorStop(1, `hsla(${hue}, 40%, 50%, 0)`);
    ctx.fillStyle = dustGrad;
    ctx.scale(1, ry / rx);
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';

  // Stars — layered for depth
  const starLayers = [
    { count: 300, minSize: 0.3, maxSize: 1.0, minAlpha: 0.2, maxAlpha: 0.5 },   // far
    { count: 120, minSize: 0.8, maxSize: 1.8, minAlpha: 0.4, maxAlpha: 0.8 },   // mid
    { count: 30,  minSize: 1.5, maxSize: 2.8, minAlpha: 0.7, maxAlpha: 1.0 },   // near / bright
  ];

  for (const layer of starLayers) {
    for (let i = 0; i < layer.count; i++) {
      const sx = rand() * w;
      const sy = rand() * h;
      const size = layer.minSize + rand() * (layer.maxSize - layer.minSize);
      const alpha = layer.minAlpha + rand() * (layer.maxAlpha - layer.minAlpha);

      // Star color: mostly white, some warm/cool tinted
      const colorRoll = rand();
      let starColor;
      if (colorRoll < 0.7) {
        starColor = `rgba(255, 255, 255, ${alpha})`;
      } else if (colorRoll < 0.8) {
        starColor = `rgba(200, 220, 255, ${alpha})`; // blue-white
      } else if (colorRoll < 0.9) {
        starColor = `rgba(255, 230, 200, ${alpha})`; // warm
      } else {
        starColor = `rgba(200, 200, 255, ${alpha})`; // cool
      }

      ctx.fillStyle = starColor;
      ctx.beginPath();
      ctx.arc(sx, sy, size, 0, Math.PI * 2);
      ctx.fill();

      // Glow on bright stars
      if (size > 1.8) {
        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, size * 4);
        glow.addColorStop(0, `rgba(200, 220, 255, ${alpha * 0.15})`);
        glow.addColorStop(1, `rgba(200, 220, 255, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(sx, sy, size * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Subtle grid overlay
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  return offscreen;
}
