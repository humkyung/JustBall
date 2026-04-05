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
    }
  }

  _onPointerMove(e) {
    if (!this._drawing || this._tool !== 'pencil') return;

    const pos = this._getCanvasPos(e);
    this._currentPath.push(pos);
  }

  _onPointerUp(_e) {
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
        this._canvas.style.cursor = 'crosshair';
        break;
      case 'pencil':
        this._canvas.style.cursor = 'crosshair';
        break;
      case 'eraser':
        this._canvas.style.cursor = 'pointer';
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
}
