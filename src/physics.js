import Matter from 'matter-js';

// ── Game Constants ──────────────────────────────────────────────────────────
const GRAVITY = 1.2;
const PHYSICS_TIMESTEP = 1000 / 120;
const POS_ITERATIONS = 12;
const VEL_ITERATIONS = 8;
const BLAST_RADIUS = 150;
const MAGNET_RANGE = 200;
const MAGNET_STRENGTH = 0.0004;
const STAR_COLLECT_RADIUS = 33;
const TARGET_HIT_RADIUS = 37;
const IMPACT_DAMAGE_SPEED = 15;
const LINE_HP = { ground: 50, bounce: 15 };
const BOUNCY_MULT = 3.5;
const NORMAL_BOUNCE_MULT = 2.5;
const BOUNCY_MIN_SPEED = 20;
const NORMAL_MIN_SPEED = 16;
const WALL_ROTATION_SPEED = 0.008;
const LINE_THICKNESS = 10;
const MOVE_MAX_AMPLITUDE = 100;

const LINE_TYPES = {
  ground:   { color: '#333333', restitution: 0.3, friction: 0.6 },
  bounce:   { color: '#f5c542', restitution: 3.0, friction: 0.05 },
  kill:     { color: '#e74c3c', restitution: 0.3, friction: 0.6 },
  ironwall: { color: '#808080', restitution: 0.3, friction: 0.6 },
};
// Backward compat: color → type name lookup
const COLOR_TO_TYPE = Object.fromEntries(
  Object.entries(LINE_TYPES).map(([k, v]) => [v.color, k])
);

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
  plasma: {
    name: '플라즈마볼',
    radius: 15,
    density: 0.007,
    restitution: 0.5,
    friction: 0.25,
    color: '#00ffff',
    icon: '⚡',
    desc: '2초마다 전기 연쇄! 주변 공을 차례로 파괴한다.',
    chainRange: 150,
    chainInterval: 2000,
    chainCount: 3,
  },
};

export class PhysicsWorld {
  constructor(canvas) {
    this._canvas = canvas;
    this._bodies = [];

    this._engine = Matter.Engine.create({
      gravity: { x: 0, y: GRAVITY },
      positionIterations: POS_ITERATIONS,
      velocityIterations: VEL_ITERATIONS,
    });
    this._world = this._engine.world;

    this._runner = Matter.Runner.create({
      delta: PHYSICS_TIMESTEP,
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
    this.onPlasmaChain = null;

    this._debris = [];
    this._bombs = []; // Active bomb timers
    this._launchTrails = []; // Launch trail particles
    this._impactEffects = []; // Collision impact particles
    this._fireParticles = []; // Fireball flame particles
    this._plasmaArcs = []; // Plasma electric arc particles
    this._starEffects = []; // Star collection particles

    this._score = 0;
    this._maxBalls = 0;    // 0 = unlimited, >0 = max balls allowed
    this._ballsUsed = 0;   // balls launched this stage
    this._launcher = null; // Current launcher body (only one allowed)
    this.onStarCollect = null;

    this._lineGroups = []; // Line construction data for serialization
    this._targets = []; // All target bodies
    this._targetEffects = []; // Target explosion particles
    this._stageClear = false;
    this.onStageClear = null;
    this.onTargetHit = null;

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
    this._setupPlasma();
    this._setupRotatingWalls();
    this._setupStarCollection();
    this._setupTargetHit();

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
      const w = (this._canvas.cssWidth || this._canvas.width);
      const h = (this._canvas.cssHeight || this._canvas.height);
      const margin = 200;
      const now = Date.now();
      for (let i = this._bodies.length - 1; i >= 0; i--) {
        const body = this._bodies[i];
        if (body.isStatic) continue;
        const { x, y } = body.position;
        // Remove bodies that left the screen
        if (y > h + margin || y < -margin || x < -margin || x > w + margin) {
          this._removeBombTimer(body);
          this._destroyBody(i);
          continue;
        }
        // Remove balls that have been nearly stationary for too long
        if (body._type === 'ball') {
          const speed = Math.hypot(body.velocity.x, body.velocity.y);
          if (speed < 0.3) {
            if (!body._idleSince) body._idleSince = now;
            else if (now - body._idleSince > 3000) {
              this._removeBombTimer(body);
              this._destroyBody(i);
              continue;
            }
          } else {
            body._idleSince = 0;
          }
        }
      }
      // Check if all balls are used and none remain on screen (fire once)
      if (this._maxBalls > 0 && this._ballsUsed >= this._maxBalls
          && !this._stageClear && !this._ballsExhausted) {
        const hasBalls = this._bodies.some(b => b._type === 'ball');
        if (!hasBalls && this.onBallsExhausted) {
          this._ballsExhausted = true;
          this.onBallsExhausted();
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
        const multiplier = ball._ballType === 'bouncy' ? BOUNCY_MULT : NORMAL_BOUNCE_MULT;
        const minSpeed = ball._ballType === 'bouncy' ? BOUNCY_MIN_SPEED : NORMAL_MIN_SPEED;
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
        if (speed > IMPACT_DAMAGE_SPEED) {
          damage += 1;
        }

        // Power boost: 3x damage multiplier
        if (ball._powerBoost) {
          damage *= 3;
        }

        // Initialize health if not set (base durability = 10)
        if (!this._lineHealth.has(line.id)) {
          if (line.label === 'kill' || line.label === 'ironwall') {
            // Kill lines and iron walls are unbreakable
            this._lineHealth.set(line.id, Infinity);
          } else if (line.label === 'bounce') {
            this._lineHealth.set(line.id, LINE_HP.bounce);
          } else {
            this._lineHealth.set(line.id, LINE_HP.ground);
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
    // Use module-level BLAST_RADIUS constant

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

      if (b._type === 'line' && b.label !== 'kill' && b.label !== 'ironwall') {
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

  // ── Generic particle helpers ────────────────────────────────────────────────

  /**
   * Spawn particles into a target array.
   * @param {number} x - center X
   * @param {number} y - center Y
   * @param {Array} target - array to push particles into
   * @param {Object} cfg - configuration
   */
  _spawnParticles(x, y, target, {
    count, speedMin = 1, speedMax = 4, decayMin = 0.02, decayMax = 0.04,
    sizeMin = 2, sizeMax = 5, colors = ['#fff'], gravity = 0,
    uniform = false, vyOffset = 0, extra = null,
  }) {
    for (let i = 0; i < count; i++) {
      const angle = uniform
        ? (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5
        : Math.random() * Math.PI * 2;
      const speed = speedMin + Math.random() * (speedMax - speedMin);
      const p = {
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed + vyOffset,
        life: 1.0,
        decay: decayMin + Math.random() * (decayMax - decayMin),
        size: sizeMin + Math.random() * (sizeMax - sizeMin),
        color: colors[Math.floor(Math.random() * colors.length)],
        gravity,
      };
      if (extra) Object.assign(p, extra(i));
      target.push(p);
    }
  }

  /**
   * Generic particle update loop. Handles position, velocity, gravity, decay.
   * @param {Array} arr - particle array
   * @param {Function} [tickFn] - optional per-particle tick (p, i) => void
   */
  _updateParticles(arr, tickFn) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.gravity) p.vy += p.gravity;
      p.life -= p.decay;
      if (tickFn) tickFn(p, i);
      if (p.life <= 0) arr.splice(i, 1);
    }
  }

  // ── Concrete particle spawners (delegate to _spawnParticles) ───────────────

  _spawnExplosion(x, y) {
    this._spawnParticles(x, y, this._explosions, {
      count: 12, speedMin: 2, speedMax: 6,
      decayMin: 0.025, decayMax: 0.025,
      sizeMin: 3, sizeMax: 8,
      colors: ['#e74c3c', '#f39c12'],
      gravity: 0.1, uniform: true,
    });
  }

  _spawnDebris(x, y, color) {
    this._spawnParticles(x, y, this._debris, {
      count: 6 + Math.floor(Math.random() * 5),
      speedMin: 1.5, speedMax: 4.5,
      decayMin: 0.03, decayMax: 0.03,
      sizeMin: 2, sizeMax: 6,
      colors: [color || '#aaaaaa'],
      gravity: 0.15, vyOffset: -1,
      extra: () => ({
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.3,
      }),
    });
  }

  updateDebris() {
    this._updateParticles(this._debris, (p) => {
      p.vx *= 0.97;
      if (p.rotSpeed) p.rotation += p.rotSpeed;
    });
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
    this._updateParticles(this._impactEffects, (p) => {
      if (!p.flash) p.vy += 0.04;
    });
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
    this._spawnParticles(x, y, this._fireParticles, {
      count, speedMin: 1, speedMax: 5,
      decayMin: 0.03, decayMax: 0.07,
      sizeMin: 5, sizeMax: 13,
      colors: ['#ff4400'], vyOffset: -2,
      extra: () => ({ phase: Math.random() * Math.PI * 2 }),
    });
  }

  updateFireParticles() {
    this._updateParticles(this._fireParticles, (p) => {
      p.vx *= 0.96;
      p.vy -= 0.02;
    });
  }

  get fireParticles() {
    return this._fireParticles;
  }

  // ── Plasma (Electric Chain) ──────────────────────────────────────────────
  _setupPlasma() {
    Matter.Events.on(this._engine, 'afterUpdate', () => {
      const now = Date.now();
      for (const body of this._bodies) {
        if (body._ballType !== 'plasma') continue;
        const def = BALL_TYPES.plasma;
        if (!body._lastChainTime) body._lastChainTime = now;
        if (now - body._lastChainTime < def.chainInterval) continue;

        // Find nearby non-plasma balls
        const candidates = this._bodies.filter(
          b => b._type === 'ball' && b !== body && b._ballType !== 'plasma'
        );
        if (candidates.length === 0) continue;

        body._lastChainTime = now;
        let prev = body;
        const hit = new Set();
        for (let chain = 0; chain < def.chainCount; chain++) {
          let closest = null;
          let closestDist = Infinity;
          for (const c of candidates) {
            if (hit.has(c)) continue;
            const d = Math.hypot(c.position.x - prev.position.x, c.position.y - prev.position.y);
            if (d < closestDist && d <= def.chainRange) {
              closest = c;
              closestDist = d;
            }
          }
          if (!closest) break;

          hit.add(closest);
          this._spawnElectricArc(prev.position.x, prev.position.y, closest.position.x, closest.position.y);
          this._killQueue.push(closest);
          prev = closest;
        }
        if (hit.size > 0 && this.onPlasmaChain) this.onPlasmaChain();
      }
    });
  }

  _spawnElectricArc(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    const segments = 6 + Math.floor(dist / 20);
    const points = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const jitter = i === 0 || i === segments ? 0 : (Math.random() - 0.5) * 20;
      const nx = -dy / dist;
      const ny = dx / dist;
      points.push({
        x: x1 + dx * t + nx * jitter,
        y: y1 + dy * t + ny * jitter,
      });
    }
    this._plasmaArcs.push({
      points,
      life: 1.0,
      decay: 0.06,
    });
    // Spark burst at target
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 3;
      this._plasmaArcs.push({
        points: null,
        spark: true,
        x: x2, y: y2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0,
        decay: 0.06 + Math.random() * 0.04,
        size: 2 + Math.random() * 3,
      });
    }
  }

  updatePlasmaArcs() {
    this._updateParticles(this._plasmaArcs, (p) => {
      if (p.spark) p.vy += 0.05;
      else { p.vx = 0; p.vy = 0; } // arcs don't move
    });
  }

  get plasmaArcs() {
    return this._plasmaArcs;
  }

  updateExplosions() {
    this._updateParticles(this._explosions);
  }

  get explosions() {
    return this._explosions;
  }

  _destroyBody(index) {
    const body = this._bodies[index];
    const bodyId = body.id;
    Matter.Composite.remove(this._world, body);
    this._bodies.splice(index, 1);
    // Clean up lineGroups references
    for (let i = this._lineGroups.length - 1; i >= 0; i--) {
      const g = this._lineGroups[i];
      const idx = g.bodyIds.indexOf(bodyId);
      if (idx !== -1) {
        g.bodyIds.splice(idx, 1);
        if (g.bodyIds.length === 0) this._lineGroups.splice(i, 1);
      }
    }
  }

  removeBody(body) {
    const idx = this._bodies.indexOf(body);
    if (idx !== -1) {
      this._removeBombTimer(body);
      this._destroyBody(idx);
      return true;
    }
    return false;
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

  addLine(points, color, rotating = false, moving = false, type = null) {
    if (points.length < 2) return [];

    const typeName = type || COLOR_TO_TYPE[color] || 'ground';
    const props = LINE_TYPES[typeName] || LINE_TYPES.ground;
    const resolvedColor = color || props.color;
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
      const segment = Matter.Bodies.rectangle(cx, cy, length, LINE_THICKNESS, {
        isStatic: true,
        angle: angle,
        restitution: props.restitution,
        friction: props.friction,
        label: typeName,
        render: { fillStyle: resolvedColor },
      });
      segment._type = 'line';
      segment._color = resolvedColor;
      segment._lineTypeName = typeName;

      // 회전 벽
      segment._rotating = rotating;
      if (rotating) segment._rotSpeed = WALL_ROTATION_SPEED;

      // 움직이는 벽
      segment._moving = moving;
      if (moving) {
        // 길이 방향 단위 벡터 (선과 동일한 방향)
        const len = Math.hypot(dx, dy) || 1;
        segment._moveOriginX = cx;
        segment._moveOriginY = cy;
        segment._moveDirX = dx / len;
        segment._moveDirY = dy / len;
        segment._moveAmplitude = Math.min(length * 0.6, MOVE_MAX_AMPLITUDE);
        segment._movePhase = Math.random() * Math.PI * 2;     // 세그먼트별 위상 랜덤
        segment._moveSpeed = 0.9 + Math.random() * 0.4;       // 약간씩 다른 속도
      }

      Matter.Composite.add(this._world, segment);
      this._bodies.push(segment);
      createdBodies.push(segment);
    }

    if (createdBodies.length > 0) {
      this._lineGroups.push({
        points: points.map(p => ({ x: p.x, y: p.y })),
        color: resolvedColor,
        type: typeName,
        rotating,
        moving,
        bodyIds: createdBodies.map(b => b.id),
      });
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

  spawnLaunchEffect(x, y, nx, ny, speed, powerBoost = false) {
    const power = speed / 30; // 0~1
    const count = Math.floor(8 + power * 12);

    // Color scheme: golden for power boost, default blue/white otherwise
    const colorA = powerBoost ? '#ffd700' : '#ffffff';
    const colorB = powerBoost ? '#ff8c00' : '#aaccff';

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
        color: Math.random() > 0.5 ? colorA : colorB,
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
      color: powerBoost ? '#ffd700' : '#ffffff',
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
    this._updateParticles(this._launchTrails, (p) => {
      if (!p.ring && !p.streak) p.vy += 0.05;
    });
  }

  get launchTrails() {
    return this._launchTrails;
  }

  // ── Launcher ───────────────────────────────────────────────────────────────

  addLauncher(x, y) {
    this.removeLauncher();

    const launcher = Matter.Bodies.circle(x, y, 20, {
      isStatic: true,
      isSensor: true,
      label: 'launcher',
      render: { fillStyle: '#667788' },
    });
    launcher._type = 'launcher';

    Matter.Composite.add(this._world, launcher);
    this._bodies.push(launcher);
    this._launcher = launcher;
    return launcher;
  }

  removeLauncher() {
    if (this._launcher) {
      const idx = this._bodies.indexOf(this._launcher);
      if (idx !== -1) this._destroyBody(idx);
      this._launcher = null;
    }
  }

  get launcher() {
    return this._launcher;
  }

  // ── Star item ──────────────────────────────────────────────────────────────

  addStar(x, y) {
    const star = Matter.Bodies.circle(x, y, 18, {
      isStatic: true,
      isSensor: true,
      label: 'star',
      render: { fillStyle: '#ffd700' },
    });
    star._type = 'star';
    star._starValue = 10;
    Matter.Composite.add(this._world, star);
    this._bodies.push(star);
    return star;
  }

  _setupStarCollection() {

    Matter.Events.on(this._engine, 'afterUpdate', () => {
      for (let i = this._bodies.length - 1; i >= 0; i--) {
        const star = this._bodies[i];
        if (star._type !== 'star') continue;

        for (const body of this._bodies) {
          if (body._type !== 'ball') continue;
          const dx = body.position.x - star.position.x;
          const dy = body.position.y - star.position.y;
          if (dx * dx + dy * dy < STAR_COLLECT_RADIUS * STAR_COLLECT_RADIUS) {
            this._score += star._starValue;
            this._spawnStarEffect(star.position.x, star.position.y);
            if (this.onStarCollect) this.onStarCollect(star._starValue);
            this._destroyBody(i);
            break;
          }
        }
      }
    });
  }

  _spawnStarEffect(x, y) {
    this._spawnParticles(x, y, this._starEffects, {
      count: 20, speedMin: 2, speedMax: 6,
      decayMin: 0.02, decayMax: 0.04,
      sizeMin: 2, sizeMax: 6,
      colors: ['#ffd700', '#ffd700', '#fff8dc'],
      gravity: 0.05, uniform: true,
    });
    // Central flash
    this._starEffects.push({
      x, y, vx: 0, vy: 0,
      life: 1.0, decay: 0.06, size: 25,
      flash: true, color: '#ffd700',
    });
  }

  updateStarEffects() {
    this._updateParticles(this._starEffects, (p) => {
      if (!p.flash) p.vx *= 0.98;
    });
  }

  get starEffects() {
    return this._starEffects;
  }

  // ── Target item ────────────────────────────────────────────────────────────

  addTarget(x, y) {
    const target = Matter.Bodies.circle(x, y, 22, {
      isStatic: true,
      isSensor: true,
      label: 'target',
      render: { fillStyle: '#ff4444' },
    });
    target._type = 'target';
    Matter.Composite.add(this._world, target);
    this._bodies.push(target);
    this._targets.push(target);
    return target;
  }

  _setupTargetHit() {

    Matter.Events.on(this._engine, 'afterUpdate', () => {
      if (this._stageClear) return;

      for (let i = this._bodies.length - 1; i >= 0; i--) {
        const target = this._bodies[i];
        if (target._type !== 'target') continue;

        for (const body of this._bodies) {
          if (body._type !== 'ball') continue;
          const dx = body.position.x - target.position.x;
          const dy = body.position.y - target.position.y;
          if (dx * dx + dy * dy < TARGET_HIT_RADIUS * TARGET_HIT_RADIUS) {
            this._spawnTargetExplosion(target.position.x, target.position.y);
            if (this.onTargetHit) this.onTargetHit(target);

            // Remove from _targets array
            const tIdx = this._targets.indexOf(target);
            if (tIdx !== -1) this._targets.splice(tIdx, 1);

            this._destroyBody(i);

            // Check stage clear
            if (this._targets.length === 0) {
              this._stageClear = true;
              if (this.onStageClear) this.onStageClear();
            }
            break;
          }
        }
      }
    });
  }

  _spawnTargetExplosion(x, y) {
    this._spawnParticles(x, y, this._targetEffects, {
      count: 30, speedMin: 3, speedMax: 9,
      decayMin: 0.015, decayMax: 0.03,
      sizeMin: 3, sizeMax: 8,
      colors: ['#ff4444', '#ff8800', '#ffcc00', '#ffffff'],
      gravity: 0.08, uniform: true,
    });
    // Central flash
    this._targetEffects.push({
      x, y, vx: 0, vy: 0,
      life: 1.0, decay: 0.04, size: 40,
      flash: true, color: '#ffcc00',
    });
  }

  updateTargetEffects() {
    this._updateParticles(this._targetEffects, (p) => {
      if (!p.flash) p.vx *= 0.97;
    });
  }

  get targetEffects() {
    return this._targetEffects;
  }

  get targets() {
    return this._targets;
  }

  get stageClear() {
    return this._stageClear;
  }

  resetStageClear() {
    this._stageClear = false;
  }

  get score() {
    return this._score;
  }

  get maxBalls() { return this._maxBalls; }
  get ballsUsed() { return this._ballsUsed; }
  get ballsRemaining() {
    return this._maxBalls > 0 ? this._maxBalls - this._ballsUsed : Infinity;
  }
  incrementBallsUsed() { this._ballsUsed++; }

  spendScore(amount) {
    if (this._score >= amount) {
      this._score -= amount;
      return true;
    }
    return false;
  }

  clearAll() {
    this._bombs = [];
    this._plasmaArcs = [];
    this._lineHealth.clear();
    this._launcher = null;
    this._targets = [];
    this._targetEffects = [];
    this._stageClear = false;
    this._lineGroups = [];
    for (let i = this._bodies.length - 1; i >= 0; i--) {
      this._destroyBody(i);
    }
  }

  resetScore() {
    this._score = 0;
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
    const maxHealth = body.label === 'bounce' ? LINE_HP.bounce : LINE_HP.ground;
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

  // ── Line group editing API ──────────────────────────────────────────────────

  get lineGroups() { return this._lineGroups; }

  findLineGroupByBodyId(bodyId) {
    return this._lineGroups.find(g => g.bodyIds.includes(bodyId));
  }

  /** Update a lineGroup's points and rebuild its Matter.js body. */
  updateLineGroupPoints(lineGroup, newPoints) {
    // Remove old bodies
    for (const id of lineGroup.bodyIds) {
      const idx = this._bodies.findIndex(b => b.id === id);
      if (idx !== -1) {
        Matter.Composite.remove(this._world, this._bodies[idx]);
        this._bodies.splice(idx, 1);
      }
      delete this._lineHealth[id];
    }

    // Rebuild from new points
    const p1 = newPoints[0], p2 = newPoints[1];
    const cx = (p1.x + p2.x) / 2;
    const cy = (p1.y + p2.y) / 2;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.hypot(dx, dy);
    if (length < 2) return;

    const typeName = lineGroup.type || 'ground';
    const props = LINE_TYPES[typeName] || LINE_TYPES.ground;
    const angle = Math.atan2(dy, dx);

    const segment = Matter.Bodies.rectangle(cx, cy, length, LINE_THICKNESS, {
      isStatic: true,
      angle,
      restitution: props.restitution,
      friction: props.friction,
      label: typeName,
      render: { fillStyle: lineGroup.color },
    });
    segment._type = 'line';
    segment._color = lineGroup.color;
    segment._lineTypeName = typeName;
    segment._rotating = lineGroup.rotating;
    if (lineGroup.rotating) segment._rotSpeed = WALL_ROTATION_SPEED;
    segment._moving = lineGroup.moving;
    if (lineGroup.moving) {
      const len = length || 1;
      segment._moveOriginX = cx;
      segment._moveOriginY = cy;
      segment._moveDirX = dx / len;
      segment._moveDirY = dy / len;
      segment._moveAmplitude = Math.min(length * 0.6, MOVE_MAX_AMPLITUDE);
      segment._movePhase = Math.random() * Math.PI * 2;
      segment._moveSpeed = 0.9 + Math.random() * 0.4;
    }

    Matter.Composite.add(this._world, segment);
    this._bodies.push(segment);

    lineGroup.points = newPoints.map(p => ({ x: p.x, y: p.y }));
    lineGroup.bodyIds = [segment.id];
  }

  /** Move a lineGroup by delta without rebuilding the body. */
  moveLineGroup(lineGroup, dx, dy) {
    for (const id of lineGroup.bodyIds) {
      const body = this._bodies.find(b => b.id === id);
      if (body) {
        Matter.Body.setPosition(body, {
          x: body.position.x + dx,
          y: body.position.y + dy,
        });
        if (body._moving) {
          body._moveOriginX += dx;
          body._moveOriginY += dy;
        }
      }
    }
    for (const p of lineGroup.points) {
      p.x += dx;
      p.y += dy;
    }
  }

  get bodyCount() {
    return this._bodies.length;
  }

  serializeStage(level = 0, locked = false) {
    const data = {
      version: 1,
      designSize: {
        w: this._canvas.cssWidth || this._canvas.width,
        h: this._canvas.cssHeight || this._canvas.height,
      },
      level,
      locked,
      maxBalls: this._maxBalls,
      lines: this._lineGroups.map(g => ({
        points: g.points,
        color: g.color,
        type: g.type,
        rotating: g.rotating,
        moving: g.moving,
      })),
      balls: [],
      stars: [],
      targets: [],
      launcher: null,
    };

    for (const body of this._bodies) {
      if (body._type === 'ball') {
        data.balls.push({ x: body.position.x, y: body.position.y, type: body._ballType });
      } else if (body._type === 'star') {
        data.stars.push({ x: body.position.x, y: body.position.y });
      }
    }

    for (const target of this._targets) {
      data.targets.push({ x: target.position.x, y: target.position.y });
    }

    if (this._launcher) {
      data.launcher = { x: this._launcher.position.x, y: this._launcher.position.y };
    }

    return data;
  }

  loadStage(data) {
    this.clearAll();
    this._maxBalls = data.maxBalls || 0;
    this._ballsUsed = 0;
    this._ballsExhausted = false;

    // Scale coordinates if stage has a designSize different from current canvas
    const canvasW = this._canvas.cssWidth || this._canvas.width;
    const canvasH = this._canvas.cssHeight || this._canvas.height;
    const ds = data.designSize;
    const sx = ds ? canvasW / ds.w : 1;
    const sy = ds ? canvasH / ds.h : 1;
    const scaleX = (x) => x * sx;
    const scaleY = (y) => y * sy;

    if (data.lines) {
      for (const line of data.lines) {
        const pts = line.points.map(p => ({ x: scaleX(p.x), y: scaleY(p.y) }));
        this.addLine(pts, line.color, line.rotating, line.moving, line.type || null);
      }
    }

    if (data.balls) {
      for (const ball of data.balls) {
        this.addBall(scaleX(ball.x), scaleY(ball.y), ball.type);
      }
    }

    if (data.stars) {
      for (const star of data.stars) {
        this.addStar(scaleX(star.x), scaleY(star.y));
      }
    }

    if (data.targets) {
      for (const target of data.targets) {
        this.addTarget(scaleX(target.x), scaleY(target.y));
      }
    }

    if (data.launcher) {
      this.addLauncher(scaleX(data.launcher.x), scaleY(data.launcher.y));
    }
  }
}

