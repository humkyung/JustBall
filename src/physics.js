import Matter from 'matter-js';

const LINE_TYPES = {
  '#333333': { label: 'ground', restitution: 0.3, friction: 0.6 },
  '#f5c542': { label: 'bounce', restitution: 3.0, friction: 0.05 },
  '#e74c3c': { label: 'kill', restitution: 0.3, friction: 0.6 },
};

// Ball type definitions
export const BALL_TYPES = {
  normal: {
    name: '기본 공',
    radius: 15,
    density: 0.006,
    restitution: 0.6,
    friction: 0.3,
    color: '#7b68ee',
    icon: '⚪',
    desc: '기본 공',
  },
  iron: {
    name: '쇠공',
    radius: 15,
    density: 0.03,
    restitution: 0.2,
    friction: 0.5,
    color: '#8a8a8a',
    icon: '⚫',
    desc: '무겁고 단단한 쇠공. 선을 쉽게 부순다.',
  },
  bouncy: {
    name: '탱탱볼',
    radius: 15,
    density: 0.003,
    restitution: 0.95,
    friction: 0.1,
    color: '#ff69b4',
    icon: '🔴',
    desc: '매우 잘 튕기는 탱탱볼.',
  },
  magnetN: {
    name: '자석볼 (N극)',
    radius: 15,
    density: 0.008,
    restitution: 0.4,
    friction: 0.3,
    color: '#ff4444',
    icon: '🔴',
    desc: 'N극 자석. 같은 극끼리 밀고, 다른 극끼리 당긴다.',
    magnet: 'N',
  },
  magnetS: {
    name: '자석볼 (S극)',
    radius: 15,
    density: 0.008,
    restitution: 0.4,
    friction: 0.3,
    color: '#4444ff',
    icon: '🔵',
    desc: 'S극 자석. 같은 극끼리 밀고, 다른 극끼리 당긴다.',
    magnet: 'S',
  },
  bomb: {
    name: '시한폭탄볼',
    radius: 15,
    density: 0.008,
    restitution: 0.4,
    friction: 0.3,
    color: '#222222',
    icon: '💣',
    desc: '5초 후 폭발! 주변 선과 공을 파괴한다.',
    fuseTime: 5000,
  },
  fireball: {
    name: '파이어볼',
    radius: 15,
    density: 0.005,
    restitution: 0.6,
    friction: 0.05,
    color: '#ff4400',
    icon: '🔥',
    desc: '불꽃을 내뿜으며 닿는 모든 공을 파괴!',
  },
};

export class PhysicsWorld {
  constructor(canvas) {
    this._canvas = canvas;
    this._bodies = [];

    this._engine = Matter.Engine.create({
      gravity: { x: 0, y: 1.2 },
      // Increase solver iterations for better collision accuracy
      positionIterations: 12,
      velocityIterations: 8,
    });
    this._world = this._engine.world;

    this._runner = Matter.Runner.create({
      // Use smaller fixed timestep for more accurate collision detection
      delta: 1000 / 120,
    });

    // Sound event callbacks (set from outside)
    this.onBounce = null;
    this.onKill = null;
    this.onImpact = null;
    this.onBoost = null;
    this.onLineBreak = null;
    this.onBombExplode = null;
    this.onLaunch = null;
    this.onTrampolineHit = null; // (bodyId, x, y, normalX, normalY)

    this._debris = [];
    this._bombs = []; // Active bomb timers
    this._launchTrails = []; // Launch trail particles
    this._impactEffects = []; // Collision impact particles
    this._fireParticles = []; // Fireball flame particles

    this._createBoundaries();
    this._setupOOBDetection();
    this._setupKillDetection();
    this._setupBounceBoost();
    this._setupBottomRescue();
    this._setupLineBreaking();
    this._setupMagnetForces();
    this._setupBombTimers();
    this._setupImpactEffects();
    this._setupFireball();
    this._setupRotatingWalls();

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
          this._removeBombTimer(body);
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
          this._spawnDebris(body.position.x, body.position.y, body._ballColor || '#7b68ee');
          if (this.onKill) this.onKill();
          this._removeBombTimer(body);
          this._destroyBody(idx);
        }
      }
    });
  }

  // Trampoline bounce improvement
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
          this._bounceQueue.push({ ball, bouncer, normal: pair.collision.normal, swapped: bodyB.label === 'bounce' });
        }
      }
    });

    Matter.Events.on(this._engine, 'afterUpdate', () => {
      const processed = new Set();
      while (this._bounceQueue.length > 0) {
        const { ball, bouncer, normal, swapped } = this._bounceQueue.pop();
        if (processed.has(ball.id)) continue;
        processed.add(ball.id);

        let nx = swapped ? normal.x : -normal.x;
        let ny = swapped ? normal.y : -normal.y;

        const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
        const multiplier = ball._ballType === 'bouncy' ? 3.5 : 2.5;
        const minSpeed = ball._ballType === 'bouncy' ? 20 : 16;
        const launchSpeed = Math.max(speed * multiplier, minSpeed);

        const dot = ball.velocity.x * nx + ball.velocity.y * ny;
        let rvx = ball.velocity.x - 2 * dot * nx;
        let rvy = ball.velocity.y - 2 * dot * ny;
        const rSpeed = Math.hypot(rvx, rvy) || 1;
        const scale = launchSpeed / rSpeed;

        Matter.Body.setVelocity(ball, { x: rvx * scale, y: rvy * scale });

        if (this.onBounce) this.onBounce(launchSpeed);
        // Notify renderer for trampoline squish effect
        if (this.onTrampolineHit) this.onTrampolineHit(bouncer.id, nx, ny, launchSpeed);
      }
    });
  }

  // Line breaking: accumulate damage from ball impacts
  _setupLineBreaking() {
    this._lineHealth = new Map(); // body.id -> health

    Matter.Events.on(this._engine, 'collisionStart', (event) => {
      for (const pair of event.pairs) {
        const { bodyA, bodyB } = pair;
        let ball = null;
        let line = null;

        if (bodyA._type === 'ball' && bodyB._type === 'line') {
          ball = bodyA; line = bodyB;
        } else if (bodyB._type === 'ball' && bodyA._type === 'line') {
          ball = bodyB; line = bodyA;
        }

        if (!ball || !line) continue;

        // Calculate impact damage: 1 per hit by default
        let damage = 1;

        // Iron balls deal 3x damage
        if (ball._ballType === 'iron') {
          damage = 3;
        }

        // Fast-moving balls deal extra damage
        const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
        if (speed > 15) {
          damage += 1;
        }

        // Initialize health if not set (base durability = 10)
        if (!this._lineHealth.has(line.id)) {
          if (line.label === 'kill') {
            // Kill lines are unbreakable
            this._lineHealth.set(line.id, Infinity);
          } else if (line.label === 'bounce') {
            // Bounce lines are tougher
            this._lineHealth.set(line.id, 15);
          } else {
            // Ground lines: base durability 50
            this._lineHealth.set(line.id, 50);
          }
        }

        const currentHealth = this._lineHealth.get(line.id);
        const newHealth = currentHealth - damage;
        this._lineHealth.set(line.id, newHealth);

        if (newHealth <= 0) {
          // Line breaks!
          const idx = this._bodies.indexOf(line);
          if (idx !== -1) {
            this._spawnDebris(line.position.x, line.position.y, line._color || '#aaa');
            this._spawnLineBreakParticles(line);
            this._lineHealth.delete(line.id);
            if (this.onLineBreak) this.onLineBreak();
            this._destroyBody(idx);
          }
        }
      }
    });
  }

  _spawnLineBreakParticles(line) {
    const verts = line.vertices;
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i];
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 3;
      this._debris.push({
        x: v.x,
        y: v.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        life: 1.0,
        size: 2 + Math.random() * 3,
        color: line._color || '#aaa',
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.4,
      });
    }
  }

  // Magnet forces: attract opposite poles, repel same poles
  _setupMagnetForces() {
    const MAGNET_RANGE = 200;
    const MAGNET_STRENGTH = 0.0004;

    Matter.Events.on(this._engine, 'afterUpdate', () => {
      const magnets = this._bodies.filter(b => b._magnet);
      for (let i = 0; i < magnets.length; i++) {
        for (let j = i + 1; j < magnets.length; j++) {
          const a = magnets[i];
          const b = magnets[j];
          const dx = b.position.x - a.position.x;
          const dy = b.position.y - a.position.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 5 || dist > MAGNET_RANGE) continue;

          const nx = dx / dist;
          const ny = dy / dist;

          // Same pole = repel, different pole = attract
          const samePolarity = a._magnet === b._magnet;
          const sign = samePolarity ? -1 : 1;

          // Force falls off with distance squared
          const force = sign * MAGNET_STRENGTH / (dist * dist) * 10000;

          Matter.Body.applyForce(a, a.position, { x: nx * force, y: ny * force });
          Matter.Body.applyForce(b, b.position, { x: -nx * force, y: -ny * force });
        }

        // Also attract/repel magnet balls toward/from nearby metal (iron) balls
        const ironBalls = this._bodies.filter(b => b._ballType === 'iron');
        for (const iron of ironBalls) {
          const a = magnets[i];
          const dx = iron.position.x - a.position.x;
          const dy = iron.position.y - a.position.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 5 || dist > MAGNET_RANGE) continue;

          const nx = dx / dist;
          const ny = dy / dist;
          // Magnets always attract iron
          const force = MAGNET_STRENGTH / (dist * dist) * 8000;

          Matter.Body.applyForce(a, a.position, { x: nx * force, y: ny * force });
          Matter.Body.applyForce(iron, iron.position, { x: -nx * force, y: -ny * force });
        }
      }
    });
  }

  // Bomb timer: explode after fuse time
  _setupBombTimers() {
    Matter.Events.on(this._engine, 'afterUpdate', () => {
      const now = Date.now();
      for (let i = this._bombs.length - 1; i >= 0; i--) {
        const bomb = this._bombs[i];
        if (now >= bomb.detonateAt) {
          this._explodeBomb(bomb.body);
          this._bombs.splice(i, 1);
        }
      }
    });
  }

  _explodeBomb(body) {
    const idx = this._bodies.indexOf(body);
    if (idx === -1) return;

    const x = body.position.x;
    const y = body.position.y;
    const BLAST_RADIUS = 150;

    // Big explosion effect
    for (let k = 0; k < 3; k++) {
      this._spawnExplosion(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 30);
    }
    this._spawnDebris(x, y, '#ff6600');
    this._spawnDebris(x, y, '#ffaa00');

    // Destroy nearby lines and push nearby balls
    const bodiesToDestroy = [];
    for (const b of this._bodies) {
      if (b === body) continue;
      const dx = b.position.x - x;
      const dy = b.position.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist > BLAST_RADIUS) continue;

      if (b._type === 'line' && b.label !== 'kill') {
        bodiesToDestroy.push(b);
      } else if (b._type === 'ball') {
        // Push away
        const force = 0.08 * (1 - dist / BLAST_RADIUS);
        const nx = dx / (dist || 1);
        const ny = dy / (dist || 1);
        Matter.Body.applyForce(b, b.position, { x: nx * force, y: ny * force });
        // Chain detonate other bombs
        if (b._ballType === 'bomb') {
          const bombEntry = this._bombs.find(e => e.body === b);
          if (bombEntry) bombEntry.detonateAt = Date.now();
        }
      }
    }

    // Destroy the bomb body itself
    this._destroyBody(idx);

    // Destroy affected lines
    for (const b of bodiesToDestroy) {
      const bIdx = this._bodies.indexOf(b);
      if (bIdx !== -1) {
        this._spawnDebris(b.position.x, b.position.y, b._color || '#aaa');
        this._lineHealth.delete(b.id);
        this._destroyBody(bIdx);
      }
    }

    if (this.onBombExplode) this.onBombExplode();
  }

  _removeBombTimer(body) {
    const idx = this._bombs.findIndex(b => b.body === body);
    if (idx !== -1) this._bombs.splice(idx, 1);
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

  // Spawn small impact particles when balls collide with anything
  _setupImpactEffects() {
    Matter.Events.on(this._engine, 'collisionStart', (event) => {
      for (const pair of event.pairs) {
        const { bodyA, bodyB } = pair;

        // Need at least one ball involved
        let ball = null;
        let other = null;
        if (bodyA._type === 'ball') { ball = bodyA; other = bodyB; }
        else if (bodyB._type === 'ball') { ball = bodyB; other = bodyA; }
        if (!ball) continue;

        // Skip walls (invisible boundaries)
        if (other.label === 'wall') continue;

        const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
        // Only spawn effects for meaningful impacts
        if (speed < 2) continue;

        // Contact point
        const contact = pair.collision.supports && pair.collision.supports[0]
          ? pair.collision.supports[0]
          : ball.position;
        const cx = contact.x || ball.position.x;
        const cy = contact.y || ball.position.y;

        // Normal direction
        const nx = pair.collision.normal.x;
        const ny = pair.collision.normal.y;

        // Scale effect by impact strength
        const intensity = Math.min(speed / 20, 1);
        const ballColor = ball._ballColor || '#7b68ee';

        // Spark particles
        const count = Math.floor(3 + intensity * 6);
        for (let i = 0; i < count; i++) {
          const spread = (Math.random() - 0.5) * 2.2;
          const baseAngle = Math.atan2(ny, nx) + spread;
          const spd = (0.5 + Math.random() * 2.5) * (0.4 + intensity);
          this._impactEffects.push({
            x: cx,
            y: cy,
            vx: Math.cos(baseAngle) * spd,
            vy: Math.sin(baseAngle) * spd,
            life: 1.0,
            decay: 0.05 + Math.random() * 0.04,
            size: 1 + Math.random() * 2 * intensity,
            color: Math.random() > 0.4 ? ballColor : '#ffffff',
          });
        }

        // Flash circle at contact
        this._impactEffects.push({
          x: cx, y: cy,
          vx: 0, vy: 0,
          life: 1.0,
          decay: 0.1,
          size: 4 + intensity * 8,
          flash: true,
          color: '#ffffff',
        });

        if (speed > 6 && this.onImpact) this.onImpact(intensity);
      }
    });
  }

  updateImpactEffects() {
    for (let i = this._impactEffects.length - 1; i >= 0; i--) {
      const p = this._impactEffects[i];
      p.x += p.vx;
      p.y += p.vy;
      if (!p.flash) {
        p.vy += 0.04;
      }
      p.life -= p.decay;
      if (p.life <= 0) {
        this._impactEffects.splice(i, 1);
      }
    }
  }

  get impactEffects() {
    return this._impactEffects;
  }

  // ── Fireball ───────────────────────────────────────────────────────────────
  _setupFireball() {
    // Kill any ball that a fireball touches
    Matter.Events.on(this._engine, 'collisionStart', (event) => {
      for (const pair of event.pairs) {
        const { bodyA, bodyB } = pair;
        let fireball = null;
        let victim = null;

        if (bodyA._ballType === 'fireball' && bodyB._type === 'ball' && bodyB !== bodyA) {
          fireball = bodyA; victim = bodyB;
        } else if (bodyB._ballType === 'fireball' && bodyA._type === 'ball' && bodyA !== bodyB) {
          fireball = bodyB; victim = bodyA;
        }

        if (fireball && victim) {
          // Burst of fire at contact point
          const mx = (fireball.position.x + victim.position.x) / 2;
          const my = (fireball.position.y + victim.position.y) / 2;
          this._spawnFireBurst(mx, my, 18);
          this._killQueue.push(victim);
          if (this.onKill) this.onKill();
        }
      }
    });

    // Spawn continuous fire trail particles for each fireball
    Matter.Events.on(this._engine, 'afterUpdate', () => {
      for (const body of this._bodies) {
        if (body._ballType !== 'fireball') continue;
        const vx = body.velocity.x;
        const vy = body.velocity.y;
        const count = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
          // Spawn behind the ball (opposite to velocity)
          const speed = Math.hypot(vx, vy) || 1;
          const ox = (-vx / speed) * (6 + Math.random() * 6);
          const oy = (-vy / speed) * (6 + Math.random() * 6);
          const spread = (Math.random() - 0.5) * 3;
          this._fireParticles.push({
            x: body.position.x + ox + spread,
            y: body.position.y + oy + spread,
            vx: (Math.random() - 0.5) * 1.2,
            vy: -(0.6 + Math.random() * 1.2), // 위로 올라감
            life: 1.0,
            decay: 0.04 + Math.random() * 0.04,
            size: 4 + Math.random() * 6,
            phase: Math.random() * Math.PI * 2,
          });
        }
      }
    });
  }

  _spawnFireBurst(x, y, count = 12) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 4;
      this._fireParticles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        life: 1.0,
        decay: 0.03 + Math.random() * 0.04,
        size: 5 + Math.random() * 8,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  updateFireParticles() {
    for (let i = this._fireParticles.length - 1; i >= 0; i--) {
      const p = this._fireParticles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.96;
      p.vy -= 0.02; // 부력 (위로 가속)
      p.life -= p.decay;
      if (p.life <= 0) this._fireParticles.splice(i, 1);
    }
  }

  get fireParticles() {
    return this._fireParticles;
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

  addBall(x, y, type = 'normal') {
    const def = BALL_TYPES[type] || BALL_TYPES.normal;
    const ball = Matter.Bodies.circle(x, y, def.radius, {
      restitution: def.restitution,
      friction: def.friction,
      density: def.density,
      render: { fillStyle: def.color },
      label: 'ball',
      // Enable CCD for fast-moving balls to prevent tunneling
      isSleeping: false,
    });
    ball._type = 'ball';
    ball._ballType = type;
    ball._ballColor = def.color;
    if (def.magnet) ball._magnet = def.magnet;

    // Enable CCD (continuous collision detection)
    Matter.Body.set(ball, {
      sleepThreshold: Infinity,
    });

    Matter.Composite.add(this._world, ball);
    this._bodies.push(ball);

    // Start bomb timer
    if (type === 'bomb' && def.fuseTime) {
      this._bombs.push({
        body: ball,
        createdAt: Date.now(),
        detonateAt: Date.now() + def.fuseTime,
      });
    }

    return ball;
  }

  addLine(points, color, rotating = false, moving = false) {
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
      const segment = Matter.Bodies.rectangle(cx, cy, length, 15, {
        isStatic: true,
        angle: angle,
        restitution: props.restitution,
        friction: props.friction,
        label: props.label,
        render: { fillStyle: color },
        chamfer: { radius: 2 },
      });
      segment._type = 'line';
      segment._color = color;

      // 회전 벽
      segment._rotating = rotating;
      if (rotating) segment._rotSpeed = 0.008;

      // 움직이는 벽
      segment._moving = moving;
      if (moving) {
        // 길이 방향 단위 벡터 (선과 동일한 방향)
        const len = Math.hypot(dx, dy) || 1;
        segment._moveOriginX = cx;
        segment._moveOriginY = cy;
        segment._moveDirX = dx / len;
        segment._moveDirY = dy / len;
        segment._moveAmplitude = Math.min(length * 0.6, 100); // 선 길이의 60%, 최대 100px
        segment._movePhase = Math.random() * Math.PI * 2;     // 세그먼트별 위상 랜덤
        segment._moveSpeed = 0.9 + Math.random() * 0.4;       // 약간씩 다른 속도
      }

      Matter.Composite.add(this._world, segment);
      this._bodies.push(segment);
      createdBodies.push(segment);
    }

    return createdBodies;
  }

  _setupRotatingWalls() {
    Matter.Events.on(this._engine, 'beforeUpdate', () => {
      const t = Date.now() / 1000;
      for (const body of this._bodies) {
        if (body._rotating) {
          Matter.Body.setAngle(body, body.angle + body._rotSpeed);
        }
        if (body._moving) {
          const offset = Math.sin(t * body._moveSpeed + body._movePhase) * body._moveAmplitude;
          Matter.Body.setPosition(body, {
            x: body._moveOriginX + body._moveDirX * offset,
            y: body._moveOriginY + body._moveDirY * offset,
          });
        }
      }
    });
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
        const color = body._color || (body._type === 'ball' ? (body._ballColor || '#7b68ee') : '#aaaaaa');
        this._spawnDebris(body.position.x, body.position.y, color);
        this._removeBombTimer(body);
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

  freezeBody(body) {
    Matter.Body.setStatic(body, true);
  }

  unfreezeBody(body) {
    Matter.Body.setStatic(body, false);
  }

  launchBody(body, vx, vy) {
    Matter.Body.setVelocity(body, { x: vx, y: vy });
  }

  spawnLaunchEffect(x, y, nx, ny, speed) {
    const power = speed / 30; // 0~1
    const count = Math.floor(8 + power * 12);

    // Burst particles spreading backward (opposite to launch dir)
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * 1.8;
      const baseAngle = Math.atan2(-ny, -nx) + spread;
      const spd = (1 + Math.random() * 3) * (0.5 + power);
      this._launchTrails.push({
        x,
        y,
        vx: Math.cos(baseAngle) * spd,
        vy: Math.sin(baseAngle) * spd,
        life: 1.0,
        decay: 0.03 + Math.random() * 0.02,
        size: 2 + Math.random() * 3,
        color: Math.random() > 0.5 ? '#ffffff' : '#aaccff',
      });
    }

    // Ring / shockwave effect (stored as a special particle)
    this._launchTrails.push({
      x, y,
      vx: 0, vy: 0,
      life: 1.0,
      decay: 0.05,
      size: 5,
      ring: true,
      maxRadius: 20 + power * 25,
      color: '#ffffff',
    });

    // Speed lines along launch direction
    const lineCount = Math.floor(3 + power * 5);
    for (let i = 0; i < lineCount; i++) {
      const offset = (Math.random() - 0.5) * 16;
      const perpX = -ny * offset;
      const perpY = nx * offset;
      const spd = (4 + Math.random() * 6) * (0.5 + power);
      this._launchTrails.push({
        x: x + perpX,
        y: y + perpY,
        vx: nx * spd,
        vy: ny * spd,
        life: 1.0,
        decay: 0.06 + Math.random() * 0.03,
        size: 1.5,
        streak: true,
        length: 6 + Math.random() * 8,
        color: '#ddeeff',
      });
    }

    if (this.onLaunch) this.onLaunch(power);
  }

  updateLaunchTrails() {
    for (let i = this._launchTrails.length - 1; i >= 0; i--) {
      const p = this._launchTrails[i];
      p.x += p.vx;
      p.y += p.vy;
      if (!p.ring && !p.streak) {
        p.vy += 0.05; // slight gravity on burst particles
      }
      p.life -= p.decay;
      if (p.life <= 0) {
        this._launchTrails.splice(i, 1);
      }
    }
  }

  get launchTrails() {
    return this._launchTrails;
  }

  clearAll() {
    this._bombs = [];
    this._lineHealth.clear();
    for (let i = this._bodies.length - 1; i >= 0; i--) {
      this._destroyBody(i);
    }
  }

  resize(w, h) {
    this._canvas.cssWidth = w;
    this._canvas.cssHeight = h;
    for (const wall of this._walls) {
      Matter.Composite.remove(this._world, wall);
    }
    this._createBoundaries();
  }

  // Get remaining fuse time for a bomb body (0-1 ratio, 1 = full)
  getBombFuseRatio(body) {
    const entry = this._bombs.find(b => b.body === body);
    if (!entry) return 0;
    const total = entry.detonateAt - entry.createdAt;
    const remaining = entry.detonateAt - Date.now();
    return Math.max(0, remaining / total);
  }

  // Get line health ratio (0-1, 1 = full)
  getLineHealthRatio(body) {
    if (!this._lineHealth.has(body.id)) return 1;
    const health = this._lineHealth.get(body.id);
    if (health === Infinity) return 1;
    const maxHealth = body.label === 'bounce' ? 15 : 50;
    return Math.max(0, Math.min(1, health / maxHealth));
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
