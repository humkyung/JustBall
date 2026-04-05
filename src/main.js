import { PhysicsWorld } from './physics.js';
import { Toolbar } from './toolbar.js';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');

function resizeCanvas() {
  const toolbar = document.getElementById('toolbar');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight - toolbar.offsetHeight;
}

resizeCanvas();

const world = new PhysicsWorld(canvas);
const toolbar = new Toolbar(world, canvas);

window.addEventListener('resize', () => {
  resizeCanvas();
  world.resize(canvas.width, canvas.height);
});

const BALL_COLOR = '#7b68ee';
const BALL_RADIUS = 15;

const COLOR_MAP = {
  ground: '#333333',
  bounce: '#f5c542',
  kill: '#e74c3c',
};

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw grid (subtle)
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // Draw bodies
  for (const body of world.bodies) {
    if (body.label === 'wall') continue;

    if (body._type === 'ball') {
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
  ctx.globalAlpha = 1;

  // Update status
  statusEl.textContent = `Bodies: ${world.bodyCount}`;

  requestAnimationFrame(render);
}

render();
