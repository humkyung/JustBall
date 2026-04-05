import Matter from 'matter-js';
import { PhysicsWorld, BALL_TYPES } from './physics.js';
import { Toolbar } from './toolbar.js';
import { SoundSystem } from './sound.js';
import { generateBackground } from './background.js';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');

// Resize canvas drawing buffer to match its CSS layout size, respecting devicePixelRatio
function resizeCanvas() {
  const toolbar = document.getElementById('toolbar');
  const toolbarH = toolbar.getBoundingClientRect().height || toolbar.offsetHeight;
  const dpr = window.devicePixelRatio || 1;
  const cssW = window.innerWidth;
  const cssH = window.innerHeight - toolbarH;

  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';

  // Store CSS dimensions for physics (physics uses CSS pixel coordinates)
  canvas.cssWidth = cssW;
  canvas.cssHeight = cssH;
  canvas.dpr = dpr;
}

resizeCanvas();

const world = new PhysicsWorld(canvas);
const sound = new SoundSystem();
const toolbar = new Toolbar(world, canvas, sound);

// Wire up sound callbacks
world.onBounce = (speed) => sound.playBounce(speed);
world.onKill = () => sound.playExplosion();
world.onBoost = () => sound.playBoost();
world.onLineBreak = () => sound.playLineBreak();
world.onBombExplode = () => sound.playBombExplode();
world.onLaunch = (power) => sound.playLaunch(power);
world.onImpact = (intensity) => sound.playImpact(intensity);

// Trampoline squish animation state: Map<bodyId, {startTime, nx, ny, speed}>
const trampolineHits = new Map();
world.onTrampolineHit = (bodyId, nx, ny, speed) => {
  trampolineHits.set(bodyId, { startTime: performance.now(), nx, ny, speed });
};

// Spacebar pause / resume
let paused = false;

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target === document.body) {
    e.preventDefault();
    paused = !paused;
    if (paused) {
      Matter.Runner.stop(world.runner);
    } else {
      Matter.Runner.run(world.runner, world.engine);
    }
  }
});

window.addEventListener('resize', () => {
  resizeCanvas();
  world.resize(canvas.cssWidth, canvas.cssHeight);
  bgCanvas = generateBackground(canvas.cssWidth, canvas.cssHeight, canvas.dpr || 1);
});

// Detect zoom changes (devicePixelRatio changes) via visualViewport
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    resizeCanvas();
    world.resize(canvas.cssWidth, canvas.cssHeight);
    bgCanvas = generateBackground(canvas.cssWidth, canvas.cssHeight, canvas.dpr || 1);
  });
}

const BALL_RADIUS = 15;

// Generate cached background
let bgCanvas = generateBackground(canvas.cssWidth, canvas.cssHeight, canvas.dpr || 1);

const COLOR_MAP = {
  ground: '#333333',
  bounce: '#f5c542',
  kill: '#e74c3c',
};

function render() {
  const dpr = canvas.dpr || 1;
  const W = canvas.cssWidth || canvas.width;
  const H = canvas.cssHeight || canvas.height;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  // Draw cached background (stars, nebula, grid)
  ctx.drawImage(bgCanvas, 0, 0, W, H);

  // Determine hovered ball for selection ring
  const hover = toolbar.hoverPos;
  let hoveredBall = null;
  if (hover) {
    for (const body of world.bodies) {
      if (body._type === 'ball') {
        const dx = hover.x - body.position.x;
        const dy = hover.y - body.position.y;
        if (Math.hypot(dx, dy) < BALL_RADIUS + 10) {
          hoveredBall = body;
          break;
        }
      }
    }
  }

  // Draw bodies
  for (const body of world.bodies) {
    if (body.label === 'wall') continue;

    if (body._type === 'ball') {
      const bx = body.position.x;
      const by = body.position.y;
      const ballType = body._ballType || 'normal';
      const ballColor = body._ballColor || '#7b68ee';

      // Selection ring for hovered ball
      if (body === hoveredBall) {
        ctx.beginPath();
        ctx.arc(bx, by, BALL_RADIUS + 6, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Fireball: pulsing outer glow
      if (ballType === 'fireball') {
        const now = Date.now();
        const pulse = Math.sin(now / 120) * 0.5 + 0.5;
        const glowRadius = BALL_RADIUS + 8 + pulse * 6;
        const grd = ctx.createRadialGradient(bx, by, BALL_RADIUS * 0.3, bx, by, glowRadius);
        grd.addColorStop(0, 'rgba(255, 200, 50, 0.7)');
        grd.addColorStop(0.4, 'rgba(255, 80, 0, 0.45)');
        grd.addColorStop(1, 'rgba(255, 30, 0, 0)');
        ctx.beginPath();
        ctx.arc(bx, by, glowRadius, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();
      }

      // Ball body
      ctx.beginPath();
      ctx.arc(bx, by, BALL_RADIUS, 0, Math.PI * 2);

      if (ballType === 'bomb') {
        const fuseRatio = world.getBombFuseRatio(body);
        const flash = fuseRatio < 0.4 ? Math.sin(Date.now() / 80) * 0.5 + 0.5 : 0;
        const r = Math.round(80 + flash * 175);
        ctx.fillStyle = `rgb(${r}, 50, 20)`;
      } else if (ballType === 'fireball') {
        const now = Date.now();
        const pulse = Math.sin(now / 100) * 0.5 + 0.5;
        const grd = ctx.createRadialGradient(bx - 4, by - 4, 2, bx, by, BALL_RADIUS);
        grd.addColorStop(0, `rgba(255, 240, ${Math.round(100 + pulse * 100)}, 1)`);
        grd.addColorStop(0.4, '#ff6600');
        grd.addColorStop(1, '#cc1100');
        ctx.fillStyle = grd;
      } else {
        ctx.fillStyle = ballColor;
      }
      ctx.fill();

      // Ball outline
      ctx.strokeStyle = ballType === 'fireball' ? 'rgba(255,150,0,0.6)' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Magnet pole indicator
      if (ballType === 'magnetN') {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('N', bx, by);
      } else if (ballType === 'magnetS') {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('S', bx, by);
      }

      // Bomb fuse indicator
      if (ballType === 'bomb') {
        const fuseRatio = world.getBombFuseRatio(body);
        if (fuseRatio > 0) {
          // Fuse arc
          ctx.beginPath();
          ctx.arc(bx, by, BALL_RADIUS + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fuseRatio);
          ctx.strokeStyle = fuseRatio < 0.3 ? '#ff3333' : '#ff8800';
          ctx.lineWidth = 2;
          ctx.stroke();

          // Time text
          const secs = Math.ceil(fuseRatio * 5);
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 11px "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(secs + '', bx, by);
        }
      }
    } else if (body._type === 'line') {
      const verts = body.vertices;
      const healthRatio = world.getLineHealthRatio(body);
      const label = body.label;

      // Trampoline squish: offset vertices perpendicular to line
      let drawVerts = verts;
      if (label === 'bounce') {
        const hit = trampolineHits.get(body.id);
        if (hit) {
          const elapsed = performance.now() - hit.startTime;
          const duration = 350; // ms
          if (elapsed < duration) {
            const t = elapsed / duration;
            // Ease: compress then spring back (t→squish→overshoot→settle)
            const squish = Math.sin(t * Math.PI) * Math.exp(-t * 3) * 3.5;
            // Push verts inward along -normal (into the line)
            drawVerts = verts.map(v => ({
              x: v.x + hit.nx * squish,
              y: v.y + hit.ny * squish,
            }));
          } else {
            trampolineHits.delete(body.id);
          }
        }
      }

      if (healthRatio < 1 && healthRatio > 0) {
        ctx.globalAlpha = 0.4 + healthRatio * 0.6;
      }

      ctx.save();

      // Clip to line shape
      ctx.beginPath();
      ctx.moveTo(drawVerts[0].x, drawVerts[0].y);
      for (let j = 1; j < drawVerts.length; j++) ctx.lineTo(drawVerts[j].x, drawVerts[j].y);
      ctx.closePath();
      ctx.clip();

      const cx = body.position.x;
      const cy = body.position.y;
      const angle = body.angle;
      const halfLen = 600; // generous half-length to cover any segment
      const halfH = 7.5;   // half height in local space (15px / 2)

      // Draw in line-local coordinates
      ctx.translate(cx, cy);
      ctx.rotate(angle);

      if (label === 'ground') {
        // ── 검정 매트 재질 ───────────────────────────────────────────────────
        // 베이스: 거의 순수 검정
        ctx.fillStyle = '#0d0d0d';
        ctx.fillRect(-halfLen, -halfH, halfLen * 2, halfH * 2);

        // 미세 수평 그레인 (밝기 노이즈)
        const seed0 = body.id * 31;
        for (let k = 0; k < 30; k++) {
          const gy  = -halfH + 1 + ((seed0 + k * 17) % (halfH * 2 - 2));
          const ga  = 0.03 + ((seed0 + k * 53) % 8) / 100;
          const gl  = 100 + ((seed0 + k * 37) % 400);
          const gox = -halfLen + ((seed0 + k * 61) % 200);
          ctx.fillStyle = `rgba(255,255,255,${ga})`;
          ctx.fillRect(gox, gy, gl, 1);
        }

        // 상단 하이라이트 & 하단 그림자로 두께감
        const gGround = ctx.createLinearGradient(0, -halfH, 0, halfH);
        gGround.addColorStop(0,   'rgba(255,255,255,0.10)');
        gGround.addColorStop(0.3, 'rgba(255,255,255,0.02)');
        gGround.addColorStop(1,   'rgba(0,0,0,0.40)');
        ctx.fillStyle = gGround;
        ctx.fillRect(-halfLen, -halfH, halfLen * 2, halfH * 2);

      } else if (label === 'bounce') {
        // ── 노랑 직교 메쉬 재질 ──────────────────────────────────────────────
        const CELL = 6;   // 격자 셀 크기
        const LINE = 1.5; // 격자 선 두께

        // 바탕: 짙은 황금색
        ctx.fillStyle = '#c8960a';
        ctx.fillRect(-halfLen, -halfH, halfLen * 2, halfH * 2);

        // 격자 셀: 밝은 노랑 채우기
        for (let gx = -halfLen; gx < halfLen; gx += CELL) {
          for (let gy = -halfH; gy < halfH; gy += CELL) {
            ctx.fillStyle = '#f5c542';
            ctx.fillRect(gx + LINE, gy + LINE, CELL - LINE * 2, CELL - LINE * 2);
            // 셀 내부 하이라이트 (좌상단 삼각)
            ctx.fillStyle = 'rgba(255,235,100,0.5)';
            ctx.fillRect(gx + LINE, gy + LINE, CELL - LINE * 2, (CELL - LINE * 2) * 0.45);
            // 셀 내부 그림자 (우하단)
            ctx.fillStyle = 'rgba(0,0,0,0.18)';
            ctx.fillRect(gx + CELL * 0.5, gy + CELL * 0.5, CELL * 0.5 - LINE, CELL * 0.5 - LINE);
          }
        }

        // 전체 광택 오버레이
        const gBounce = ctx.createLinearGradient(0, -halfH, 0, halfH);
        gBounce.addColorStop(0,   'rgba(255,255,200,0.20)');
        gBounce.addColorStop(0.4, 'rgba(255,255,200,0.04)');
        gBounce.addColorStop(1,   'rgba(0,0,0,0.25)');
        ctx.fillStyle = gBounce;
        ctx.fillRect(-halfLen, -halfH, halfLen * 2, halfH * 2);

      } else if (label === 'kill') {
        // ── 균열 점토 재질 ────────────────────────────────────────────────────
        // 베이스: 짙은 적갈색
        ctx.fillStyle = '#5a0a08';
        ctx.fillRect(-halfLen, -halfH, halfLen * 2, halfH * 2);

        // 중간 레이어: 어두운 빨강
        const gKill = ctx.createLinearGradient(0, -halfH, 0, halfH);
        gKill.addColorStop(0,   '#8b1a15');
        gKill.addColorStop(0.45,'#7a1210');
        gKill.addColorStop(1,   '#4a0806');
        ctx.fillStyle = gKill;
        ctx.fillRect(-halfLen, -halfH, halfLen * 2, halfH * 2);

        // 균열 패턴: 시드 기반 세그먼트들
        const seedK = body.id * 137;
        const rk = (n) => ((seedK + n * 1664525 + 1013904223) & 0x7fffffff) / 0x7fffffff;

        // 폴리곤 균열 생성 (Voronoi 스타일)
        const numCracks = 8 + Math.floor(rk(0) * 6);
        const pts = [];
        for (let k = 0; k < numCracks; k++) {
          pts.push({
            x: -halfLen + rk(k * 3 + 1) * halfLen * 2,
            y: -halfH   + rk(k * 3 + 2) * halfH * 2,
          });
        }

        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.lineWidth = 1;
        for (let k = 0; k < pts.length; k++) {
          const p = pts[k];
          // 각 점에서 인접 점들로 균열선
          for (let m = 1; m <= 2; m++) {
            const q = pts[(k + m) % pts.length];
            // 중간에 꺾임 추가
            const midX = (p.x + q.x) / 2 + (rk(k * 7 + m) - 0.5) * 6;
            const midY = (p.y + q.y) / 2 + (rk(k * 7 + m + 1) - 0.5) * halfH;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(midX, midY);
            ctx.lineTo(q.x, q.y);
            ctx.stroke();
          }
          // 균열 하이라이트 (균열 엣지 밝게)
          ctx.strokeStyle = 'rgba(180,40,30,0.35)';
          ctx.lineWidth = 0.5;
          for (let m = 1; m <= 2; m++) {
            const q = pts[(k + m) % pts.length];
            const midX = (p.x + q.x) / 2 + (rk(k * 7 + m) - 0.5) * 5.5;
            const midY = (p.y + q.y) / 2 + (rk(k * 7 + m + 1) - 0.5) * halfH * 0.95;
            ctx.beginPath();
            ctx.moveTo(p.x + 0.5, p.y + 0.5);
            ctx.lineTo(midX + 0.5, midY + 0.5);
            ctx.lineTo(q.x + 0.5, q.y + 0.5);
            ctx.stroke();
          }
          ctx.strokeStyle = 'rgba(0,0,0,0.75)';
          ctx.lineWidth = 1;
        }

        // 상단 미세 하이라이트
        ctx.fillStyle = 'rgba(220,60,50,0.18)';
        ctx.fillRect(-halfLen, -halfH, halfLen * 2, 2);
      }

      ctx.restore();

      // ── Crack/damage overlay (내구도 감소 시) ────────────────────────────────
      if (healthRatio < 0.7 && healthRatio > 0) {
        const dmgAlpha = (0.7 - healthRatio) / 0.7;
        const seed = body.id * 137;
        ctx.strokeStyle = `rgba(255,255,255,${0.2 + dmgAlpha * 0.4})`;
        ctx.lineWidth = 1;
        const crackCount = 2 + Math.floor(dmgAlpha * 4);
        for (let k = 0; k < crackCount; k++) {
          const a = ((seed + k * 47) % 628) / 100;
          const len = 4 + dmgAlpha * 8 + (seed + k * 31) % 6;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
          ctx.stroke();
        }
      }

      // ── 회전 벽 인디케이터 ────────────────────────────────────────────────────
      if (body._rotating) {
        const now = performance.now() / 1000;
        const r = 7;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 1.7);
        ctx.strokeStyle = 'rgba(150, 200, 255, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        const arrowAngle = now * 2 % (Math.PI * 2);
        const ax = cx + Math.cos(arrowAngle) * r;
        const ay = cy + Math.sin(arrowAngle) * r;
        ctx.beginPath();
        ctx.arc(ax, ay, 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(150, 200, 255, 0.9)';
        ctx.fill();
      }

      // ── 움직이는 벽 인디케이터 ───────────────────────────────────────────────
      if (body._moving) {
        const now = performance.now() / 1000;
        // 이동 방향 좌우 화살표
        const dx = body._moveDirX;
        const dy = body._moveDirY;
        const amp = Math.min(body._moveAmplitude * 0.5, 30);
        const pulse = Math.abs(Math.sin(now * body._moveSpeed + body._movePhase));
        const arrowAlpha = 0.4 + pulse * 0.4;

        for (const sign of [-1, 1]) {
          const ex = cx + dx * amp * sign;
          const ey = cy + dy * amp * sign;
          // 점선 화살표
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(ex, ey);
          ctx.strokeStyle = `rgba(255, 220, 80, ${arrowAlpha})`;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
          // 화살촉
          const hLen = 5;
          const perpX = -dy * sign;
          const perpY = dx * sign;
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.lineTo(ex - dx * hLen + perpX * hLen * 0.5, ey - dy * hLen + perpY * hLen * 0.5);
          ctx.moveTo(ex, ey);
          ctx.lineTo(ex - dx * hLen - perpX * hLen * 0.5, ey - dy * hLen - perpY * hLen * 0.5);
          ctx.strokeStyle = `rgba(255, 220, 80, ${arrowAlpha + 0.2})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      ctx.globalAlpha = 1;
    }
  }

  // Draw current wall stroke in progress
  if (toolbar.isDrawing && toolbar.currentPath.length > 1) {
    const path = toolbar.currentPath;
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i].x, path[i].y);
    }
    ctx.strokeStyle = toolbar.currentColor;
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // Draw launch guide (slingshot aiming line)
  const guide = toolbar.launchGuide;
  if (guide) {
    const bx = guide.ballPos.x;
    const by = guide.ballPos.y;
    const dx = guide.start.x - guide.current.x;
    const dy = guide.start.y - guide.current.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 5) {
      const nx = dx / dist;
      const ny = dy / dist;
      const arrowLen = Math.min(dist * 0.8, 120);

      // Direction arrow from ball
      const ax = bx + nx * arrowLen;
      const ay = by + ny * arrowLen;

      // Dashed line from ball to arrow tip
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(ax, ay);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Arrowhead
      const headLen = 10;
      const angle = Math.atan2(ny, nx);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - headLen * Math.cos(angle - 0.4), ay - headLen * Math.sin(angle - 0.4));
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - headLen * Math.cos(angle + 0.4), ay - headLen * Math.sin(angle + 0.4));
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Power indicator
      const power = Math.min(dist * 0.15, 30);
      const powerPct = Math.round((power / 30) * 100);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.font = '12px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${powerPct}%`, bx, by - BALL_RADIUS - 10);
    }
  }

  // Update and draw explosions
  world.updateExplosions();
  for (const p of world.explosions) {
    ctx.globalAlpha = p.life;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
  }

  // Update and draw launch trail effects
  world.updateLaunchTrails();
  for (const p of world.launchTrails) {
    ctx.globalAlpha = p.life;
    if (p.ring) {
      // Expanding shockwave ring
      const radius = p.maxRadius * (1 - p.life);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2 * p.life;
      ctx.stroke();
    } else if (p.streak) {
      // Speed line along launch direction
      const len = p.length * p.life;
      const angle = Math.atan2(p.vy, p.vx);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - Math.cos(angle) * len, p.y - Math.sin(angle) * len);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size * p.life;
      ctx.lineCap = 'round';
      ctx.stroke();
    } else {
      // Burst particle
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // Update and draw impact effects
  world.updateImpactEffects();
  for (const p of world.impactEffects) {
    ctx.globalAlpha = p.life;
    if (p.flash) {
      // Quick expanding flash circle
      const radius = p.size * (1 - p.life * 0.5);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${p.life * 0.4})`;
      ctx.fill();
    } else {
      // Spark particle
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // Update and draw debris particles
  world.updateDebris();
  for (const p of world.debris) {
    ctx.globalAlpha = p.life * 0.9;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // Update and draw fireball fire particles (additive blending for glow)
  world.updateFireParticles();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of world.fireParticles) {
    // life goes 1→0; colour shifts white→yellow→orange→red
    const t = 1 - p.life;  // 0=fresh, 1=dead
    let r, g, b;
    if (t < 0.2) {
      // white-hot core → yellow
      const f = t / 0.2;
      r = 255; g = Math.round(255 - f * 55); b = Math.round(255 - f * 255);
    } else if (t < 0.55) {
      // yellow → orange
      const f = (t - 0.2) / 0.35;
      r = 255; g = Math.round(200 - f * 120); b = 0;
    } else {
      // orange → deep red
      const f = (t - 0.55) / 0.45;
      r = Math.round(255 - f * 105); g = Math.round(80 - f * 80); b = 0;
    }
    const size = p.size * p.life;
    const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size);
    grd.addColorStop(0,   `rgba(${r},${g},${b},${p.life * 0.9})`);
    grd.addColorStop(1,   `rgba(${r},${g},${b},0)`);
    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  // Pause overlay
  if (paused) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 48px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⏸ PAUSED', W / 2, H / 2);
    ctx.font = '18px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('Press Space to resume', W / 2, H / 2 + 52);
  }

  ctx.restore();

  // Update status
  const ballType = BALL_TYPES[toolbar.selectedBallType];
  statusEl.textContent = `Bodies: ${world.bodyCount} | Ball: ${ballType.name}${paused ? '  |  PAUSED (Space)' : ''}`;

  requestAnimationFrame(render);
}

render();
