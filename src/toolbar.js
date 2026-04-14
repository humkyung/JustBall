import { BALL_TYPES } from './physics.js';
import { getAllStages, saveStage, deleteStage, getProgress, persistDB } from './db.js';

// ── Launch speed constants ──────────────────────────────────────────────────
const LAUNCH_SPEED_MULTIPLIER = 0.15; // drag distance → speed conversion
const LAUNCH_MAX_SPEED = 30;          // maximum launch speed
const LAUNCH_MIN_DRAG = 5;            // minimum drag distance to fire (px)

const LINE_COLORS = [
  { type: 'ground', color: '#333333', label: '일반 선', desc: '기본 지형선. 내구도 50.', rotating: false, moving: false },
  { type: 'bounce', color: '#f5c542', label: '트램펄린 선', desc: '공을 강하게 튕겨낸다. 내구도 15.', rotating: false, moving: false },
  { type: 'kill', color: '#e74c3c', label: 'Kill 선', desc: '닿으면 공이 파괴된다. 파괴 불가.', rotating: false, moving: false },
  { type: 'ground', color: '#333333', label: '회전 벽', desc: '360도 회전하는 벽. 일반 선 재질.', rotating: true, moving: false },
  { type: 'ground', color: '#333333', label: '움직이는 벽', desc: '길이 방향으로 반복해서 이동하는 벽.', rotating: false, moving: true },
  { type: 'ironwall', color: '#808080', label: '철벽', desc: '파괴 불가능한 벽. 벽돌 무늬.', rotating: false, moving: false },
];

export class Toolbar {
  constructor(world, canvas, sound) {
    this._world = world;
    this._canvas = canvas;
    this._sound = sound;
    this._tool = 'ball';
    this._color = '#333333';
    this._lineType = 'ground';
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
    this._launchTimer = null; // 3-second auto-fire timer for launcher
    this._launchTimerStart = 0; // timestamp when timer started
    this._inputEnabled = true;  // disabled during lobby
    this._playModeOnly = false; // when true, only ball launching is allowed (play/test mode)
    this._loadedStageName = null;     // name of the currently loaded stage (for Ctrl+S quick save)
    this._loadedStageFilename = null; // source filename (e.g. 'stage-01.json') for file save
    // Wall editing state
    this._editingLineGroup = null;
    this._editMode = null;        // 'move' | 'endpoint'
    this._editPointIndex = 0;     // 0 = start, 1 = end
    this._editLastPos = null;     // previous frame position (for move delta)

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

      /* Stage map section */
      #inv-stage-row {
        display: flex; gap: 8px; margin-bottom: 8px;
      }
      #inv-stage-name {
        flex: 1; padding: 8px 12px; border: 2px solid #0f3460; border-radius: 6px;
        background: #1a1a2e; color: #e0e0e0; font-size: 13px; font-family: inherit;
        outline: none; box-sizing: border-box;
      }
      #inv-stage-name:focus { border-color: #533483; }
      #inv-stage-save {
        padding: 8px 16px; border: 2px solid #0f3460; border-radius: 6px;
        background: #533483; color: #fff; cursor: pointer; font-size: 13px;
        font-family: inherit; transition: all 0.15s; white-space: nowrap;
      }
      #inv-stage-save:hover { background: #7b68ee; }
      #inv-stage-list {
        max-height: 150px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;
      }
      .inv-stage-entry {
        display: flex; align-items: center; justify-content: space-between;
        padding: 8px 12px; border: 2px solid #0f3460; border-radius: 8px;
        background: #1a1a2e; transition: all 0.15s;
      }
      .inv-stage-entry:hover { border-color: #533483; }
      .inv-stage-entry-name { color: #e0e0e0; font-size: 13px; flex: 1; }
      .inv-stage-entry-btns { display: flex; gap: 6px; }
      .inv-stage-entry-btns button {
        padding: 4px 10px; border: 1px solid #0f3460; border-radius: 4px;
        background: #1a1a2e; color: #e0e0e0; cursor: pointer; font-size: 11px;
        font-family: inherit; transition: all 0.15s;
      }
      .inv-stage-entry-btns .load-btn:hover { background: #533483; }
      .inv-stage-entry-btns .export-btn:hover { background: #2e7d32; }
      .inv-stage-entry-btns .del-btn:hover { background: #e74c3c; }
      #inv-stage-import {
        width: 100%; margin-top: 8px; padding: 8px 16px;
        border: 2px dashed #0f3460; border-radius: 6px;
        background: #1a1a2e; color: #e0e0e0; cursor: pointer;
        font-size: 13px; font-family: inherit; transition: all 0.15s;
        text-align: center;
      }
      #inv-stage-import:hover { border-color: #533483; background: #0f3460; }

      /* Background image section */
      #inv-bg-row {
        display: flex; gap: 8px; margin-bottom: 8px;
      }
      #inv-bg-row button {
        flex: 1; padding: 8px 12px; border: 2px solid #0f3460; border-radius: 6px;
        background: #1a1a2e; color: #e0e0e0; cursor: pointer; font-size: 13px;
        font-family: inherit; transition: all 0.15s;
      }
      #inv-bg-select:hover { background: #533483; }
      #inv-bg-remove:hover { background: #e74c3c; }
      #inv-bg-preview {
        max-height: 80px; overflow: hidden; border-radius: 6px; text-align: center;
      }
      #inv-bg-preview img {
        max-width: 100%; max-height: 80px; border-radius: 6px; object-fit: cover;
      }

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

        <div class="inv-section inv-section-lines">
        <div class="inv-section-title">선 종류</div>
        <div id="inv-line-row"></div>
        </div>

        <div class="inv-section inv-section-bg">
          <hr class="inv-divider">
          <div class="inv-section-title">배경 이미지</div>
          <div id="inv-bg-row">
            <button id="inv-bg-select">이미지 선택</button>
            <button id="inv-bg-remove">제거</button>
          </div>
          <div id="inv-bg-preview"></div>
          <input id="inv-bg-file" type="file" accept="image/*" style="display:none">
        </div>

        <div class="inv-section inv-section-stages">
          <hr class="inv-divider">
          <div class="inv-section-title">스테이지 맵</div>
          <div id="inv-stage-row">
            <input id="inv-stage-name" type="text" placeholder="맵 이름 입력..." maxlength="30">
            <button id="inv-stage-save">저장</button>
          </div>
          <div id="inv-stage-list"></div>
        </div>

        <div id="inv-desc"></div>
      </div>
    `;

    document.getElementById('app').appendChild(overlay);
  }

  _setupInventory() {
    const overlay = document.getElementById('inventory-overlay');
    const ballGrid = document.getElementById('inv-ball-grid');
    const lineRow = document.getElementById('inv-line-row');
    const descEl = document.getElementById('inv-desc');
    const closeBtn = document.getElementById('inv-close');

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
      const isSelected = lc.color === this._color
        && lc.rotating === this._lineRotating
        && lc.moving === this._lineMoving;
      item.className = 'inv-line-item' + (isSelected ? ' selected' : '');
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
        this._lineType = lc.type;
        this._lineRotating = lc.rotating;
        this._lineMoving = lc.moving;
        descEl.textContent = lc.desc;
      });
      item.addEventListener('mouseenter', () => { descEl.textContent = lc.desc; });

      lineRow.appendChild(item);
    }

    // M key shortcut (outside inventory too)
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && e.target === document.body) {
        e.preventDefault();
        if (this._sound) this._sound.toggleBGM();
      }
    });

    // ── Stage map save/load ────────────────────────────────────────────────
    const stageNameInput = document.getElementById('inv-stage-name');
    const stageSaveBtn = document.getElementById('inv-stage-save');
    const stageListEl = document.getElementById('inv-stage-list');

    this._refreshStageList = () => {
      // Load all stages from SQLite DB
      const stages = getAllStages();
      const progress = getProgress();

      stageListEl.innerHTML = '';
      if (stages.length === 0) {
        stageListEl.innerHTML = '<div style="color:#555;font-size:12px;text-align:center;padding:8px;">저장된 맵이 없습니다</div>';
        return;
      }
      for (const stageInfo of stages) {
        const name = stageInfo.name;
        const isLocked = (stageInfo.level || 0) > progress + 1;
        stageInfo.locked = isLocked;
        const entry = document.createElement('div');
        entry.className = 'inv-stage-entry';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'inv-stage-entry-name';
        nameSpan.textContent = stageInfo.locked ? '\uD83D\uDD12 ' + name : name;
        if (stageInfo.locked) nameSpan.style.color = '#555';

        const btnsDiv = document.createElement('div');
        btnsDiv.className = 'inv-stage-entry-btns';

        const loadBtn = document.createElement('button');
        loadBtn.className = 'load-btn';
        loadBtn.textContent = '불러오기';
        if (stageInfo.locked) {
          loadBtn.disabled = true;
          loadBtn.style.opacity = '0.3';
        }
        loadBtn.addEventListener('click', () => {
          if (stageInfo.locked) return;
          this._world.loadStage(stageInfo.data);
          this._loadedStageName = name;
          this._loadedStageFilename = stageInfo.filename || null;
          if (this._onBackgroundChange) this._onBackgroundChange();
          this._closeInventory();
        });

        const exportBtn = document.createElement('button');
        exportBtn.className = 'export-btn';
        exportBtn.textContent = '내보내기';
        exportBtn.addEventListener('click', () => {
          const json = JSON.stringify(stageInfo.data, null, 2);
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${name}.json`;
          a.click();
          URL.revokeObjectURL(url);
          descEl.textContent = `"${name}" 맵을 파일로 내보냈습니다.`;
        });

        // Only show delete for user-created stages
        const delBtn = document.createElement('button');
        delBtn.className = 'del-btn';
        delBtn.textContent = '삭제';
        if (stageInfo.source === 'default') {
          delBtn.disabled = true;
          delBtn.style.opacity = '0.3';
        }
        delBtn.addEventListener('click', () => {
          if (stageInfo.source === 'default') return;
          deleteStage(name);
          persistDB();
          this._refreshStageList();
          descEl.textContent = `"${name}" 맵이 삭제되었습니다.`;
        });

        btnsDiv.appendChild(loadBtn);
        btnsDiv.appendChild(exportBtn);
        btnsDiv.appendChild(delBtn);
        entry.appendChild(nameSpan);
        entry.appendChild(btnsDiv);
        stageListEl.appendChild(entry);
      }
    };

    stageSaveBtn.addEventListener('click', () => {
      const name = stageNameInput.value.trim();
      if (!name) { descEl.textContent = '맵 이름을 입력해주세요.'; return; }
      const data = this._world.serializeStage();
      saveStage(name, data);
      persistDB();
      this._loadedStageName = name;
      stageNameInput.value = '';
      this._refreshStageList();
      descEl.textContent = `"${name}" 맵이 저장되었습니다.`;
    });

    stageNameInput.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') stageSaveBtn.click();
      e.stopPropagation();
    });
    stageNameInput.addEventListener('keyup', (e) => e.stopPropagation());

    this._refreshStageList();

    // ── Background image ────────────────────────────────────────────────────
    const bgSelectBtn = document.getElementById('inv-bg-select');
    const bgRemoveBtn = document.getElementById('inv-bg-remove');
    const bgFileInput = document.getElementById('inv-bg-file');
    const bgPreview = document.getElementById('inv-bg-preview');

    const updateBgPreview = () => {
      const src = this._world.backgroundImage;
      if (src) {
        bgPreview.innerHTML = `<img src="${src}" alt="bg">`;
      } else {
        bgPreview.innerHTML = '<div style="color:#555;font-size:12px;">설정 안 됨</div>';
      }
    };

    bgSelectBtn.addEventListener('click', () => bgFileInput.click());
    bgFileInput.addEventListener('change', () => {
      const file = bgFileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        this._world.backgroundImage = ev.target.result; // base64 data URL
        updateBgPreview();
        descEl.textContent = '배경 이미지가 설정되었습니다.';
        if (this._onBackgroundChange) this._onBackgroundChange();
      };
      reader.readAsDataURL(file);
      bgFileInput.value = '';
    });
    bgRemoveBtn.addEventListener('click', () => {
      this._world.backgroundImage = null;
      updateBgPreview();
      descEl.textContent = '배경 이미지가 제거되었습니다.';
      if (this._onBackgroundChange) this._onBackgroundChange();
    });

    // Refresh preview when inventory opens
    this._updateBgPreview = updateBgPreview;

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
      // ESC is now handled centrally via handleEscape() called from main.js
      if (e.code === 'KeyQ' && e.target === document.body) {
        e.preventDefault();
        this._powerMode = !this._powerMode;
      }
    });
  }

  _openInventory() {
    this._inventoryOpen = true;
    document.getElementById('inventory-overlay').classList.remove('hidden');
    // In play/test mode, show only line types
    const playOnly = this._playModeOnly;
    document.querySelector('.inv-section-lines').style.display = playOnly ? 'none' : '';
    document.querySelector('.inv-section-bg').style.display = playOnly ? 'none' : '';
    document.querySelector('.inv-section-stages').style.display = playOnly ? 'none' : '';
    if (!playOnly) {
      if (this._refreshStageList) this._refreshStageList();
      if (this._updateBgPreview) this._updateBgPreview();
    }
  }

  _closeInventory() {
    this._inventoryOpen = false;
    document.getElementById('inventory-overlay').classList.add('hidden');
  }

  // ── Public Enter handler (called from main.js) ────────────────────────────────
  handleEnter() {
    if (this._launchBall) {
      this._cancelLaunchTimer();
      const ball = this._launchBall;
      this._launchBall = this._launchStart = this._launchCurrent = null;
      this._world.unfreezeBody(ball);
      this._world.removeBody(ball);
      return true;
    }
    if (this._inventoryOpen) {
      this._closeInventory();
      return true;
    }
    return false;
  }

  // ── Quick save (Ctrl+S) ────────────────────────────────────────────────────
  /** Save current stage to SQLite DB. Returns stage name or null. */
  quickSave() {
    if (!this._loadedStageName) return null;
    const data = this._world.serializeStage();
    const filename = this._loadedStageFilename || null;
    saveStage(this._loadedStageName, data, 'user', filename);
    persistDB();
    return this._loadedStageName;
  }

  get loadedStageName() { return this._loadedStageName; }

  // ── Wall editing helpers ──────────────────────────────────────────────────

  _findNearestEndpoint(pos) {
    const THRESHOLD = 15;
    let best = null;
    for (const group of this._world.lineGroups) {
      for (let i = 0; i < group.points.length; i++) {
        const p = group.points[i];
        const d = Math.hypot(pos.x - p.x, pos.y - p.y);
        if (d < THRESHOLD && (!best || d < best.distance)) {
          best = { lineGroup: group, pointIndex: i, distance: d };
        }
      }
    }
    return best;
  }

  _findWallBodyAtPoint(pos) {
    const body = this._world.findBodyAtPoint(pos.x, pos.y);
    if (body && body._type === 'line') {
      const lineGroup = this._world.findLineGroupByBodyId(body.id);
      return lineGroup || null;
    }
    return null;
  }

  // ── Canvas input ────────────────────────────────────────────────────────────

  _setupCanvas() {
    this._canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    this._canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
    this._canvas.addEventListener('pointerup', (e) => this._onPointerUp(e));
    this._canvas.addEventListener('pointerleave', (e) => this._onPointerUp(e));
  }

  _getCanvasPos(e) {
    const rect = this._canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _onPointerDown(e) {
    if (!this._inputEnabled) return;
    if (this._inventoryOpen) return;
    const pos = this._getCanvasPos(e);

    if (e.ctrlKey && !this._playModeOnly) {
      const body = this._world.findBodyAtPoint(pos.x, pos.y);
      if (body) {
        this._dragging = body;
        this._dragOffset = { x: pos.x - body.position.x, y: pos.y - body.position.y };
        this._canvas.setPointerCapture(e.pointerId);
        return;
      }
    }

    // In play/test mode, only allow ball launching
    if (this._playModeOnly && this._tool !== 'ball') return;

    switch (this._tool) {
      case 'ball': {
        // Check ball limit
        if (this._world.ballsRemaining <= 0) break;
        const launcher = this._world.launcher;
        const spawnPos = launcher
          ? { x: launcher.position.x, y: launcher.position.y }
          : pos;
        const ball = this._world.addBall(spawnPos.x, spawnPos.y, this._selectedBallType);
        this._launchBall = ball;
        this._launchStart = spawnPos;
        this._launchCurrent = pos;
        this._world.freezeBody(ball);
        this._canvas.setPointerCapture(e.pointerId);
        // 3-second auto-cancel when launching from launcher
        this._startLaunchTimer(launcher);
        break;
      }
      case 'wall': {
        // In sandbox mode, check for wall editing first
        if (!this._playModeOnly) {
          // 1. Endpoint drag?
          const ep = this._findNearestEndpoint(pos);
          if (ep) {
            this._editingLineGroup = ep.lineGroup;
            this._editMode = 'endpoint';
            this._editPointIndex = ep.pointIndex;
            this._editLastPos = pos;
            this._canvas.setPointerCapture(e.pointerId);
            break;
          }
          // 2. Wall body drag?
          const wallGroup = this._findWallBodyAtPoint(pos);
          if (wallGroup) {
            this._editingLineGroup = wallGroup;
            this._editMode = 'move';
            this._editLastPos = pos;
            this._canvas.setPointerCapture(e.pointerId);
            break;
          }
        }
        // 3. Draw new wall
        this._drawing = true;
        this._currentPath = [pos, pos];
        break;
      }
      case 'eraser':
        this._world.removeBodyAtPoint(pos.x, pos.y);
        break;
      case 'boost':
        this._world.applyBoost(pos.x, pos.y);
        break;
      case 'star':
        this._world.addStar(pos.x, pos.y);
        break;
      case 'target':
        this._world.addTarget(pos.x, pos.y);
        break;
      case 'launcher': {
        const launcher = this._world.launcher;
        if (launcher) {
          // Check if clicking near the launcher (within 30px)
          const ldx = pos.x - launcher.position.x;
          const ldy = pos.y - launcher.position.y;
          if (ldx * ldx + ldy * ldy < 30 * 30) {
            // Click on launcher → spawn ball and start slingshot aiming
            const ball = this._world.addBall(launcher.position.x, launcher.position.y, this._selectedBallType);
            this._launchBall = ball;
            this._launchStart = { x: launcher.position.x, y: launcher.position.y };
            this._launchCurrent = pos;
            this._world.freezeBody(ball);
            this._canvas.setPointerCapture(e.pointerId);
            this._startLaunchTimer(launcher);
            break;
          }
        }
        // Click elsewhere → place or move launcher
        this._world.addLauncher(pos.x, pos.y);
        break;
      }
    }
  }

  _onPointerMove(e) {
    if (!this._inputEnabled) return;
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
    // Wall editing drag
    if (this._editingLineGroup) {
      if (this._editMode === 'move') {
        const dx = pos.x - this._editLastPos.x;
        const dy = pos.y - this._editLastPos.y;
        this._world.moveLineGroup(this._editingLineGroup, dx, dy);
        this._editLastPos = pos;
      } else if (this._editMode === 'endpoint') {
        const pts = this._editingLineGroup.points.map(p => ({ x: p.x, y: p.y }));
        pts[this._editPointIndex] = { x: pos.x, y: pos.y };
        // Enforce minimum length
        const other = pts[1 - this._editPointIndex];
        if (Math.hypot(pos.x - other.x, pos.y - other.y) > 5) {
          this._world.updateLineGroupPoints(this._editingLineGroup, pts);
        }
      }
      return;
    }
    if (!this._drawing || this._tool !== 'wall') return;
    // Update end point for straight-line preview
    this._currentPath[1] = pos;
  }

  _onPointerUp(_e) {
    if (!this._inputEnabled) return;
    if (this._launchBall) {
      this._cancelLaunchTimer();
      const ball = this._launchBall;
      const start = this._launchStart;
      const end = this._launchCurrent;
      this._launchBall = this._launchStart = this._launchCurrent = null;

      const dx = start.x - end.x;
      const dy = start.y - end.y;
      const dist = Math.hypot(dx, dy);

      this._world.unfreezeBody(ball);

      if (dist > LAUNCH_MIN_DRAG) {
        const speed = Math.min(dist * LAUNCH_SPEED_MULTIPLIER, LAUNCH_MAX_SPEED);
        const nx = dx / dist;
        const ny = dy / dist;

        // Power mode: spend 10 score for 3x damage
        if (this._powerMode && this._world.spendScore(10)) {
          ball._powerBoost = true;
        }

        this._world.launchBody(ball, nx * speed, ny * speed);
        this._world.spawnLaunchEffect(ball.position.x, ball.position.y, nx, ny, speed, ball._powerBoost);
        this._world.incrementBallsUsed();
      }
      return;
    }

    if (this._dragging) { this._dragging = null; return; }
    if (this._editingLineGroup) {
      this._editingLineGroup = null;
      this._editMode = null;
      this._editPointIndex = 0;
      this._editLastPos = null;
      return;
    }
    if (!this._drawing) return;
    this._drawing = false;

    if (this._currentPath.length >= 2) {
      const start = this._currentPath[0];
      const end = this._currentPath[1];
      const dist = Math.hypot(end.x - start.x, end.y - start.y);
      if (dist > 5) { // minimum length threshold
        this._world.addLine([start, end], this._color, this._lineRotating, this._lineMoving, this._lineType);
      }
    }
    this._currentPath = [];
  }

  _startLaunchTimer(launcher) {
    this._cancelLaunchTimer();
    if (!launcher) return;
    this._launchTimerStart = Date.now();
    this._launchTimer = setTimeout(() => {
      if (this._launchBall) {
        // Auto-fire with current aiming direction
        const ball = this._launchBall;
        const start = this._launchStart;
        const end = this._launchCurrent;
        this._launchBall = this._launchStart = this._launchCurrent = null;
        this._launchTimerStart = 0;

        const dx = start.x - end.x;
        const dy = start.y - end.y;
        const dist = Math.hypot(dx, dy);

        this._world.unfreezeBody(ball);

        if (dist > 5) {
          const speed = Math.min(dist * 0.15, 30);
          const nx = dx / dist;
          const ny = dy / dist;
          if (this._powerMode && this._world.spendScore(10)) {
            ball._powerBoost = true;
          }
          this._world.launchBody(ball, nx * speed, ny * speed);
          this._world.spawnLaunchEffect(ball.position.x, ball.position.y, nx, ny, speed, ball._powerBoost);
          this._world.incrementBallsUsed();
        }
      }
    }, 3000);
  }

  _cancelLaunchTimer() {
    if (this._launchTimer) {
      clearTimeout(this._launchTimer);
      this._launchTimer = null;
    }
    this._launchTimerStart = 0;
  }

  _updateCursor() {
    switch (this._tool) {
      case 'ball':
      case 'wall':
      case 'star':
      case 'target':
      case 'launcher': this._canvas.style.cursor = 'crosshair'; break;
      case 'eraser': this._canvas.style.cursor = 'pointer'; break;
      case 'boost': this._canvas.style.cursor = 'cell'; break;
    }
  }

  // ── Getters ─────────────────────────────────────────────────────────────────

  get currentTool() { return this._tool; }
  get currentColor() { return this._color; }
  get isDrawing() { return this._drawing; }
  get currentPath() { return this._currentPath; }
  get hoverPos() { return this._hoverPos; }
  get inventoryOpen() { return this._inventoryOpen; }
  get selectedBallType() { return this._selectedBallType; }
  get powerMode() { return this._powerMode; }
  get editingLineGroup() { return this._editingLineGroup; }
  get playModeOnly() { return this._playModeOnly; }

  /** Returns 0~1 countdown ratio (1 = just started, 0 = time's up). 0 if no timer. */
  get launchTimerRatio() {
    if (!this._launchTimerStart) return 0;
    const elapsed = Date.now() - this._launchTimerStart;
    return Math.max(0, 1 - elapsed / 3000);
  }

  get launchGuide() {
    if (!this._launchBall || !this._launchStart || !this._launchCurrent) return null;
    return {
      ballPos: this._launchBall.position,
      start: this._launchStart,
      current: this._launchCurrent,
    };
  }
}
