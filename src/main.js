import Matter from 'matter-js';
import { PhysicsWorld } from './physics.js';
import { Toolbar } from './toolbar.js';
import { SoundSystem } from './sound.js';

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
const toolbar = new Toolbar(world, canvas);
const sound = new SoundSystem();

// Wire up sound callbacks
world.onBounce = (speed) => sound.playBounce(speed);
world.onKill = () => sound.playExplosion();
world.onBoost = () => sound.playBoost();

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
});

// Detect zoom changes (devicePixelRatio changes) via visualViewport
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    resizeCanvas();
    world.resize(canvas.cssWidth, canvas.cssHeight);
  });
}

const BALL_COLOR = '#7b68ee';
const BALL_RADIUS = 15;

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

  // Draw grid (subtle)
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

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
      // Selection ring for hovered ball
      if (body === hoveredBall) {
        ctx.beginPath();
        ctx.arc(body.position.x, body.position.y, BALL_RADIUS + 6, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      ctx.arc(body.position.x, body.position.y, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = BALL_COLOR;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (body._type === 'line') {
      const verts = body.vertices;
      ctx.beginPath();
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let j = 1; j < verts.length; j++) {
        ctx.lineTo(verts[j].x, verts[j].y);
      }
      ctx.closePath();
      ctx.fillStyle = body._color || COLOR_MAP[body.label] || '#333';
      ctx.fill();
    }
  }

  // Draw current pencil stroke in progress
  if (toolbar.isDrawing && toolbar.currentPath.length > 1) {
    const path = toolbar.currentPath;
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i].x, path[i].y);
    }
    ctx.strokeStyle = toolbar.currentColor;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
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
  statusEl.textContent = `Bodies: ${world.bodyCount}${paused ? '  |  PAUSED (Space)' : ''}`;

  requestAnimationFrame(render);
}

render();
