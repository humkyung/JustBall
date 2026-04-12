import Matter from 'matter-js';
import { PhysicsWorld, BALL_TYPES } from './physics.js';
import { Toolbar } from './toolbar.js';
import { SoundSystem } from './sound.js';
import { generateBackground } from './background.js';
import { loadDefaultStages, getStageProgress, saveStageProgress } from './defaultStages.js';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');

// Pre-load cannon SVG for launcher rendering
const cannonImg = new Image();
cannonImg.src = `${import.meta.env.BASE_URL}Canon.svg`;
let cannonReady = false;
cannonImg.onload = () => { cannonReady = true; };
// SVG barrel default angle (points upper-left at -35° from horizontal in the SVG)
const CANNON_DEFAULT_ANGLE = (-35) * Math.PI / 180; // ≈ -0.611 rad

// Pre-load target SVG for target rendering
const targetImg = new Image();
targetImg.src = `${import.meta.env.BASE_URL}Target.svg`;
let targetReady = false;
targetImg.onload = () => { targetReady = true; };

// Resize canvas drawing buffer to match its CSS layout size, respecting devicePixelRatio
function resizeCanvas() {
  const toolbarEl = document.getElementById('toolbar');
  const toolbarH = toolbarEl.offsetHeight && toolbarEl.style.display !== 'none' ? toolbarEl.getBoundingClientRect().height : 0;
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
world.onPlasmaChain = () => sound.playExplosion();
world.onStarCollect = (value) => {
  sound.playStarCollect();
  scorePopups.push({ value, x: 60, y: 30, life: 1.0 });
};

// Score popup animation state
const scorePopups = [];

// Trampoline squish animation state: Map<bodyId, {startTime, nx, ny, speed}>
const trampolineHits = new Map();
world.onTrampolineHit = (bodyId, nx, ny, speed) => {
  trampolineHits.set(bodyId, { startTime: performance.now(), nx, ny, speed });
};

// Target hit & stage clear callbacks
let stageClearTime = 0;
world.onTargetHit = () => { sound.playBombExplode(); };

// ── Game state machine ─────────────────────────────────────────────────────
let gameMode = 'lobby';       // 'lobby' | 'sandbox' | 'testMode' | 'play'
let paused = false;
let playStageIndex = 0;
let playStageList = [];       // [{name, data}, ...] sorted by savedAt
let sandboxSnapshot = null;   // serialized stage for test-mode restore
let endCheckReason = null;    // 'clear' | 'quit' | null
let endCheckSelectedIndex = 0; // cursor position in stage grid
let quickSaveToast = null;     // { text, time } for Ctrl+S feedback
let testClearTimer = null;    // setTimeout id for testMode auto-return

const lobbyOverlay = document.getElementById('lobby-overlay');
const toolbarEl = document.getElementById('toolbar');
const testModeBtn = document.getElementById('test-mode-btn');

function resizeAndRegenBg() {
  resizeCanvas();
  bgCanvas = generateBackground(canvas.cssWidth, canvas.cssHeight, canvas.dpr || 1);
}

function setPhysicsRunning(running) {
  if (running) {
    Matter.Runner.run(world.runner, world.engine);
  } else {
    Matter.Runner.stop(world.runner);
  }
}

function showLobby() {
  gameMode = 'lobby';
  endCheckReason = null;
  stageClearTime = 0;
  paused = false;
  if (testClearTimer) { clearTimeout(testClearTimer); testClearTimer = null; }
  world.clearAll();
  world.resetScore();
  setPhysicsRunning(false);
  // Exit fullscreen if active
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => { });
  }
  lobbyOverlay.classList.remove('hidden');
  toolbarEl.style.display = 'none';
  toolbar._inputEnabled = false;
  toolbar._playModeOnly = false;
  resizeAndRegenBg();
}

function enterSandboxMode() {
  gameMode = 'sandbox';
  endCheckReason = null;
  stageClearTime = 0;
  paused = false;
  lobbyOverlay.classList.add('hidden');
  toolbarEl.style.display = 'flex';
  testModeBtn.classList.remove('hidden');
  toolbar._inputEnabled = true;
  toolbar._playModeOnly = false;
  world.clearAll();
  world.resetScore();
  setPhysicsRunning(true);
  resizeAndRegenBg();
}

function enterTestMode() {
  sandboxSnapshot = world.serializeStage();
  gameMode = 'testMode';
  stageClearTime = 0;
  paused = false;
  toolbarEl.style.display = 'none';
  toolbar._inputEnabled = true;
  toolbar._playModeOnly = true;
  toolbar._tool = 'ball';
  resizeAndRegenBg();
  setPhysicsRunning(true);
}

function exitTestMode() {
  if (testClearTimer) { clearTimeout(testClearTimer); testClearTimer = null; }
  gameMode = 'sandbox';
  stageClearTime = 0;
  paused = false;
  if (sandboxSnapshot) {
    world.loadStage(sandboxSnapshot);
    sandboxSnapshot = null;
  }
  toolbarEl.style.display = 'flex';
  testModeBtn.classList.remove('hidden');
  toolbar._inputEnabled = true;
  toolbar._playModeOnly = false;
  resizeAndRegenBg();
  setPhysicsRunning(true);
}

async function enterPlayMode() {
  // Load stages from JSON files
  const entries = await loadDefaultStages();

  if (entries.length === 0) {
    const notice = document.createElement('div');
    notice.textContent = '\uC2A4\uD14C\uC774\uC9C0\uB97C \uBD88\uB7EC\uC62C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.';
    notice.style.cssText = 'position:fixed;top:20%;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#ffd700;padding:16px 32px;border-radius:8px;font-size:16px;z-index:100;pointer-events:none;';
    document.body.appendChild(notice);
    setTimeout(() => notice.remove(), 2500);
    return;
  }

  // Apply lock state based on progress
  const progress = getStageProgress();
  playStageList = entries.map(e => ({
    name: e.name,
    data: e.data,
    level: e.data.level || 0,
    locked: (e.data.level || 0) > progress + 1,
  }));

  // Find first unlocked stage to start from (or the furthest unlocked)
  const lastIdx = playStageList.findIndex(e => e.level === progress + 1);
  playStageIndex = lastIdx >= 0 ? lastIdx : 0;

  gameMode = 'play';
  endCheckReason = null;
  stageClearTime = 0;
  paused = false;
  world.resetScore();
  lobbyOverlay.classList.add('hidden');
  toolbarEl.style.display = 'none';
  testModeBtn.classList.add('hidden');
  toolbar._inputEnabled = true;
  toolbar._playModeOnly = true;
  toolbar._tool = 'ball';

  // Request fullscreen for play mode
  const appEl = document.getElementById('app');
  if (appEl.requestFullscreen && !document.fullscreenElement) {
    appEl.requestFullscreen().catch(() => { });
  }

  resizeAndRegenBg();
  loadPlayStage(playStageIndex);
}

function loadPlayStage(index) {
  playStageIndex = index;
  const entry = playStageList[playStageIndex];
  if (entry.locked) return; // cannot play locked stages
  world.loadStage(entry.data);
  localStorage.setItem('justball_lastPlayedStage', entry.name);
  endCheckReason = null;
  stageClearTime = 0;
  paused = false;
  toolbar._inputEnabled = true;
  setPhysicsRunning(true);
}

function showEndCheck(reason) {
  endCheckReason = reason;
  stageClearTime = performance.now();
  paused = true;
  toolbar._inputEnabled = false;
  setPhysicsRunning(false);

  // Save progress immediately on clear so grid renders correct state
  if (reason === 'clear') {
    const clearedLevel = playStageList[playStageIndex].level || 0;
    saveStageProgress(clearedLevel);
    // Unlock next stage
    if (playStageIndex + 1 < playStageList.length) {
      playStageList[playStageIndex + 1].locked = false;
    }
  }

  // Set cursor: next unlocked stage on clear, current on quit
  if (reason === 'clear' && playStageIndex + 1 < playStageList.length) {
    endCheckSelectedIndex = playStageIndex + 1;
  } else {
    endCheckSelectedIndex = playStageIndex;
  }
}

// Stage clear callback — mode-aware
world.onStageClear = () => {
  if (gameMode === 'play') {
    showEndCheck('clear');
  } else if (gameMode === 'testMode') {
    stageClearTime = performance.now();
    paused = true;
    setPhysicsRunning(false);
    testClearTimer = setTimeout(() => exitTestMode(), 1500);
  }
};

// Balls exhausted — stage failed (no unlock)
world.onBallsExhausted = () => {
  if (gameMode === 'play') {
    showEndCheck('exhaust');
  }
};

// ── Lobby button bindings ──────────────────────────────────────────────────
document.getElementById('btn-play-mode').addEventListener('click', enterPlayMode);
document.getElementById('btn-sandbox-mode').addEventListener('click', enterSandboxMode);
testModeBtn.addEventListener('click', () => {
  if (gameMode === 'sandbox') enterTestMode();
});

// ── Initial state: show lobby, hide toolbar ────────────────────────────────
toolbarEl.style.display = 'none';
toolbar._inputEnabled = false;

// ── Keyboard input ─────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  // Ctrl+S: quick save in sandbox mode
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
    e.preventDefault();
    if (gameMode === 'sandbox') {
      const result = toolbar.quickSave();
      if (result) {
        quickSaveToast = { text: `"${result.name}" 저장 중...`, time: performance.now() };
        result.promise.then(() => {
          quickSaveToast = { text: `"${result.name}" 파일 저장 완료`, time: performance.now() };
        }).catch(() => {
          quickSaveToast = { text: '파일 저장 실패 (개발 서버 확인)', time: performance.now() };
        });
      } else {
        quickSaveToast = { text: '먼저 인벤토리에서 스테이지를 불러오세요', time: performance.now() };
      }
    }
    return;
  }

  // ESC handling
  if (e.code === 'Escape') {
    e.preventDefault();
    if (gameMode === 'play' && endCheckReason) { showLobby(); return; }
    return;
  }

  if (e.code === 'Enter') {
    e.preventDefault();
    // Let toolbar handle first (cancel launch / close inventory)
    if (toolbar.handleEnter()) return;
    if (gameMode === 'sandbox') { showLobby(); return; }
    if (gameMode === 'testMode') { exitTestMode(); return; }
    if (gameMode === 'play' && !endCheckReason) { showEndCheck('quit'); return; }
  }

  // Space: pause toggle (sandbox / testMode only)
  if (e.code === 'Space' && e.target === document.body) {
    e.preventDefault();
    if (gameMode === 'lobby') return;
    if (endCheckReason) return;
    // In sandbox or testMode, toggle pause
    if (gameMode === 'sandbox' || gameMode === 'testMode') {
      paused = !paused;
      setPhysicsRunning(!paused);
    }
    return;
  }

  // EndCheck screen: stage grid navigation
  if (endCheckReason && gameMode === 'play') {
    const gridCols = 5;
    if (e.code === 'ArrowLeft') {
      e.preventDefault();
      endCheckSelectedIndex = Math.max(0, endCheckSelectedIndex - 1);
      return;
    }
    if (e.code === 'ArrowRight') {
      e.preventDefault();
      endCheckSelectedIndex = Math.min(playStageList.length - 1, endCheckSelectedIndex + 1);
      return;
    }
    if (e.code === 'ArrowUp') {
      e.preventDefault();
      endCheckSelectedIndex = Math.max(0, endCheckSelectedIndex - gridCols);
      return;
    }
    if (e.code === 'ArrowDown') {
      e.preventDefault();
      endCheckSelectedIndex = Math.min(playStageList.length - 1, endCheckSelectedIndex + gridCols);
      return;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      const selected = playStageList[endCheckSelectedIndex];
      if (!selected.locked) {
        loadPlayStage(endCheckSelectedIndex);
      }
      return;
    }
    if (e.code === 'KeyR') {
      e.preventDefault();
      loadPlayStage(playStageIndex);
      return;
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

/**
 * Render bodies: balls, lines (walls), stars, launcher, targets, and the
 * current wall-drawing stroke.  Accesses module-scope variables via closure.
 */
function renderBodies(ctx, W, H) {
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

      // Power boost glow
      if (body._powerBoost) {
        const pulse = Math.sin(Date.now() / 150) * 0.3 + 0.7;
        const glowR = BALL_RADIUS + 10;
        const grd = ctx.createRadialGradient(bx, by, BALL_RADIUS * 0.5, bx, by, glowR);
        grd.addColorStop(0, `rgba(255, 215, 0, ${0.5 * pulse})`);
        grd.addColorStop(1, 'rgba(255, 140, 0, 0)');
        ctx.beginPath();
        ctx.arc(bx, by, glowR, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();
      }

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

      // Plasma: pulsing electric glow + inner lightning arcs
      if (ballType === 'plasma') {
        const now = Date.now();
        const pulse = Math.sin(now / 80) * 0.5 + 0.5;
        const glowRadius = BALL_RADIUS + 6 + pulse * 8;
        const grd = ctx.createRadialGradient(bx, by, BALL_RADIUS * 0.3, bx, by, glowRadius);
        grd.addColorStop(0, 'rgba(150, 200, 255, 0.8)');
        grd.addColorStop(0.3, 'rgba(80, 100, 255, 0.5)');
        grd.addColorStop(0.6, 'rgba(120, 50, 200, 0.3)');
        grd.addColorStop(1, 'rgba(80, 0, 180, 0)');
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
      } else if (ballType === 'plasma') {
        // Dark sphere core (like a plasma globe)
        const grd = ctx.createRadialGradient(bx, by, 0, bx, by, BALL_RADIUS);
        grd.addColorStop(0, '#1a0a2e');
        grd.addColorStop(0.6, '#0d0520');
        grd.addColorStop(1, '#140830');
        ctx.fillStyle = grd;
      } else {
        ctx.fillStyle = ballColor;
      }
      ctx.fill();

      // Ball outline
      ctx.strokeStyle = ballType === 'fireball' ? 'rgba(255,150,0,0.6)' : ballType === 'plasma' ? 'rgba(0,220,255,0.6)' : 'rgba(255,255,255,0.3)';
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

      // Plasma: inner lightning discharge arcs
      if (ballType === 'plasma') {
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, BALL_RADIUS - 1, 0, Math.PI * 2);
        ctx.clip();
        const now = Date.now();
        ctx.globalCompositeOperation = 'lighter';
        // Draw 3-4 lightning branches from center to edge
        const branchCount = 3 + Math.floor((Math.sin(now / 700) + 1));
        for (let b = 0; b < branchCount; b++) {
          // Animate base angle over time, each branch offset
          const baseAngle = (now / 800 + b * Math.PI * 2 / branchCount) + Math.sin(now / 300 + b) * 0.5;
          const steps = 5;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          let px = bx, py = by;
          for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const targetX = bx + Math.cos(baseAngle) * BALL_RADIUS * t;
            const targetY = by + Math.sin(baseAngle) * BALL_RADIUS * t;
            // Zigzag jitter perpendicular to direction
            const jitter = (Math.random() - 0.5) * 8 * (1 - t * 0.3);
            const nx = -Math.sin(baseAngle);
            const ny = Math.cos(baseAngle);
            px = targetX + nx * jitter;
            py = targetY + ny * jitter;
            ctx.lineTo(px, py);
          }
          // Color: blue core fading to purple at edges
          const hue = 220 + Math.sin(now / 200 + b) * 40;
          ctx.strokeStyle = `hsla(${hue}, 100%, 75%, ${0.7 + Math.random() * 0.3})`;
          ctx.lineWidth = 1.5 + Math.random();
          ctx.stroke();
          // Bright core stroke
          ctx.beginPath();
          ctx.moveTo(bx, by);
          let qx = bx, qy = by;
          for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const targetX = bx + Math.cos(baseAngle) * BALL_RADIUS * t;
            const targetY = by + Math.sin(baseAngle) * BALL_RADIUS * t;
            const jitter = (Math.random() - 0.5) * 5 * (1 - t * 0.3);
            const nx2 = -Math.sin(baseAngle);
            const ny2 = Math.cos(baseAngle);
            qx = targetX + nx2 * jitter;
            qy = targetY + ny2 * jitter;
            ctx.lineTo(qx, qy);
          }
          ctx.strokeStyle = `rgba(200, 220, 255, ${0.4 + Math.random() * 0.3})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
        // Bright center point
        const cGrd = ctx.createRadialGradient(bx, by, 0, bx, by, 4);
        cGrd.addColorStop(0, 'rgba(220, 230, 255, 0.9)');
        cGrd.addColorStop(1, 'rgba(100, 150, 255, 0)');
        ctx.beginPath();
        ctx.arc(bx, by, 4, 0, Math.PI * 2);
        ctx.fillStyle = cGrd;
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
        // Edge rim glow
        ctx.beginPath();
        ctx.arc(bx, by, BALL_RADIUS, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(120, 80, 220, ${0.4 + Math.sin(now / 150) * 0.2})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
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
      const halfH = 5;     // half height in local space (LINE_THICKNESS / 2)

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
          const gy = -halfH + 1 + ((seed0 + k * 17) % (halfH * 2 - 2));
          const ga = 0.03 + ((seed0 + k * 53) % 8) / 100;
          const gl = 100 + ((seed0 + k * 37) % 400);
          const gox = -halfLen + ((seed0 + k * 61) % 200);
          ctx.fillStyle = `rgba(255,255,255,${ga})`;
          ctx.fillRect(gox, gy, gl, 1);
        }

        // 상단 하이라이트 & 하단 그림자로 두께감
        const gGround = ctx.createLinearGradient(0, -halfH, 0, halfH);
        gGround.addColorStop(0, 'rgba(255,255,255,0.10)');
        gGround.addColorStop(0.3, 'rgba(255,255,255,0.02)');
        gGround.addColorStop(1, 'rgba(0,0,0,0.40)');
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
        gBounce.addColorStop(0, 'rgba(255,255,200,0.20)');
        gBounce.addColorStop(0.4, 'rgba(255,255,200,0.04)');
        gBounce.addColorStop(1, 'rgba(0,0,0,0.25)');
        ctx.fillStyle = gBounce;
        ctx.fillRect(-halfLen, -halfH, halfLen * 2, halfH * 2);

      } else if (label === 'ironwall') {
        // ── 벽돌 무늬 재질 (철벽) ─────────────────────────────────────────────
        const BRICK_W = 12;  // 벽돌 가로
        const BRICK_H = 6;   // 벽돌 세로
        const MORTAR = 1.2; // 줄눈 두께

        // 바탕: 줄눈 색상 (어두운 회색)
        ctx.fillStyle = '#444444';
        ctx.fillRect(-halfLen, -halfH, halfLen * 2, halfH * 2);

        // 벽돌 채우기 (엇갈림 패턴)
        let row = 0;
        for (let by = -halfH; by < halfH; by += BRICK_H) {
          const offset = (row % 2 === 0) ? 0 : BRICK_W * 0.5;
          for (let bx = -halfLen - BRICK_W; bx < halfLen + BRICK_W; bx += BRICK_W) {
            const x = bx + offset;
            // 벽돌마다 약간 다른 밝기
            const seedB = body.id * 31 + row * 17 + Math.floor((bx + halfLen) / BRICK_W) * 7;
            const bright = 90 + (seedB * 1664525 + 1013904223 & 0x7fffffff) % 40;
            ctx.fillStyle = `rgb(${bright},${bright},${Math.floor(bright * 0.9)})`;
            ctx.fillRect(
              x + MORTAR, by + MORTAR,
              BRICK_W - MORTAR * 2, BRICK_H - MORTAR * 2
            );
          }
          row++;
        }

        // 상단 하이라이트 + 하단 그림자
        const gIron = ctx.createLinearGradient(0, -halfH, 0, halfH);
        gIron.addColorStop(0, 'rgba(255,255,255,0.12)');
        gIron.addColorStop(0.3, 'rgba(255,255,255,0.03)');
        gIron.addColorStop(1, 'rgba(0,0,0,0.30)');
        ctx.fillStyle = gIron;
        ctx.fillRect(-halfLen, -halfH, halfLen * 2, halfH * 2);

      } else if (label === 'kill') {
        // ── 균열 점토 재질 ────────────────────────────────────────────────────
        // 베이스: 짙은 적갈색
        ctx.fillStyle = '#5a0a08';
        ctx.fillRect(-halfLen, -halfH, halfLen * 2, halfH * 2);

        // 중간 레이어: 어두운 빨강
        const gKill = ctx.createLinearGradient(0, -halfH, 0, halfH);
        gKill.addColorStop(0, '#8b1a15');
        gKill.addColorStop(0.45, '#7a1210');
        gKill.addColorStop(1, '#4a0806');
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
            y: -halfH + rk(k * 3 + 2) * halfH * 2,
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
    } else if (body._type === 'star') {
      const sx = body.position.x;
      const sy = body.position.y;
      const now = Date.now();

      // Floating animation
      const floatY = Math.sin(now / 500 + body.id) * 3;
      const rotation = (now / 1000 + body.id) % (Math.PI * 2);

      // Outer glow
      const glowR = 28 + Math.sin(now / 300) * 4;
      const glow = ctx.createRadialGradient(sx, sy + floatY, 4, sx, sy + floatY, glowR);
      glow.addColorStop(0, 'rgba(255, 215, 0, 0.6)');
      glow.addColorStop(0.5, 'rgba(255, 215, 0, 0.2)');
      glow.addColorStop(1, 'rgba(255, 215, 0, 0)');
      ctx.beginPath();
      ctx.arc(sx, sy + floatY, glowR, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

      // 5-point star shape
      ctx.save();
      ctx.translate(sx, sy + floatY);
      ctx.rotate(rotation);
      ctx.beginPath();
      const outerR = 14;
      const innerR = 6;
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const a = (Math.PI * 2 * i) / 10 - Math.PI / 2;
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();

      // Golden gradient fill
      const starGrd = ctx.createRadialGradient(0, 0, 0, 0, 0, outerR);
      starGrd.addColorStop(0, '#fff8dc');
      starGrd.addColorStop(0.4, '#ffd700');
      starGrd.addColorStop(1, '#daa520');
      ctx.fillStyle = starGrd;
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    } else if (body._type === 'launcher') {
      if (cannonReady) {
        const lx = body.position.x;
        const ly = body.position.y;

        // SVG is 400x300, wheel center at (190, 210)
        const scale = 80 / 300;
        const drawW = 400 * scale;
        const drawH = 300 * scale;
        const ox = 190 * scale;
        const oy = 210 * scale;

        // Rotate barrel toward aiming direction
        const aimAngle = body._barrelAngle != null ? body._barrelAngle : CANNON_DEFAULT_ANGLE;
        const rotation = aimAngle - CANNON_DEFAULT_ANGLE;

        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(rotation);
        ctx.drawImage(cannonImg, -ox, -oy, drawW, drawH);
        ctx.restore();
      }
    } else if (body._type === 'target') {
      const tx = body.position.x;
      const ty = body.position.y;
      const now = Date.now();

      // Floating animation
      const floatY = Math.sin(now / 600 + body.id) * 4;

      // Pulsing glow
      const glowR = 32 + Math.sin(now / 400) * 5;
      const glow = ctx.createRadialGradient(tx, ty + floatY, 6, tx, ty + floatY, glowR);
      glow.addColorStop(0, 'rgba(255, 68, 68, 0.5)');
      glow.addColorStop(0.5, 'rgba(255, 136, 0, 0.2)');
      glow.addColorStop(1, 'rgba(255, 68, 68, 0)');
      ctx.beginPath();
      ctx.arc(tx, ty + floatY, glowR, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

      if (targetReady) {
        // Draw Target SVG with flag flutter (skew from bottom pivot)
        const targetH = 60;
        const aspect = targetImg.naturalWidth / targetImg.naturalHeight || 0.5;
        const targetW = targetH * aspect;
        const t = now / 1000;
        // Horizontal skew oscillation — pivot at bottom center so flag area flutters
        const skew = Math.sin(t * 3.5 + body.id) * 0.04
          + Math.sin(t * 5.2 + body.id + 1.2) * 0.02;
        ctx.save();
        ctx.translate(tx, ty + floatY + targetH / 2); // pivot at bottom
        ctx.transform(1, 0, skew, 1, 0, 0); // horizontal skew
        ctx.drawImage(targetImg, -targetW / 2, -targetH, targetW, targetH);
        ctx.restore();
      } else {
        // Fallback: draw a simple bullseye
        ctx.beginPath();
        ctx.arc(tx, ty + floatY, 18, 0, Math.PI * 2);
        ctx.fillStyle = '#ff4444';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(tx, ty + floatY, 10, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(tx, ty + floatY, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ff4444';
        ctx.fill();
      }
    }
  }

  // Draw wall endpoint handles in sandbox mode when wall tool is active
  if (toolbar.currentTool === 'wall' && !toolbar.playModeOnly && gameMode === 'sandbox') {
    const editing = toolbar.editingLineGroup;
    for (const group of world.lineGroups) {
      const isEditing = group === editing;
      const r = isEditing ? 8 : 5;
      const fillColor = isEditing ? '#ffd700' : 'rgba(255,255,255,0.8)';
      const strokeColor = isEditing ? '#ff8c00' : 'rgba(100,100,100,0.6)';
      for (const pt of group.points) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  // Draw current wall line in progress (straight line preview)
  if (toolbar.isDrawing && toolbar.currentPath.length === 2) {
    const [start, end] = toolbar.currentPath;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.strokeStyle = toolbar.currentColor;
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.stroke();
    // Draw endpoint circles for visual feedback
    for (const pt of [start, end]) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = toolbar.currentColor;
      ctx.fill();
    }
  }
}

/**
 * Render effects: launcher countdown timer, slingshot aiming guide with
 * trajectory prediction, explosion particles, launch trails, and impact sparks.
 */
function renderEffects(ctx, W, H) {
  // Draw launcher countdown timer arc
  const timerRatio = toolbar.launchTimerRatio;
  if (timerRatio > 0 && world.launcher) {
    const lx = world.launcher.position.x;
    const ly = world.launcher.position.y;
    const arcR = 28;

    // Background ring (dark)
    ctx.beginPath();
    ctx.arc(lx, ly, arcR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Countdown arc (shrinks as time passes)
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + Math.PI * 2 * timerRatio;
    // Color: green → yellow → red
    let arcR_val, arcG_val;
    if (timerRatio > 0.5) {
      arcR_val = Math.round((1 - timerRatio) * 2 * 255);
      arcG_val = 255;
    } else {
      arcR_val = 255;
      arcG_val = Math.round(timerRatio * 2 * 255);
    }
    ctx.beginPath();
    ctx.arc(lx, ly, arcR, startAngle, endAngle);
    ctx.strokeStyle = `rgba(${arcR_val}, ${arcG_val}, 50, 0.9)`;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Seconds text
    const secs = Math.ceil(timerRatio * 3);
    ctx.fillStyle = `rgba(${arcR_val}, ${arcG_val}, 50, 0.9)`;
    ctx.font = 'bold 14px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(secs + '', lx, ly - arcR - 12);
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

      // Update launcher barrel angle while aiming
      if (world.launcher) {
        world.launcher._barrelAngle = Math.atan2(ny, nx);
      }

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

      // Trajectory prediction (Verlet integration matching Matter.js)
      // Matter.js internals at 120fps (delta=8.333ms, baseDelta=16.667ms):
      //   setVelocity stores positionPrev = pos - v * (deltaTime/baseDelta)
      //   Body.update first step: correction = delta/body.deltaTime = 8.333/16.667 = 0.5
      //   So first step velocity = v * 0.5, subsequent steps correction = 1.0
      //   gravAccel = gravity.y(1.2) * scale(0.001) * delta²(69.44) = 0.0833
      //   airFriction = 1 - frictionAir(0.01) * (delta/baseDelta) = 0.995
      const speed = power;
      let tx = bx;
      let ty = by;
      let tvx = nx * speed;
      let tvy = ny * speed;
      const gravAccel = 0.0833;
      const airFriction = 0.995;
      const maxSteps = 120;
      const dotInterval = 3;

      for (let step = 0; step < maxSteps; step++) {
        // First step: correction=0.5 halves the initial velocity
        const corr = step === 0 ? 0.5 : 1.0;
        tvx = tvx * corr * airFriction;
        tvy = tvy * corr * airFriction + gravAccel;
        tx += tvx;
        ty += tvy;

        if (tx < 0 || tx > W || ty > H) break;

        if (step % dotInterval === 0) {
          const fade = 1 - step / maxSteps;
          ctx.globalAlpha = 0.4 * fade;
          ctx.beginPath();
          ctx.arc(tx, ty, 2 * fade + 1, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
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
}

/**
 * Render particle systems: debris, fire trails, plasma arcs, star collection
 * effects, and target explosion effects.
 */
function renderParticles(ctx) {
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
    grd.addColorStop(0, `rgba(${r},${g},${b},${p.life * 0.9})`);
    grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  // Update and draw plasma electric arcs (additive blending)
  world.updatePlasmaArcs();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const arc of world.plasmaArcs) {
    if (arc.spark) {
      // Spark particles
      const size = arc.size * arc.life;
      const grd = ctx.createRadialGradient(arc.x, arc.y, 0, arc.x, arc.y, size);
      grd.addColorStop(0, `rgba(200,255,255,${arc.life * 0.9})`);
      grd.addColorStop(1, `rgba(0,150,255,0)`);
      ctx.beginPath();
      ctx.arc(arc.x, arc.y, size, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();
    } else if (arc.points) {
      // Electric arc zigzag line
      ctx.beginPath();
      ctx.moveTo(arc.points[0].x, arc.points[0].y);
      for (let i = 1; i < arc.points.length; i++) {
        ctx.lineTo(arc.points[i].x, arc.points[i].y);
      }
      ctx.strokeStyle = `rgba(150,240,255,${arc.life * 0.9})`;
      ctx.lineWidth = 2 * arc.life;
      ctx.stroke();
      // Bright core
      ctx.beginPath();
      ctx.moveTo(arc.points[0].x, arc.points[0].y);
      for (let i = 1; i < arc.points.length; i++) {
        ctx.lineTo(arc.points[i].x, arc.points[i].y);
      }
      ctx.strokeStyle = `rgba(220,255,255,${arc.life * 0.7})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  // Update and draw star collection effects (additive blending)
  world.updateStarEffects();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of world.starEffects) {
    ctx.globalAlpha = p.life;
    if (p.flash) {
      const radius = p.size * (1 - p.life * 0.5);
      const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      grd.addColorStop(0, `rgba(255, 255, 200, ${p.life * 0.8})`);
      grd.addColorStop(1, 'rgba(255, 215, 0, 0)');
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  // Update and draw target explosion effects (additive blending)
  world.updateTargetEffects();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of world.targetEffects) {
    ctx.globalAlpha = p.life;
    if (p.flash) {
      const radius = p.size * (1 - p.life * 0.3);
      const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      grd.addColorStop(0, `rgba(255, 255, 200, ${p.life * 0.9})`);
      grd.addColorStop(0.4, `rgba(255, 136, 0, ${p.life * 0.5})`);
      grd.addColorStop(1, 'rgba(255, 68, 0, 0)');
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/**
 * Render UI overlays: score display, power mode indicator, score popups,
 * stage-clear screen, pause overlay, and the status bar text.
 */
function renderUI(ctx, W, H) {
  // Score UI (top-left)
  if (world.score > 0 || scorePopups.length > 0) {
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 20px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`\u2605 ${world.score}`, 12, 12);

    // Power mode indicator
    if (toolbar.powerMode) {
      ctx.fillStyle = '#ff6600';
      ctx.font = 'bold 14px "Segoe UI", sans-serif';
      ctx.fillText('POWER [Q]', 12, 38);
    }

    // Score popups
    for (let i = scorePopups.length - 1; i >= 0; i--) {
      const pop = scorePopups[i];
      ctx.globalAlpha = pop.life;
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 16px "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`+${pop.value}`, pop.x + 60, pop.y - (1 - pop.life) * 30);
      pop.life -= 0.02;
      if (pop.life <= 0) scorePopups.splice(i, 1);
    }
    ctx.globalAlpha = 1;
  }

  // Balls remaining (top-left, below score)
  if (world.maxBalls > 0) {
    const remaining = world.ballsRemaining;
    const ballY = (world.score > 0 || scorePopups.length > 0) ? 38 : 12;
    ctx.fillStyle = remaining > 0 ? '#42a5f5' : '#ef5350';
    ctx.font = 'bold 16px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`\u26AA ${remaining} / ${world.maxBalls}`, 12, ballY);
  }

  // Stage clear / end-check overlays (mode-aware)
  if (stageClearTime > 0) {
    const elapsed = (performance.now() - stageClearTime) / 1000;
    ctx.fillStyle = `rgba(0,0,0,${Math.min(0.55, elapsed * 1.5)})`;
    ctx.fillRect(0, 0, W, H);

    if (gameMode === 'play' && endCheckReason) {
      // ── Play mode end-check: title ─────────────────────────────────────
      const title = endCheckReason === 'clear' ? 'STAGE CLEAR!'
        : endCheckReason === 'exhaust' ? '\uACF5\uC774 \uBD80\uC871\uD569\uB2C8\uB2E4!'
          : '\uC2A4\uD14C\uC774\uC9C0 \uC885\uB8CC';
      const titleColor = endCheckReason === 'clear' ? '#ffd700'
        : endCheckReason === 'exhaust' ? '#ef5350'
          : '#ffffff';
      const shadowColor = endCheckReason === 'clear' ? '#ff8800'
        : endCheckReason === 'exhaust' ? '#b71c1c'
          : '#666666';
      const titleY = Math.min(H * 0.18, 120);

      const pulse = 1 + Math.sin(elapsed * 3) * 0.04;
      ctx.save();
      ctx.translate(W / 2, titleY);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = titleColor;
      ctx.font = 'bold 48px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = shadowColor;
      ctx.shadowBlur = 20;
      ctx.fillText(title, 0, 0);
      ctx.shadowBlur = 0;
      ctx.restore();

      // Sparkles for clear (around title)
      if (endCheckReason === 'clear') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 12; i++) {
          const angle = (Math.PI * 2 * i) / 12 + elapsed * 0.5;
          const dist = 70 + Math.sin(elapsed * 2 + i) * 25;
          const sx = W / 2 + Math.cos(angle) * dist;
          const sy = titleY + Math.sin(angle) * dist;
          ctx.globalAlpha = 0.4 + Math.sin(elapsed * 4 + i * 0.8) * 0.3;
          ctx.beginPath();
          ctx.arc(sx, sy, 3, 0, Math.PI * 2);
          ctx.fillStyle = i % 2 === 0 ? '#ffd700' : '#ffffff';
          ctx.fill();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      }

      // ── Stage grid with minimap ─────────────────────────────────────
      const progress = getStageProgress();
      const cols = 5;
      const boxW = 120, boxH = 100, gap = 14;
      const rows = Math.ceil(playStageList.length / cols);
      const gridW = cols * boxW + (cols - 1) * gap;
      const gridStartX = (W - gridW) / 2;
      const gridStartY = titleY + 60;

      for (let i = 0; i < playStageList.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = gridStartX + col * (boxW + gap);
        const y = gridStartY + row * (boxH + gap);
        const stage = playStageList[i];
        const isSelected = i === endCheckSelectedIndex;
        const isCurrent = i === playStageIndex;
        const isCleared = (stage.level || 0) <= progress;
        const isLocked = stage.locked;

        // Box background
        ctx.fillStyle = isLocked ? 'rgba(40,40,40,0.85)' : isSelected ? 'rgba(255,215,0,0.15)' : 'rgba(20,20,40,0.9)';
        ctx.beginPath();
        ctx.roundRect(x, y, boxW, boxH, 8);
        ctx.fill();

        // Border
        ctx.strokeStyle = isSelected ? '#ffd700' : isCurrent ? '#42a5f5' : 'rgba(255,255,255,0.15)';
        ctx.lineWidth = isSelected ? 3 : 1;
        ctx.stroke();

        // Minimap preview (draw stage lines scaled to fit box)
        if (!isLocked && stage.data.lines && stage.data.lines.length > 0) {
          const ds = stage.data.designSize || { w: 1024, h: 768 };
          const pad = 8;
          const mapW = boxW - pad * 2;
          const mapH = boxH - 24 - pad; // leave room for level label at top
          const mapX = x + pad;
          const mapY = y + 20;
          const scX = mapW / ds.w;
          const scY = mapH / ds.h;

          ctx.save();
          ctx.beginPath();
          ctx.roundRect(mapX, mapY, mapW, mapH, 4);
          ctx.clip();

          for (const line of stage.data.lines) {
            if (!line.points || line.points.length < 2) continue;
            ctx.beginPath();
            ctx.moveTo(mapX + line.points[0].x * scX, mapY + line.points[0].y * scY);
            for (let p = 1; p < line.points.length; p++) {
              ctx.lineTo(mapX + line.points[p].x * scX, mapY + line.points[p].y * scY);
            }
            ctx.strokeStyle = line.color || '#555';
            ctx.lineWidth = 2;
            ctx.stroke();
          }

          // Draw targets as small dots
          if (stage.data.targets) {
            for (const t of stage.data.targets) {
              ctx.beginPath();
              ctx.arc(mapX + t.x * scX, mapY + t.y * scY, 3, 0, Math.PI * 2);
              ctx.fillStyle = '#e74c3c';
              ctx.fill();
            }
          }

          // Draw launcher as small dot
          if (stage.data.launcher) {
            ctx.beginPath();
            ctx.arc(mapX + stage.data.launcher.x * scX, mapY + stage.data.launcher.y * scY, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#aaa';
            ctx.fill();
          }

          ctx.restore();
        }

        // Level number (top-left corner)
        ctx.fillStyle = isLocked ? '#555' : isCleared ? '#4caf50' : '#fff';
        ctx.font = 'bold 13px "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(String(stage.level || i + 1), x + 8, y + 5);

        // Status badge (top-right corner)
        if (isLocked) {
          ctx.font = '14px sans-serif';
          ctx.textAlign = 'right';
          ctx.fillStyle = '#555';
          ctx.fillText('\uD83D\uDD12', x + boxW - 6, y + 4);
        } else if (isCleared) {
          ctx.font = '12px sans-serif';
          ctx.textAlign = 'right';
          ctx.fillStyle = '#4caf50';
          ctx.fillText('\u2713', x + boxW - 8, y + 5);
        }
      }

      // Hint text
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '13px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('\u2190 \u2192 \uC120\uD0DD  |  Enter \uD50C\uB808\uC774  |  R \uB2E4\uC2DC\uD558\uAE30  |  ESC \uB098\uAC00\uAE30', W / 2, gridStartY + rows * (boxH + gap) + 8);
    } else if (gameMode === 'testMode') {
      // ── Test mode brief clear ───────────────────────────────────────────
      const pulse = 1 + Math.sin(elapsed * 3) * 0.04;
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 56px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = '#ff8800';
      ctx.shadowBlur = 20;
      ctx.fillText('STAGE CLEAR!', 0, 0);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '18px "Segoe UI", sans-serif';
      ctx.fillText('\uC5D0\uB514\uD130\uB85C \uB3CC\uC544\uAC11\uB2C8\uB2E4...', 0, 52);
      ctx.restore();
    }
  } else if (paused && (gameMode === 'sandbox' || gameMode === 'testMode')) {
    // Pause overlay (sandbox/testMode only)
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 48px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u23f8 PAUSED', W / 2, H / 2);
    ctx.font = '18px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('Press Space to resume', W / 2, H / 2 + 52);
  }

  // Quick-save toast
  if (quickSaveToast) {
    const elapsed = performance.now() - quickSaveToast.time;
    const duration = 1500;
    if (elapsed < duration) {
      const alpha = elapsed < duration - 400 ? 1 : (duration - elapsed) / 400;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 16px "Segoe UI", sans-serif';
      const tw = ctx.measureText(quickSaveToast.text).width;
      const px = W / 2, py = 50;
      const pad = 12;
      ctx.beginPath();
      ctx.roundRect(px - tw / 2 - pad, py - 14, tw + pad * 2, 28, 6);
      ctx.fill();
      ctx.fillStyle = '#4ade80';
      ctx.fillText(quickSaveToast.text, px, py);
      ctx.restore();
    } else {
      quickSaveToast = null;
    }
  }

  // Update status bar
  if (gameMode === 'lobby') {
    statusEl.textContent = '';
  } else if (gameMode === 'play') {
    const stageInfo = playStageList[playStageIndex] ? playStageList[playStageIndex].name : '';
    const targetStr = world.targets.length > 0 ? ` | \uD83C\uDFAF ${world.targets.length}` : '';
    const scoreStr = world.score > 0 ? ` | \u2605 ${world.score}` : '';
    statusEl.textContent = `Stage: ${stageInfo} (${playStageIndex + 1}/${playStageList.length})${targetStr}${scoreStr}`;
  } else {
    const ballType = BALL_TYPES[toolbar.selectedBallType];
    const scoreStr = world.score > 0 ? ` | \u2605 ${world.score}` : '';
    const powerStr = toolbar.powerMode ? ' | POWER ON' : '';
    const targetStr = world.targets.length > 0 ? ` | \uD83C\uDFAF ${world.targets.length}` : '';
    const modeStr = gameMode === 'testMode' ? ' | TEST MODE' : '';
    statusEl.textContent = `Bodies: ${world.bodyCount} | Ball: ${ballType.name}${scoreStr}${powerStr}${targetStr}${modeStr}${paused ? '  |  PAUSED (Space)' : ''}`;
  }
}

function render() {
  const dpr = canvas.dpr || 1;
  const W = canvas.cssWidth || canvas.width;
  const H = canvas.cssHeight || canvas.height;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  // Draw cached background (stars, nebula, grid)
  ctx.drawImage(bgCanvas, 0, 0, W, H);

  renderBodies(ctx, W, H);
  renderEffects(ctx, W, H);
  renderParticles(ctx);
  renderUI(ctx, W, H);

  // Debug: expose render state
  ctx.restore();

  requestAnimationFrame(render);
}

render();
