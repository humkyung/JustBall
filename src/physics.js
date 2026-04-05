import Matter from 'matter-js';

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

    // Sound event callbacks (set from outside)
    this.onBounce = null;
    this.onKill = null;
    this.onImpact = null;
    this.onBoost = null;

    this._debris = [];

    this._createBoundaries();
    this._setupOOBDetection();
    this._setupKillDetection();
    this._setupBounceBoost();
    this._setupBottomRescue();

    Matter.Runner.run(this._runner, this._engine);
  }

  _createBoundaries() {
    const w = this._canvas.cssWidth || this._canvas.width;
    const h = this._canvas.cssHeight || this._canvas.height;
    const thickness = 50;

    const walls = [
      Matter.Bodies.rectangle(-thickness / 2, h / 2, thickness, h * 3, { isStatic: true, label: 'wall' }),
      Matter.Bodies.rectangle(w + thickness / 2, h / 2, thickness, h * 3, { isStatic: true, label: 'wall' }),
      Matter.Bodies.rectangle(w / 2, -thickness / 2, w * 3, thickness, { isStatic: true, label: 'wall' }),
    ];

    this._walls = walls;
    Matter.Composite.add(this._world, walls);
  }

  _setupOOBDetection() {
    Matter.Events.on(this._engine, 'afterUpdate', () => {
      const limit = (this._canvas.cssHeight || this._canvas.height) + 100;
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
          this._spawnDebris(body.position.x, body.position.y, '#7b68ee');
          if (this.onKill) this.onKill();
          this._destroyBody(idx);
        }
      }
    });
  }

  // Trampoline bounce improvement: queue balls hitting bounce surfaces,
  // then apply velocity override in afterUpdate for guaranteed strong bounce.
  _setupBounceBoost() {
    this._bounceQueue = [];

    Matter.Events.on(this._engine, 'collisionStart', (event) => {
      for (const pair of event.pairs) {
        const { bodyA, bodyB } = pair;
        let ball = null;
        let bouncer = null;

        if (bodyA.label === 'bounce' && !bodyB.isStatic) {
          bouncer = bodyA; ball = bodyB;
        } else if (bodyB.label === 'bounce' && !bodyA.isStatic) {
          bouncer = bodyB; ball = bodyA;
        }

        if (ball && bouncer) {
          this._bounceQueue.push({ ball, normal: pair.collision.normal, swapped: bodyB.label === 'bounce' });
        }
      }
    });

    Matter.Events.on(this._engine, 'afterUpdate', () => {
      const processed = new Set();
      while (this._bounceQueue.length > 0) {
        const { ball, normal, swapped } = this._bounceQueue.pop();
        if (processed.has(ball.id)) continue;
        processed.add(ball.id);

        // Collision normal points from bodyA to bodyB — flip if needed
        let nx = swapped ? normal.x : -normal.x;
        let ny = swapped ? normal.y : -normal.y;

        const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
        // Ensure minimum launch speed of 16, otherwise multiply by 2.5
        const launchSpeed = Math.max(speed * 2.5, 16);

        // Reflect velocity along normal then scale up to launchSpeed
        const dot = ball.velocity.x * nx + ball.velocity.y * ny;
        let rvx = ball.velocity.x - 2 * dot * nx;
        let rvy = ball.velocity.y - 2 * dot * ny;
        const rSpeed = Math.hypot(rvx, rvy) || 1;
        const scale = launchSpeed / rSpeed;

        Matter.Body.setVelocity(ball, { x: rvx * scale, y: rvy * scale });

        if (this.onBounce) this.onBounce(launchSpeed);
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

  _spawnDebris(x, y, color) {
    const count = 6 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3;
      this._debris.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1,
        life: 1.0,
        size: 2 + Math.random() * 4,
        color: color || '#aaaaaa',
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.3,
      });
    }
  }

  updateDebris() {
    for (let i = this._debris.length - 1; i >= 0; i--) {
      const p = this._debris[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15;
      p.vx *= 0.97;
      p.rotation += p.rotSpeed;
      p.life -= 0.03;
      if (p.life <= 0) {
        this._debris.splice(i, 1);
      }
    }
  }

  get debris() {
    return this._debris;
  }

  // Apply upward nudge to balls near the bottom to escape narrow traps
  _setupBottomRescue() {
    Matter.Events.on(this._engine, 'collisionStart', (event) => {
      const h = this._canvas.cssHeight || this._canvas.height;
      const threshold = h * 0.85;
      for (const pair of event.pairs) {
        const { bodyA, bodyB } = pair;
        const candidates = [];
        if (!bodyA.isStatic && bodyA._type === 'ball') candidates.push(bodyA);
        if (!bodyB.isStatic && bodyB._type === 'ball') candidates.push(bodyB);
        for (const ball of candidates) {
          if (ball.position.y > threshold) {
            // Add upward force proportional to depth below threshold
            const depth = (ball.position.y - threshold) / (h - threshold);
            Matter.Body.applyForce(ball, ball.position, {
              x: (Math.random() - 0.5) * 0.002,
              y: -0.015 - depth * 0.02,
            });
          }
        }
      }
    });
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

  addBall(x, y) {
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

  // Apply an upward impulse to the first ball found near (x, y)
  applyBoost(x, y) {
    const found = Matter.Query.point(this._bodies, { x, y });
    for (const body of found) {
      if (body._type === 'ball') {
        Matter.Body.applyForce(body, body.position, {
          x: (Math.random() - 0.5) * 0.04,
          y: -0.07,
        });
        if (this.onBoost) this.onBoost();
        return true;
      }
    }
    return false;
  }

  removeBodyAtPoint(x, y) {
    const found = Matter.Query.point(this._bodies, { x, y });
    if (found.length > 0) {
      const body = found[0];
      const idx = this._bodies.indexOf(body);
      if (idx !== -1) {
        const color = body._color || (body._type === 'ball' ? '#7b68ee' : '#aaaaaa');
        this._spawnDebris(body.position.x, body.position.y, color);
        this._destroyBody(idx);
        return true;
      }
    }
    return false;
  }

  findBodyAtPoint(x, y) {
    const found = Matter.Query.point(this._bodies, { x, y });
    return found.length > 0 ? found[0] : null;
  }

  moveBody(body, x, y) {
    Matter.Body.setPosition(body, { x, y });
    Matter.Body.setVelocity(body, { x: 0, y: 0 });
  }

  clearAll() {
    for (let i = this._bodies.length - 1; i >= 0; i--) {
      this._destroyBody(i);
    }
  }

  resize(w, h) {
    // Store CSS dimensions so boundary/OOB logic uses correct coordinates
    this._canvas.cssWidth = w;
    this._canvas.cssHeight = h;
    for (const wall of this._walls) {
      Matter.Composite.remove(this._world, wall);
    }
    this._createBoundaries();
  }

  get bodies() {
    return this._bodies;
  }

  get engine() {
    return this._engine;
  }

  get runner() {
    return this._runner;
  }

  get bodyCount() {
    return this._bodies.length;
  }
}
