(function() {
  const COLS = 178, ROWS = 140, CELL = 2;
  // Type ids index into MATERIALS below (keep the two in sync)
  const EMPTY = 0, SAND = 1, SNOW = 2, ASH = 3, DIRT = 4, WATER = 5, FIRE = 6,
        WOOD = 7, OIL = 8, STEAM = 9, PLANT = 10, SMOKE = 11;

  // add new materials here with following format:
  //   kind:         'empty' | 'powder' (falls and piles) | 'liquid' (falls and flows)
  //                 | 'gas' (rises and drifts) | 'static' (never moves)
  //                 | 'fire' (burning cell, heat source)
  //   colors:       per-cell color variants; swatch: palette CSS (defaults to colors[0])
  //   density:      falling things sink through lighter liquids/gases; gases rise
  //                 through denser liquids
  //   maxVel:       terminal falling speed, in cells per frame
  //   flow:         how many cells a liquid can spread sideways per frame
  //   flammability: 0 = never
  //   burn:         { life: [min, max] frames, into, smoke } how long it burns once
  //                 lit, what's left after, and the per-frame chance of giving off
  //                 smoke (defaults: ~20–45 frames, ash, 0.02)
  //   extinguishes: should this thing put out adjacent fire
  //   becomes:      { into, onWater, nearFire, inHeat }: per-frame chances of turning
  //                 into `into` when touching water / touching fire / sitting in flames
  //   lifetime:     [min, max] frames before it decays (gases)
  //   decay:        { into, chance } what it decays into; otherwise it vanishes
  //   grows:        { on, chance } spreads into touching `on` cells

  const MATERIALS = [
    { name: 'Empty', kind: 'empty' },
    { name: 'Sand',  kind: 'powder', density: 2, maxVel: 6,
      colors: ['#c8a850','#d4b45a','#bfa040','#c8ac58','#d0b060'] },
    { name: 'Snow',  kind: 'powder', density: 0.9, maxVel: 3,
      becomes: { into: WATER, onWater: 1, nearFire: 0.05, inHeat: 0.1 },
      colors: ['#e8e8f0','#f0f0f8','#dcdce8','#e4e4ee','#ececf4'] },
    { name: 'Ash',   kind: 'powder', density: 0.8, maxVel: 4,
      colors: ['#606060','#505050','#686868','#585858','#707070'] },
    { name: 'Dirt',  kind: 'powder', density: 2, maxVel: 6,
      colors: ['#a0622a','#b06a30','#986028','#a86830','#b07040'] },
    { name: 'Water', kind: 'liquid', density: 1, maxVel: 2, flow: 1, extinguishes: true,
      becomes: { into: STEAM, nearFire: 0.1, inHeat: 0.01 },
      colors: ['#3a8fcc','#4499d8','#3585c0','#4090d0','#5098d8'] },
    { name: 'Fire',  kind: 'fire', swatch: 'linear-gradient(#ffdd00,#ff4400)' }, // drawn from the heat field
    { name: 'Wood',  kind: 'static', flammability: 0.12, burn: { life: [100, 200], into: ASH, smoke: 0.03 },
      colors: ['#6b4220','#74492a','#5f3a1c','#6f4524','#7a4e2c'] },
    { name: 'Oil',   kind: 'liquid', density: 0.8, maxVel: 2, flow: 3, flammability: 4,
      burn: { life: [8, 20], into: EMPTY, smoke: 0.08 },
      colors: ['#4b3a5c','#54406a','#44344f','#503d61','#5a4670'] },
    { name: 'Steam', kind: 'gas', density: 0.01, lifetime: [120, 260], decay: { into: WATER, chance: 0.4 },
      colors: ['#a8b4c0','#b4bec8','#9eaab6','#b0bac4','#bcc6d0'] },
    { name: 'Plant', kind: 'static', flammability: 0.3, burn: { life: [30, 60], into: ASH, smoke: 0.04 },
      grows: { on: WATER, chance: 0.15 },
      colors: ['#2f8a2f','#3a9a35','#2a7a2a','#349032','#40a03a'] },
    { name: 'Smoke', kind: 'gas', density: 0.005, lifetime: [60, 150],
      colors: ['#46464e','#50505a','#3e3e46','#4a4a54','#55555f'] },
  ];

  // palette menu/number key control order (and number keys 1–9, 0)
  // materials missing here are not paintable
  const PALETTE = [SAND, DIRT, SNOW, WATER, OIL, WOOD, PLANT, FIRE, ASH, STEAM, SMOKE];

  const MOVES        = MATERIALS.map(m => ['powder', 'liquid', 'gas'].includes(m.kind));
  const IS_LIQUID    = MATERIALS.map(m => m.kind === 'liquid');
  const IS_GAS       = MATERIALS.map(m => m.kind === 'gas');
  const DENSITY      = MATERIALS.map(m => m.density || 0);
  const MAX_VEL      = MATERIALS.map(m => m.maxVel || 1);
  const FLOW         = MATERIALS.map(m => m.flow || 0);
  const FLAMMABILITY = MATERIALS.map(m => m.flammability || 0);
  const EXTINGUISHES = MATERIALS.map(m => !!m.extinguishes);
  const BECOMES      = MATERIALS.map(m => m.becomes ? { onWater: 0, nearFire: 0, inHeat: 0, ...m.becomes } : null);
  const BURN         = MATERIALS.map(m => ({ life: [20, 45], into: ASH, smoke: 0.02, ...m.burn }));
  const GROWS        = MATERIALS.map(m => m.grows || null);
  const LIFETIME     = MATERIALS.map(m => m.lifetime || null);
  const DECAY        = MATERIALS.map(m => ({ into: EMPTY, chance: 0, ...m.decay }));

  const canvas = document.getElementById('sand-canvas');
  const ctx = canvas.getContext('2d');
  const grid = new Uint8Array(COLS * ROWS);
  const colorGrid = new Uint8Array(COLS * ROWS);
  const life = new Uint8Array(COLS * ROWS); // frames left for burning cells and gases
  const fuel = new Uint8Array(COLS * ROWS); // what was it before it caught fire
  const velGrid = new Uint8Array(COLS * ROWS); // downward velocity
  const moved = new Uint8Array(COLS * ROWS); // tick stamp of the last frame a cell moved
  let tick = 0;

  // implementation stolen from Doom :)
  const HEAT_MAX = 36;
  const FIRE_PALETTE = [
    [7,7,7],[31,7,7],[47,15,7],[71,15,7],[87,23,7],[103,31,7],[119,31,7],
    [143,39,7],[159,47,7],[175,63,7],[191,71,7],[199,71,7],[223,79,7],
    [223,87,7],[223,87,7],[215,95,7],[215,95,7],[215,103,15],[207,111,15],
    [207,119,15],[207,127,15],[207,135,23],[199,135,23],[199,143,23],
    [199,151,31],[191,159,31],[191,159,31],[191,167,39],[191,167,39],
    [191,175,47],[183,175,47],[183,183,47],[183,183,55],[207,207,111],
    [223,223,159],[239,239,199],[255,255,255],
  ];
  const heat = new Uint8Array(COLS * ROWS);

  const BRUSH_SIZES = [0, 1, 2, 4, 7]; // radius in cells
  let currentType = SAND;
  let tool = 'paint';            // 'paint' | 'erase'
  let brushIdx = 2;
  let paused = false;
  let stepOnce = false;
  let mouseDown = false;
  let strokeErase = false;       // are we using the eraser tool or holding right click
  let mouseX = -1, mouseY = -1;  // last pointer cell
  let hovering = false;

  function idx(c, r) { return r * COLS + c; }
  function randRange([min, max]) { return min + Math.floor(Math.random() * (max - min + 1)); }

  function eraseCell(i) {
    grid[i] = EMPTY; colorGrid[i] = 0; velGrid[i] = 0; life[i] = 0; heat[i] = 0;
  }

  function place(i, t) {
    if (t === EMPTY) { eraseCell(i); return; }
    grid[i] = t; colorGrid[i] = (Math.random() * 5) | 0; velGrid[i] = 1;
    life[i] = LIFETIME[t] ? randRange(LIFETIME[t]) : 0;
  }

  function ignite(i) {
    const f = grid[i];
    if (f === FIRE) return;
    grid[i] = FIRE;
    fuel[i] = f;
    velGrid[i] = 0;
    life[i] = randRange(BURN[f].life);
    heat[i] = HEAT_MAX;
  }

  function swap(a, b) {
    const t = grid[b], col = colorGrid[b], l = life[b];
    grid[b] = grid[a]; colorGrid[b] = colorGrid[a]; velGrid[b] = velGrid[a]; life[b] = life[a];
    grid[a] = t; colorGrid[a] = col; velGrid[a] = t === EMPTY ? 0 : 1; life[a] = l;
    moved[a] = moved[b] = tick;
  }

  // is this a place a liquid can flow to
  function isOpen(t) { return t === EMPTY || IS_GAS[t]; }

  // if a substance t is falling, can it fall down to target
  function canEnter(t, target) {
    if (target === EMPTY) return true;
    return (IS_LIQUID[target] || IS_GAS[target]) && DENSITY[target] < DENSITY[t] &&
           Math.random() > DENSITY[target] / DENSITY[t];
  }

  function stamp(cx, cy) {
    const radius = BRUSH_SIZES[brushIdx];
    for (let dc = -radius; dc <= radius; dc++) {
      for (let dr = -radius; dr <= radius; dr++) {
        if (dc*dc + dr*dr > radius*radius + radius) continue;
        const c = cx + dc, r = cy + dr;
        if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
        const i = idx(c, r);
        if (strokeErase) {
          eraseCell(i);
        } else if (currentType === FIRE) {
          if (!EXTINGUISHES[grid[i]]) ignite(i);
        } else if (grid[i] === EMPTY) {
          place(i, currentType);
        }
      }
    }
  }

  // avoid gaps if moving quickly
  function stampLine(c0, r0, c1, r1) {
    const n = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0));
    const spacing = Math.max(1, BRUSH_SIZES[brushIdx]);
    for (let s = 0; s <= n; s += spacing) {
      stamp(Math.round(c0 + (c1 - c0) * s / (n || 1)), Math.round(r0 + (r1 - r0) * s / (n || 1)));
    }
    stamp(c1, r1);
  }

  function updateGas(i, c, r) {
    const t = grid[i];

    if (life[i] > 0 && --life[i] === 0) {
      if (Math.random() < DECAY[t].chance) place(i, DECAY[t].into);
      else eraseCell(i);
      moved[i] = tick;
      return;
    }

    // rise/wobble/bubble
    if (r > 0) {
      const d = ((Math.random() * 3) | 0) - 1;
      for (const dd of d ? [d, 0] : [0]) {
        const nc = c + dd;
        if (nc < 0 || nc >= COLS) continue;
        const ti = i - COLS + dd, tt = grid[ti];
        if (tt === EMPTY || (IS_LIQUID[tt] && DENSITY[tt] > DENSITY[t] && Math.random() < 0.5)) {
          swap(i, ti);
          return;
        }
      }
    }

    // slide to the side if blocked
    const nc = c + (Math.random() < 0.5 ? -1 : 1);
    if (nc >= 0 && nc < COLS && grid[i - c + nc] === EMPTY) swap(i, i - c + nc);
  }

  function douse(i) {
    const f = fuel[i];
    if (f === EMPTY) eraseCell(i);
    else { place(i, f); heat[i] = 0; }
  }

  function updateParticle(i, c, r) {
    const t = grid[i];
    const bottom = r === ROWS - 1;
    const below = i + COLS;

    // should we move on contact with water
    const b = BECOMES[t];
    if (b && b.onWater &&
        ((r > 0 && grid[i - COLS] === WATER) || (!bottom && grid[below] === WATER)) &&
        Math.random() < b.onWater) {
      place(i, b.into); moved[i] = tick;
      return;
    }

    // if we fall onto fire, the particle covers it and puts it out
    if (!bottom && EXTINGUISHES[t] && grid[below] === FIRE) {
      douse(below);
      if (b && b.nearFire && Math.random() < 0.5) { place(i, b.into); moved[i] = tick; }
      else if (grid[below] === EMPTY) swap(i, below);
      return;
    }

    if (!bottom) {
      // gravity
      const vel = Math.max(1, velGrid[i]);
      let dest = i, fell = 0, sank = false;
      for (let s = 1; s <= vel && r + s < ROWS; s++) {
        const ti = i + s * COLS;
        if (grid[ti] === EMPTY) { dest = ti; fell = s; continue; }
        if (s === 1 && canEnter(t, grid[ti])) { dest = ti; fell = 1; sank = true; }
        break;
      }
      if (fell > 0) {
        swap(i, dest);
        velGrid[dest] = !sank && fell === vel
          ? Math.min(vel + (Math.random() < 0.5 ? 1 : 0), MAX_VEL[t])
          : 1;
        return;
      }

      // if blocked, slide off diagonally
      velGrid[i] = 1;
      const d = Math.random() < 0.5 ? -1 : 1;
      for (const dd of [d, -d]) {
        const nc = c + dd;
        if (nc < 0 || nc >= COLS) continue;
        if (canEnter(t, grid[below + dd])) { swap(i, below + dd); return; }
      }
    }

    // spread sideways
    if (IS_LIQUID[t]) {
      const d = Math.random() < 0.5 ? -1 : 1;
      for (const dd of [d, -d]) {
        let dest = i;
        for (let s = 1; s <= FLOW[t]; s++) {
          const nc = c + dd * s;
          if (nc < 0 || nc >= COLS || !isOpen(grid[i + dd * s])) break;
          dest = i + dd * s;
        }
        if (dest !== i) { swap(i, dest); return; }
      }
    }
  }

  // spread into random adjacent cell
  function grow(i, t) {
    const g = GROWS[t];
    if (moved[i] === tick || Math.random() >= g.chance) return;
    const c = i % COLS, r = (i / COLS) | 0;
    let ni;
    switch ((Math.random() * 4) | 0) {
      case 0: if (r === 0) return; ni = i - COLS; break;
      case 1: if (r === ROWS - 1) return; ni = i + COLS; break;
      case 2: if (c === 0) return; ni = i - 1; break;
      default: if (c === COLS - 1) return; ni = i + 1;
    }
    if (grid[ni] === g.on) { place(ni, t); moved[ni] = tick; }
  }

  function update() {
    tick = tick === 255 ? 1 : tick + 1;
    if (tick === 1) moved.fill(0);

    // do fall and rise
    for (let r = ROWS - 1; r >= 0; r--) {
      const leftFirst = Math.random() < 0.5;
      for (let ci = 0; ci < COLS; ci++) {
        const c = leftFirst ? ci : COLS - 1 - ci;
        const i = idx(c, r);
        const t = grid[i];
        if (MOVES[t] && !IS_GAS[t] && moved[i] !== tick) updateParticle(i, c, r);
      }
    }
    for (let r = 0; r < ROWS; r++) {
      const leftFirst = Math.random() < 0.5;
      for (let ci = 0; ci < COLS; ci++) {
        const c = leftFirst ? ci : COLS - 1 - ci;
        const i = idx(c, r);
        if (IS_GAS[grid[i]] && moved[i] !== tick) updateGas(i, c, r);
      }
    }

    // do growth and burn
    for (let i = 0; i < COLS * ROWS; i++) {
      const t = grid[i];
      if (GROWS[t]) { grow(i, t); continue; }
      if (t !== FIRE) continue;

      if (Math.random() < 0.85) life[i]--;
      const burnedOut = life[i] === 0;
      let quenched = false;

      const c = i % COLS, r = (i / COLS) | 0;
      const neighbors = [
        r > 0 ? i - COLS : -1,
        r < ROWS - 1 ? i + COLS : -1,
        c > 0 ? i - 1 : -1,
        c < COLS - 1 ? i + 1 : -1,
      ];
      for (const ni of neighbors) {
        if (ni < 0) continue;
        const nt = grid[ni];
        if (EXTINGUISHES[nt] && Math.random() < 0.3) quenched = true;
        const b = BECOMES[nt];
        if (b) {
          if (Math.random() < b.nearFire) place(ni, b.into); // snow melts, water boils
        } else if (Math.random() < FLAMMABILITY[nt] * 0.04) {
          ignite(ni);
        }
      }

      if (burnedOut || quenched) {
        const f = fuel[i];
        // Burnt-out fuel leaves its residue; a doused fire leaves the fuel
        if (burnedOut) { place(i, BURN[f].into); heat[i] = 0; }
        else douse(i);
        continue;
      }
      // "dying" fires give off less flame
      heat[i] = Math.min(HEAT_MAX, 12 + life[i]);
      if (r > 0 && grid[i - COLS] === EMPTY && Math.random() < BURN[fuel[i]].smoke) {
        place(i - COLS, SMOKE);
      }
    }

    // doom fire spread
    for (let r = 1; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const src = idx(c, r);
        const st = grid[src];
        let h = 0;
        if (st === EMPTY || st === FIRE || IS_GAS[st]) h = heat[src];
        else heat[src] = 0;

        const dc = c + ((Math.random() * 3) | 0) - 1;
        if (dc < 0 || dc >= COLS) continue;
        const dst = idx(dc, r - 1);
        const dt = grid[dst];
        const decay = (Math.random() * 3) | 0;
        const nh = h > decay ? h - decay : 0;

        if (dt === EMPTY || IS_GAS[dt]) {
          heat[dst] = nh;
        } else if (nh === 0 || dt === FIRE) {
          // pass
        } else if (BECOMES[dt]) {
          if (Math.random() < BECOMES[dt].inHeat) place(dst, BECOMES[dt].into);
        } else if (Math.random() < FLAMMABILITY[dt] * 0.3 * nh / HEAT_MAX) {
          ignite(dst);
        }
      }
    }
  }

  // draw 1px per cell on offscreen canvas
  // then scale it up without smoothing and color
  const buf = document.createElement('canvas');
  buf.width = COLS; buf.height = ROWS;
  const bufCtx = buf.getContext('2d');
  const imageData = bufCtx.createImageData(COLS, ROWS);
  const pixels = new Uint32Array(imageData.data.buffer);

  const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  const pack = ([r, g, b]) => LITTLE_ENDIAN
    ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
    : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
  const hexRgb = hex => [1, 3, 5].map(o => parseInt(hex.slice(o, o + 2), 16));

  const BG = pack([0, 0, 0]);
  const FIRE_PACKED = Uint32Array.from(FIRE_PALETTE, pack);
  const VARIANTS = 5; // matches colorGrid's 0..4 range
  const COLOR_LUT = new Uint32Array(MATERIALS.length * VARIANTS);
  MATERIALS.forEach((m, t) => {
    for (let k = 0; k < VARIANTS; k++) {
      COLOR_LUT[t * VARIANTS + k] = m.colors ? pack(hexRgb(m.colors[k % m.colors.length])) : BG;
    }
  });

  ctx.imageSmoothingEnabled = false;

  function render() {
    for (let i = 0; i < COLS * ROWS; i++) {
      const t = grid[i];
      if (t === EMPTY) pixels[i] = heat[i] ? FIRE_PACKED[heat[i]] : BG;
      else if (t === FIRE || (IS_GAS[t] && heat[i] > 8)) pixels[i] = FIRE_PACKED[heat[i]]; // flames show through gas
      else pixels[i] = COLOR_LUT[t * VARIANTS + colorGrid[i]];
    }
    bufCtx.putImageData(imageData, 0, 0);
    ctx.drawImage(buf, 0, 0, canvas.width, canvas.height);

    // outline of brush under pointer
    if (hovering && mouseX >= 0) {
      const rad = BRUSH_SIZES[brushIdx];
      ctx.strokeStyle = strokeErase || tool === 'erase' ? 'rgba(255,80,80,0.8)' : 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1;
      if (rad === 0) {
        ctx.strokeRect(mouseX * CELL - 0.5, mouseY * CELL - 0.5, CELL + 1, CELL + 1);
      } else {
        ctx.beginPath();
        ctx.arc(mouseX * CELL + CELL / 2, mouseY * CELL + CELL / 2, (rad + 0.5) * CELL, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // holding down left click keeps placing material
  function loop() {
    if (mouseDown && mouseX >= 0 && !strokeErase) stamp(mouseX, mouseY);
    if (!paused || stepOnce) { update(); stepOnce = false; }
    render();
    requestAnimationFrame(loop);
  }

  function getCell(e) {
    const rect = canvas.getBoundingClientRect();
    // map back to pixel size after CSS scaling
    const sx = canvas.width / rect.width, sy = canvas.height / rect.height;
    return {
      c: Math.floor((e.clientX - rect.left) * sx / CELL),
      r: Math.floor((e.clientY - rect.top) * sy / CELL)
    };
  }

  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.button !== 2) return;
    e.stopPropagation();
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    mouseDown = true;
    hovering = true;
    strokeErase = tool === 'erase' || e.button === 2;
    const {c, r} = getCell(e);
    mouseX = c; mouseY = r;
    stamp(c, r);
  });
  canvas.addEventListener('pointermove', e => {
    const {c, r} = getCell(e);
    if (mouseDown) stampLine(mouseX, mouseY, c, r);
    mouseX = c; mouseY = r;
    hovering = true;
  });
  const endStroke = e => {
    mouseDown = false;
    strokeErase = false;
    if (e.pointerType !== 'mouse') hovering = false; // no hover outline left behind on touch
  };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('pointerleave', () => { if (!mouseDown) hovering = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  const paletteEl = document.getElementById('sand-palette');
  const sizesEl = document.getElementById('sand-sizes');
  const statusMat = document.getElementById('sand-status-mat');
  const statusInfo = document.getElementById('sand-status-info');
  const pauseBtn = document.getElementById('sand-pause');
  const stepBtn = document.getElementById('sand-step');

  const swatches = [];
  PALETTE.forEach(type => {
    const m = MATERIALS[type];
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = m.swatch || m.colors[0];
    const n = swatches.length;
    const key = n < 10 ? ` (${(n + 1) % 10})` : '';
    b.title = m.name + key;
    b.setAttribute('aria-label', m.name);
    b.addEventListener('click', () => selectMaterial(type));
    b.addEventListener('mouseenter', () => { statusMat.textContent = m.name; });
    b.addEventListener('mouseleave', updateStatus);
    b.dataset.type = type;
    paletteEl.appendChild(b);
    swatches.push(b);
  });

  const sizeBtns = BRUSH_SIZES.map((rad, i) => {
    const b = document.createElement('button');
    b.className = 'tool-btn icon';
    b.title = `Brush ${i + 1}`;
    const d = Math.min(2 + i * 2, 10);
    b.innerHTML = `<span class="dot" style="width:${d}px;height:${d}px"></span>`;
    b.addEventListener('click', () => setBrush(i));
    sizesEl.appendChild(b);
    return b;
  });

  const toolBtns = [...document.querySelectorAll('#sand-tools .tool-btn')];
  toolBtns.forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

  function updateStatus() {
    statusMat.textContent = tool === 'erase' ? 'Eraser' : MATERIALS[currentType].name;
    statusInfo.textContent = `Brush ${brushIdx + 1}` + (paused ? ' · Paused' : '');
  }

  function refresh() {
    swatches.forEach(b => b.classList.toggle('selected', +b.dataset.type === currentType));
    sizeBtns.forEach((b, i) => b.classList.toggle('pressed', i === brushIdx));
    toolBtns.forEach(b => b.classList.toggle('pressed', b.dataset.tool === tool));
    pauseBtn.classList.toggle('pressed', paused);
    stepBtn.disabled = !paused;
    updateStatus();
  }

  function selectMaterial(type) { currentType = type; tool = 'paint'; refresh(); }
  function setTool(t) { tool = t; refresh(); }
  function setBrush(i) { brushIdx = Math.max(0, Math.min(BRUSH_SIZES.length - 1, i)); refresh(); }
  function togglePause() { paused = !paused; refresh(); }

  pauseBtn.addEventListener('click', togglePause);
  stepBtn.addEventListener('click', () => { stepOnce = true; });
  document.getElementById('sand-clear').addEventListener('click', () => {
    grid.fill(0); colorGrid.fill(0); life.fill(0); fuel.fill(0); velGrid.fill(0); heat.fill(0);
  });

  document.getElementById('sand-win').addEventListener('mousedown', e => {
    if (e.target.closest('button')) e.preventDefault();
  });

  // only active with sand win div focused
  document.addEventListener('keydown', e => {
    if (activeWin?.id !== 'sand-win' || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k >= '0' && k <= '9') {
      const b = swatches[(+k + 9) % 10]; // 1–9 then 0
      if (b) selectMaterial(+b.dataset.type);
    } else if (k === '[') setBrush(brushIdx - 1);
    else if (k === ']') setBrush(brushIdx + 1);
    else if (k === 'e' || k === 'E') setTool('erase');
    else if (k === 'b' || k === 'B') setTool('paint');
    else if (k === '.') { if (paused) stepOnce = true; }
    else if (k === ' ') togglePause();
    else return;
    e.preventDefault();
  });

  refresh();
  loop();
})();
