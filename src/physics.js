import Matter from 'matter-js';

const MAX_BODIES = 200;

const LINE_TYPES = {
  '#333333': { label: 'ground', restitution: 0.3, friction: 0.6 },
  '#f5c542': { label: 'bounce', restitution: 3.0, friction: 0.05 },
  '#e74c3c': { label: 'kill', restitution: 0.3, friction: 0.6 },
};

export class PhysicsWorld {
  constructor(canvas) {
    this._canvas = canvas;
    this._bodies = [];

    this._engine = Matter.Engine.create({
      gravity: { x: 0, y: 1.2 },
    });
    this._world = this._engine.world;

    this._runner = Matter.Runner.create();

    this._createBoundaries();
    this._setupOOBDetection();
    this._setupKillDetection();

    Matter.Runner.run(this._runner, this._engine);
  }

  _createBoundaries() {
    const w = this._canvas.width;
    const h = this._canvas.height;
    const thickness = 50;

    const walls = [
      // Left wall
      Matter.Bodies.rectangle(-thickness / 2, h / 2, thickness, h * 3, { isStatic: true, label: 'wall' }),
      // Right wall
      Matter.Bodies.rectangle(w + thickness / 2, h / 2, thickness, h * 3, { isStatic: true, label: 'wall' }),
      // Top wall
      Matter.Bodies.rectangle(w / 2, -thickness / 2, w * 3, thickness, { isStatic: true, label: 'wall' }),
    ];

    this._walls = walls;
    Matter.Composite.add(this._world, walls);
  }

  _setupOOBDetection() {
    Matter.Events.on(this._engine, 'afterUpdate', () => {
      const limit = this._canvas.height + 100;
      for (let i = this._bodies.length - 1; i >= 0; i--) {
        const body = this._bodies[i];
        if (!body.isStatic && body.position.y > limit) {
          this._destroyBody(i);
        }
      }
    });
  }

  _setupKillDetection() {
    this._killQueue = [];
    this._explosions = [];

    Matter.Events.on(this._engine, 'collisionStart', (event) => {
      for (const pair of event.pairs) {
        const a = pair.bodyA;
        const b = pair.bodyB;

        if (a.label === 'kill' && !b.isStatic) {
          this._killQueue.push(b);
        } else if (b.label === 'kill' && !a.isStatic) {
          this._killQueue.push(a);
        }
      }
    });

    Matter.Events.on(this._engine, 'afterUpdate', () => {
      while (this._killQueue.length > 0) {
        const body = this._killQueue.pop();
        const idx = this._bodies.indexOf(body);
        if (idx !== -1) {
          this._spawnExplosion(body.position.x, body.position.y);
          this._destroyBody(idx);
        }
      }
    });
  }

  _spawnExplosion(x, y) {
    const count = 12;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const speed = 2 + Math.random() * 4;
      this._explosions.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0,
        size: 3 + Math.random() * 5,
        color: Math.random() > 0.5 ? '#e74c3c' : '#f39c12',
      });
    }
  }

  updateExplosions() {
    for (let i = this._explosions.length - 1; i >= 0; i--) {
      const p = this._explosions[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1;
      p.life -= 0.025;
      if (p.life <= 0) {
        this._explosions.splice(i, 1);
      }
    }
  }

  get explosions() {
    return this._explosions;
  }

  _destroyBody(index) {
    const body = this._bodies[index];
    Matter.Composite.remove(this._world, body);
    this._bodies.splice(index, 1);
  }

  _enforceCap() {
    while (this._bodies.length >= MAX_BODIES) {
      // Evict oldest dynamic body first, then oldest static
      const dynIdx = this._bodies.findIndex((b) => !b.isStatic);
      if (dynIdx !== -1) {
        this._destroyBody(dynIdx);
      } else {
        this._destroyBody(0);
      }
    }
  }

  addBall(x, y) {
    this._enforceCap();
    const ball = Matter.Bodies.circle(x, y, 15, {
      restitution: 0.6,
      friction: 0.3,
      density: 0.006,
      render: { fillStyle: '#7b68ee' },
      label: 'ball',
    });
    ball._type = 'ball';
    Matter.Composite.add(this._world, ball);
    this._bodies.push(ball);
    return ball;
  }

  addLine(points, color) {
    if (points.length < 2) return [];

    const props = LINE_TYPES[color] || LINE_TYPES['#333333'];
    const createdBodies = [];

    for (let i = 0; i < points.length - 1; i++) {
      this._enforceCap();
      const p1 = points[i];
      const p2 = points[i + 1];
      const cx = (p1.x + p2.x) / 2;
      const cy = (p1.y + p2.y) / 2;
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const length = Math.hypot(dx, dy);
      if (length < 2) continue;

      const angle = Math.atan2(dy, dx);
      const segment = Matter.Bodies.rectangle(cx, cy, length, 6, {
        isStatic: true,
        angle: angle,
        restitution: props.restitution,
        friction: props.friction,
        label: props.label,
        render: { fillStyle: color },
      });
      segment._type = 'line';
      segment._color = color;
      Matter.Composite.add(this._world, segment);
      this._bodies.push(segment);
      createdBodies.push(segment);
    }

    return createdBodies;
  }

  removeBodyAtPoint(x, y) {
    const found = Matter.Query.point(this._bodies, { x, y });
    if (found.length > 0) {
      const body = found[0];
      const idx = this._bodies.indexOf(body);
      if (idx !== -1) {
        this._destroyBody(idx);
        return true;
      }
    }
    return false;
  }

  clearAll() {
    for (let i = this._bodies.length - 1; i >= 0; i--) {
      this._destroyBody(i);
    }
  }

  resize(w, h) {
    // Remove old walls and recreate
    for (const wall of this._walls) {
      Matter.Composite.remove(this._world, wall);
    }
    this._canvas.width = w;
    this._canvas.height = h;
    this._createBoundaries();
  }

  get bodies() {
    return this._bodies;
  }

  get engine() {
    return this._engine;
  }

  get bodyCount() {
    return this._bodies.length;
  }
}
