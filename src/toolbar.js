import { simplifyPath } from './simplify.js';

export class Toolbar {
  constructor(world, canvas) {
    this._world = world;
    this._canvas = canvas;
    this._tool = 'ball';
    this._color = '#333333';
    this._drawing = false;
    this._currentPath = [];
    this._drawingCtx = canvas.getContext('2d');
    this._hoverPos = null;
    this._dragging = null;
    this._dragOffset = { x: 0, y: 0 };

    this._setupToolbar();
    this._setupCanvas();
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

    document.querySelectorAll('.color-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.color-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this._color = btn.dataset.color;
      });
    });

    document.getElementById('clear-btn').addEventListener('click', () => {
      this._world.clearAll();
    });
  }

  _setupCanvas() {
    this._canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    this._canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
    this._canvas.addEventListener('pointerup', (e) => this._onPointerUp(e));
    this._canvas.addEventListener('pointerleave', (e) => this._onPointerUp(e));
  }

  _getCanvasPos(e) {
    const rect = this._canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  _onPointerDown(e) {
    const pos = this._getCanvasPos(e);

    // Ctrl+drag: move any body
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
      case 'ball':
        this._world.addBall(pos.x, pos.y);
        break;

      case 'pencil':
        this._drawing = true;
        this._currentPath = [pos];
        break;

      case 'eraser':
        this._world.removeBodyAtPoint(pos.x, pos.y);
        break;

      case 'boost':
        this._world.applyBoost(pos.x, pos.y);
        break;
    }
  }

  _onPointerMove(e) {
    const pos = this._getCanvasPos(e);
    this._hoverPos = pos;

    // Ctrl+drag in progress
    if (this._dragging) {
      this._world.moveBody(this._dragging, pos.x - this._dragOffset.x, pos.y - this._dragOffset.y);
      return;
    }

    if (!this._drawing || this._tool !== 'pencil') return;
    this._currentPath.push(pos);
  }

  _onPointerUp(_e) {
    if (this._dragging) {
      this._dragging = null;
      return;
    }
    if (!this._drawing) return;
    this._drawing = false;

    if (this._currentPath.length >= 2) {
      const simplified = simplifyPath(this._currentPath, 3);
      this._world.addLine(simplified, this._color);
    }
    this._currentPath = [];
  }

  _updateCursor() {
    switch (this._tool) {
      case 'ball':
      case 'pencil':
        this._canvas.style.cursor = 'crosshair';
        break;
      case 'eraser':
        this._canvas.style.cursor = 'pointer';
        break;
      case 'boost':
        this._canvas.style.cursor = 'cell';
        break;
    }
  }

  get currentTool() {
    return this._tool;
  }

  get currentColor() {
    return this._color;
  }

  get isDrawing() {
    return this._drawing;
  }

  get currentPath() {
    return this._currentPath;
  }

  get hoverPos() {
    return this._hoverPos;
  }
}
