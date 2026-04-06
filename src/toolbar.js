import { simplifyPath } from './simplify.js';
import { BALL_TYPES } from './physics.js';

const LINE_COLORS = [
  { color: '#333333', label: '일반 선',      desc: '기본 지형선. 내구도 50.',                      rotating: false, moving: false },
  { color: '#f5c542', label: '트램펄린 선',  desc: '공을 강하게 튕겨낸다. 내구도 15.',            rotating: false, moving: false },
  { color: '#e74c3c', label: 'Kill 선',      desc: '닿으면 공이 파괴된다. 파괴 불가.',            rotating: false, moving: false },
  { color: '#333333', label: '회전 벽',      desc: '360도 회전하는 벽. 일반 선 재질.',            rotating: true,  moving: false },
  { color: '#333333', label: '움직이는 벽',  desc: '길이 방향으로 반복해서 이동하는 벽.',         rotating: false, moving: true  },
];

export class Toolbar {
  constructor(world, canvas, sound) {
    this._world = world;
    this._canvas = canvas;
    this._sound = sound;
    this._tool = 'ball';
    this._color = '#333333';
    this._lineRotating = false;
    this._lineMoving = false;
    this._drawing = false;
    this._currentPath = [];
    this._hoverPos = null;
    this._dragging = null;
    this._dragOffset = { x: 0, y: 0 };
    this._selectedBallType = 'normal';
    this._inventoryOpen = false;
    this._powerMode = false;
    // Ball launch state
    this._launchBall = null;
    this._launchStart = null;
    this._launchCurrent = null;

    this._setupToolbar();
    this._setupCanvas();
    this._createInventoryUI();
    this._setupInventory();
  }

  _setupToolbar() {
    document.querySelectorAll('.tool-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tool-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this._tool = btn.dataset.tool;
        this._updateCursor();
      });
    });

    document.getElementById('clear-btn').addEventListener('click', () => {
      this._world.clearAll();
    });
  }

  // ── Inventory UI ────────────────────────────────────────────────────────────

  _createInventoryUI() {
    const style = document.createElement('style');
    style.textContent = `
      #inventory-overlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.6);
        display: flex; align-items: center; justify-content: center;
        z-index: 100; backdrop-filter: blur(4px);
        animation: invFadeIn 0.15s ease;
      }
      #inventory-overlay.hidden { display: none; }
      @keyframes invFadeIn { from{opacity:0} to{opacity:1} }
      #inventory-popup {
        background: #16213e; border: 2px solid #0f3460;
        border-radius: 16px; padding: 24px;
        width: 480px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        animation: invPopIn 0.2s ease;
      }
      @keyframes invPopIn { from{transform:scale(0.9);opacity:0} to{transform:scale(1);opacity:1} }
      .inv-header {
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 16px;
      }
      .inv-header h2 { color: #e0e0e0; font-size: 20px; font-weight: 600; margin:0; }
      #inv-close {
        background: none; border: none; color: #888;
        font-size: 28px; cursor: pointer; padding: 0 4px; line-height: 1;
        transition: color 0.15s;
      }
      #inv-close:hover { color: #fff; }

      .inv-section-title {
        color: rgba(255,255,255,0.4); font-size: 11px; font-weight: 600;
        letter-spacing: 0.1em; text-transform: uppercase;
        margin: 14px 0 8px;
      }
      .inv-section-title:first-of-type { margin-top: 0; }
      .inv-divider {
        border: none; border-top: 1px solid #0f3460; margin: 14px 0;
      }

      /* Ball grid */
      #inv-ball-grid {
        display: grid; grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }
      .inv-item {
        display: flex; flex-direction: column; align-items: center; gap: 5px;
        padding: 12px 8px; border: 2px solid #0f3460; border-radius: 10px;
        background: #1a1a2e; cursor: pointer; transition: all 0.15s; user-select: none;
      }
      .inv-item:hover { background: #0f3460; border-color: #533483; transform: translateY(-2px); }
      .inv-item.selected {
        background: #533483; border-color: #7b68ee;
        box-shadow: 0 0 12px rgba(123,104,238,0.4);
      }
      .inv-ball-preview {
        width: 32px; height: 32px; border-radius: 50%;
        border: 2px solid rgba(255,255,255,0.15);
      }
      .inv-item-name { color: #e0e0e0; font-size: 11px; font-weight: 500; text-align: center; }

      /* Line color row */
      #inv-line-row {
        display: flex; gap: 10px;
      }
      .inv-line-item {
        flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px;
        padding: 10px 8px; border: 2px solid #0f3460; border-radius: 10px;
        background: #1a1a2e; cursor: pointer; transition: all 0.15s; user-select: none;
      }
      .inv-line-item:hover { background: #0f3460; border-color: #533483; transform: translateY(-2px); }
      .inv-line-item.selected {
        background: #533483; border-color: #7b68ee;
        box-shadow: 0 0 12px rgba(123,104,238,0.4);
      }
      .inv-line-preview {
        width: 100%; height: 8px; border-radius: 4px;
      }
      .inv-line-name { color: #e0e0e0; font-size: 11px; font-weight: 500; }

      /* BGM row */
      #inv-bgm-row {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 14px; border: 2px solid #0f3460; border-radius: 10px;
        background: #1a1a2e;
      }
      #inv-bgm-row span { color: #e0e0e0; font-size: 13px; }
      #inv-bgm-toggle {
        padding: 6px 20px; border: 2px solid #0f3460; border-radius: 6px;
        background: #1a1a2e; color: #e0e0e0; cursor: pointer;
        font-size: 13px; font-family: inherit; transition: all 0.15s;
      }
      #inv-bgm-toggle:hover { background: #0f3460; }
      #inv-bgm-toggle.on { background: #533483; border-color: #7b68ee; color: #fff; }

      /* Description bar */
      #inv-desc {
        color: rgba(255,255,255,0.45); font-size: 12px; text-align: center;
        min-height: 18px; margin-top: 12px;
      }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'inventory-overlay';
    overlay.className = 'hidden';

    overlay.innerHTML = `
      <div id="inventory-popup">
        <div class="inv-header">
          <h2>인벤토리</h2>
          <button id="inv-close" title="닫기 (Esc)">&times;</button>
        </div>

        <div class="inv-section-title">공 종류</div>
        <div id="inv-ball-grid"></div>

        <hr class="inv-divider">

        <div class="inv-section-title">선 종류</div>
        <div id="inv-line-row"></div>

        <hr class="inv-divider">

        <div class="inv-section-title">BGM</div>
        <div id="inv-bgm-row">
          <span>🎵 배경음악</span>
          <button id="inv-bgm-toggle" class="">OFF</button>
        </div>

        <div id="inv-desc"></div>
      </div>
    `;

    document.getElementById('app').appendChild(overlay);
  }

  _setupInventory() {
    const overlay  = document.getElementById('inventory-overlay');
    const ballGrid = document.getElementById('inv-ball-grid');
    const lineRow  = document.getElementById('inv-line-row');
    const descEl   = document.getElementById('inv-desc');
    const closeBtn = document.getElementById('inv-close');
    const bgmToggle = document.getElementById('inv-bgm-toggle');

    // ── Ball items ──────────────────────────────────────────────────────────
    for (const [key, def] of Object.entries(BALL_TYPES)) {
      const item = document.createElement('div');
      item.className = 'inv-item' + (key === this._selectedBallType ? ' selected' : '');
      item.dataset.ballType = key;

      const colorMap = {
        normal: '#7b68ee', iron: '#8a8a8a', bouncy: '#ff69b4',
        magnetN: '#ff4444', magnetS: '#4444ff', bomb: '#222222',
        fireball: '#ff4400', plasma: '#00ffff',
      };
      const preview = document.createElement('div');
      preview.className = 'inv-ball-preview';
      preview.style.background = colorMap[key] || def.color;

      const name = document.createElement('span');
      name.className = 'inv-item-name';
      name.textContent = def.name;

      item.appendChild(preview);
      item.appendChild(name);

      item.addEventListener('click', () => {
        ballGrid.querySelectorAll('.inv-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        this._selectedBallType = key;
        descEl.textContent = def.desc;
      });
      item.addEventListener('mouseenter', () => { descEl.textContent = def.desc; });

      ballGrid.appendChild(item);
    }

    // ── Line color items ────────────────────────────────────────────────────
    for (const lc of LINE_COLORS) {
      const item = document.createElement('div');
      item.className = 'inv-line-item' + (lc.color === this._color ? ' selected' : '');
      item.dataset.color = lc.color;

      const preview = document.createElement('div');
      preview.className = 'inv-line-preview';
      preview.style.background = lc.color;

      const name = document.createElement('span');
      name.className = 'inv-line-name';
      name.textContent = lc.label;

      item.appendChild(preview);
      item.appendChild(name);

      item.addEventListener('click', () => {
        lineRow.querySelectorAll('.inv-line-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        this._color = lc.color;
        this._lineRotating = lc.rotating;
        this._lineMoving = lc.moving;
        descEl.textContent = lc.desc;
      });
      item.addEventListener('mouseenter', () => { descEl.textContent = lc.desc; });

      lineRow.appendChild(item);
    }

    // ── BGM toggle ──────────────────────────────────────────────────────────
    const updateBgmBtn = () => {
      if (this._sound && this._sound.bgmPlaying) {
        bgmToggle.textContent = 'ON';
        bgmToggle.classList.add('on');
      } else {
        bgmToggle.textContent = 'OFF';
        bgmToggle.classList.remove('on');
      }
    };
    bgmToggle.addEventListener('click', () => {
      if (this._sound) this._sound.toggleBGM();
      updateBgmBtn();
    });

    // M key shortcut (outside inventory too)
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && e.target === document.body) {
        e.preventDefault();
        if (this._sound) this._sound.toggleBGM();
        updateBgmBtn();
      }
    });

    // ── Initial desc ────────────────────────────────────────────────────────
    descEl.textContent = BALL_TYPES[this._selectedBallType].desc;

    // ── Close ───────────────────────────────────────────────────────────────
    closeBtn.addEventListener('click', () => this._closeInventory());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this._closeInventory();
    });

    // ── Keyboard shortcuts ──────────────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyX' && e.target === document.body) {
        e.preventDefault();
        this._inventoryOpen ? this._closeInventory() : this._openInventory();
      }
      if (e.code === 'Escape' && this._inventoryOpen) {
        e.preventDefault();
        this._closeInventory();
      }
      if (e.code === 'KeyQ' && e.target === document.body) {
        e.preventDefault();
        this._powerMode = !this._powerMode;
      }
    });
  }

  _openInventory() {
    this._inventoryOpen = true;
    document.getElementById('inventory-overlay').classList.remove('hidden');
  }

  _closeInventory() {
    this._inventoryOpen = false;
    document.getElementById('inventory-overlay').classList.add('hidden');
  }

  // ── Canvas input ────────────────────────────────────────────────────────────

  _setupCanvas() {
    this._canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    this._canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
    this._canvas.addEventListener('pointerup',   (e) => this._onPointerUp(e));
    this._canvas.addEventListener('pointerleave',(e) => this._onPointerUp(e));
  }

  _getCanvasPos(e) {
    const rect = this._canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _onPointerDown(e) {
    if (this._inventoryOpen) return;
    const pos = this._getCanvasPos(e);

    if (e.ctrlKey) {
      const body = this._world.findBodyAtPoint(pos.x, pos.y);
      if (body) {
        this._dragging = body;
        this._dragOffset = { x: pos.x - body.position.x, y: pos.y - body.position.y };
        this._canvas.setPointerCapture(e.pointerId);
        return;
      }
    }

    switch (this._tool) {
      case 'ball': {
        const ball = this._world.addBall(pos.x, pos.y, this._selectedBallType);
        this._launchBall    = ball;
        this._launchStart   = pos;
        this._launchCurrent = pos;
        this._world.freezeBody(ball);
        this._canvas.setPointerCapture(e.pointerId);
        break;
      }
      case 'wall':
        this._drawing = true;
        this._currentPath = [pos];
        break;
      case 'eraser':
        this._world.removeBodyAtPoint(pos.x, pos.y);
        break;
      case 'boost':
        this._world.applyBoost(pos.x, pos.y);
        break;
      case 'star':
        this._world.addStar(pos.x, pos.y);
        break;
    }
  }

  _onPointerMove(e) {
    const pos = this._getCanvasPos(e);
    this._hoverPos = pos;

    if (this._launchBall) {
      this._launchCurrent = pos;
      return;
    }
    if (this._dragging) {
      this._world.moveBody(this._dragging, pos.x - this._dragOffset.x, pos.y - this._dragOffset.y);
      return;
    }
    if (!this._drawing || this._tool !== 'wall') return;
    this._currentPath.push(pos);
  }

  _onPointerUp(_e) {
    if (this._launchBall) {
      const ball  = this._launchBall;
      const start = this._launchStart;
      const end   = this._launchCurrent;
      this._launchBall = this._launchStart = this._launchCurrent = null;

      const dx   = start.x - end.x;
      const dy   = start.y - end.y;
      const dist = Math.hypot(dx, dy);

      this._world.unfreezeBody(ball);

      if (dist > 5) {
        const speed = Math.min(dist * 0.15, 30);
        const nx = dx / dist;
        const ny = dy / dist;

        // Power mode: spend 10 score for 3x damage
        if (this._powerMode && this._world.spendScore(10)) {
          ball._powerBoost = true;
        }

        this._world.launchBody(ball, nx * speed, ny * speed);
        this._world.spawnLaunchEffect(ball.position.x, ball.position.y, nx, ny, speed, ball._powerBoost);
      }
      return;
    }

    if (this._dragging) { this._dragging = null; return; }
    if (!this._drawing) return;
    this._drawing = false;

    if (this._currentPath.length >= 2) {
      const simplified = simplifyPath(this._currentPath, 3);
      this._world.addLine(simplified, this._color, this._lineRotating, this._lineMoving);
    }
    this._currentPath = [];
  }

  _updateCursor() {
    switch (this._tool) {
      case 'ball':
      case 'wall':
      case 'star':   this._canvas.style.cursor = 'crosshair'; break;
      case 'eraser':   this._canvas.style.cursor = 'pointer';   break;
      case 'boost':    this._canvas.style.cursor = 'cell';      break;
    }
  }

  // ── Getters ─────────────────────────────────────────────────────────────────

  get currentTool()  { return this._tool; }
  get currentColor() { return this._color; }
  get isDrawing()    { return this._drawing; }
  get currentPath()  { return this._currentPath; }
  get hoverPos()     { return this._hoverPos; }
  get inventoryOpen(){ return this._inventoryOpen; }
  get selectedBallType() { return this._selectedBallType; }
  get powerMode() { return this._powerMode; }

  get launchGuide() {
    if (!this._launchBall || !this._launchStart || !this._launchCurrent) return null;
    return {
      ballPos: this._launchBall.position,
      start:   this._launchStart,
      current: this._launchCurrent,
    };
  }
}
