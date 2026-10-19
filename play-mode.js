(() => {
  const $ = (selector) => document.querySelector(selector);
  const dialog = $('#playDialog');
  const canvas = $('#gameCanvas');
  if (!dialog || !canvas) return;
  const ctx = canvas.getContext('2d');
  const gameMessage = $('#gameMessage');
  const overlay = $('#gameOverlay');
  let activeWorld = null;
  let game = null;
  let lastMoveAt = 0;
  let resizeObserver;

  const enemyTypes = [
    { kind: 'scout', name: 'Скаут', hp: 2, damage: 1, aggro: 10, color: '#e8865f' },
    { kind: 'brute', name: 'Крушитель', hp: 4, damage: 2, aggro: 7, color: '#d5a65e' },
    { kind: 'wraith', name: 'Шорох', hp: 2, damage: 1, aggro: 12, color: '#aaa1df' }
  ];
  const palettes = {
    grove: { floor: '#586f54', floorAlt: '#637c5b', wall: '#26332f', trim: '#9ab176', hazard: '#e88156', relic: '#d6f36a', gate: '#88d9e7' },
    foundry: { floor: '#75604f', floorAlt: '#856c53', wall: '#322c2a', trim: '#be8150', hazard: '#f26d4d', relic: '#e7ce72', gate: '#85d2e4' },
    glacier: { floor: '#4f6d7b', floorAlt: '#5b7b8c', wall: '#263640', trim: '#8bb9c8', hazard: '#ed8b67', relic: '#d6ef91', gate: '#9ce8f5' }
  };

  function keyOf(x, y) { return `${x},${y}`; }
  function inside(world, x, y) { return x > 0 && y > 0 && x < world.cols - 1 && y < world.rows - 1; }
  function walkable(world, x, y) { return inside(world, x, y) && world.tiles[y][x] === 1; }
  function manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
  function setMessage(text, tone = '') {
    gameMessage.textContent = text;
    gameMessage.dataset.tone = tone;
  }

  function measureFromStart(world) {
    const total = world.cols * world.rows;
    const distance = new Int32Array(total); distance.fill(-1);
    const queue = new Int32Array(total);
    const start = world.start.y * world.cols + world.start.x;
    let head = 0, tail = 0;
    queue[tail++] = start; distance[start] = 0;
    while (head < tail) {
      const index = queue[head++], x = index % world.cols, y = Math.floor(index / world.cols);
      const nextDistance = distance[index] + 1;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (!walkable(world, nx, ny)) continue;
        const next = ny * world.cols + nx;
        if (distance[next] !== -1) continue;
        distance[next] = nextDistance; queue[tail++] = next;
      }
    }
    return distance;
  }

  function limitedDistances(world, origin, limit = 12) {
    const distances = new Map();
    const queue = [{ x: origin.x, y: origin.y, d: 0 }];
    distances.set(keyOf(origin.x, origin.y), 0);
    for (let i = 0; i < queue.length; i++) {
      const point = queue[i];
      if (point.d >= limit) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = point.x + dx, y = point.y + dy, key = keyOf(x, y);
        if (!walkable(world, x, y) || distances.has(key)) continue;
        distances.set(key, point.d + 1); queue.push({ x, y, d: point.d + 1 });
      }
    }
    return distances;
  }

  function makeEnemies(world, hazards, relics) {
    const distances = measureFromStart(world);
    const candidates = [];
    for (let y = 1; y < world.rows - 1; y++) for (let x = 1; x < world.cols - 1; x++) {
      const distance = distances[y * world.cols + x];
      const key = keyOf(x, y);
      if (distance >= 5 && key !== keyOf(world.exit.x, world.exit.y) && !hazards.has(key) && !relics.has(key)) candidates.push({ x, y, distance });
    }
    candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
    const count = Math.min(7, Math.max(3, 2 + Math.floor((world.floorCount || 180) / 150)));
    const enemies = [];
    for (let i = 0; i < count && candidates.length; i++) {
      const index = Math.min(candidates.length - 1, Math.floor(((i + 1) / (count + 1)) * candidates.length));
      const point = candidates.splice(index, 1)[0];
      const type = enemyTypes[(i + Math.max(0, (world.level || 1) - 1)) % enemyTypes.length];
      enemies.push({ id: `enemy-${i}`, ...point, hp: type.hp, maxHp: type.hp, damage: type.damage, aggro: type.aggro, kind: type.kind, name: type.name, color: type.color, cooldown: i % 2 });
    }
    return enemies;
  }

  function startGame(world = activeWorld) {
    if (!world?.start || !world?.exit) return;
    activeWorld = world;
    const hazards = new Set((world.hazards || []).map((point) => keyOf(point.x, point.y)));
    const relics = new Set((world.relics || []).map((point) => keyOf(point.x, point.y)));
    const bossMax = 8 + Math.min(4, Math.floor((world.level || 1) / 3));
    game = {
      world,
      player: { ...world.start, hp: 12, maxHp: 12, facing: { x: 1, y: 0 } },
      hazards,
      usedHazards: new Set(),
      relics,
      relicTotal: relics.size,
      enemies: makeEnemies(world, hazards, relics),
      boss: { ...world.exit, hp: bossMax, maxHp: bossMax, alive: true, cooldown: 0, name: 'Страж разлома' },
      turn: 0,
      finished: false
    };
    const p = game.player;
    $('#playTitle').textContent = 'Выход за печатью';
    $('#playWorldLabel').textContent = `FIELD TEST / МИР ${String(world.level || 1).padStart(3, '0')} · ${world.cols} × ${world.rows}`;
    $('#gameResultKicker').textContent = `EXPEDITION LOG / ${String(world.level || 1).padStart(2, '0')}`;
    overlay.hidden = true;
    $('#bossReadout').hidden = false;
    setMessage('Найдите проход к выходу. Страж охраняет печать.');
    updateHud();
    resizeCanvas();
    if (dialog.open) $('#gameStage').focus({ preventScroll: true });
  }

  function updateHud() {
    if (!game) return;
    const { player, enemies, relics, relicTotal, boss } = game;
    const health = $('#gameHealth'); health.replaceChildren();
    for (let i = 0; i < player.maxHp; i++) {
      const segment = document.createElement('i');
      if (i < player.hp) segment.classList.add('is-full');
      health.append(segment);
    }
    health.setAttribute('aria-valuenow', String(player.hp));
    health.setAttribute('aria-valuemin', '0');
    health.setAttribute('aria-valuemax', String(player.maxHp));
    $('#gameHealthValue').textContent = `${player.hp} / ${player.maxHp}`;
    $('#gameEnemyValue').textContent = String(enemies.length + (boss.alive ? 1 : 0));
    $('#gameRelicValue').textContent = `${relicTotal - relics.size} / ${relicTotal}`;
    $('#gameGateValue').textContent = boss.alive ? 'ЗАКРЫТ' : 'ОТКРЫТ';
    $('#bossHpValue').textContent = `${Math.max(0, boss.hp)} / ${boss.maxHp}`;
    $('#bossHpFill').style.width = `${Math.max(0, boss.hp) / boss.maxHp * 100}%`;
    $('#bossReadout').hidden = !boss.alive;
  }

  function finishGame(won) {
    game.finished = true;
    overlay.hidden = false;
    $('#gameResultKicker').textContent = won ? 'EXPEDITION LOG / ПЕЧАТЬ СНЯТА' : 'EXPEDITION LOG / СВЯЗЬ ПОТЕРЯНА';
    $('#gameResultTitle').textContent = won ? 'Выход открыт.' : 'Экспедиция прервана.';
    $('#gameResultText').textContent = won
      ? `Страж повержен, а путь очищен. Мир ${game.world.seed} пройден за ${game.turn} действий.`
      : `Отряд остановлен на ${game.turn}-м действии. Можно повторить этот же маршрут или собрать новый мир.`;
    $('#gameRestart').hidden = false;
    $('#gameRestart').textContent = won ? 'Повторить маршрут' : 'Начать заново';
    $('#gameNewLevel').hidden = !won;
    setMessage(won ? 'Печать снята. Выход ждёт у дальней стены.' : 'Экспедиция окончена. Попробуйте другой маршрут.', won ? 'good' : 'danger');
    updateHud();
    draw();
  }

  function afterTurn() {
    if (game.finished) return;
    enemyTurn();
    updateHud();
    draw();
    if (game.player.hp <= 0) finishGame(false);
  }

  function movePlayer(dx, dy) {
    if (!game || game.finished || !dialog.open) return;
    const now = performance.now();
    if (now - lastMoveAt < 90) return;
    lastMoveAt = now;
    const player = game.player;
    player.facing = { x: dx, y: dy };
    const x = player.x + dx, y = player.y + dy, key = keyOf(x, y);
    if (!walkable(game.world, x, y)) { setMessage('Стена перекрывает этот проход.'); draw(); return; }
    if (game.boss.alive && x === game.world.exit.x && y === game.world.exit.y) { setMessage('Печать удерживает Страж. Сначала победите его.', 'danger'); draw(); return; }
    if (game.enemies.some((enemy) => enemy.x === x && enemy.y === y)) { setMessage('Враг занял клетку. Ударьте, чтобы расчистить путь.', 'danger'); draw(); return; }
    if (game.boss.alive && game.boss.x === x && game.boss.y === y) { setMessage('Страж закрывает путь. Прицельтесь и ударьте.', 'danger'); draw(); return; }
    player.x = x; player.y = y; game.turn++;
    setMessage('');
    if (game.hazards.has(key) && !game.usedHazards.has(key)) {
      game.usedHazards.add(key); player.hp = Math.max(0, player.hp - 1); setMessage('Ловушка задела вас: −1 здоровье.', 'danger');
    }
    if (game.relics.delete(key)) {
      player.hp = Math.min(player.maxHp, player.hp + 2);
      setMessage('Реликвия собрана. Она вернула часть сил.', 'good');
    }
    if (x === game.world.exit.x && y === game.world.exit.y && !game.boss.alive) { finishGame(true); return; }
    afterTurn();
  }

  function attack() {
    if (!game || game.finished || !dialog.open) return;
    const { player } = game, { x: dx, y: dy } = player.facing;
    const targets = [...game.enemies, ...(game.boss.alive ? [game.boss] : [])];
    const target = targets.find((entity) => {
      const vx = entity.x - player.x, vy = entity.y - player.y;
      const distance = Math.abs(vx) + Math.abs(vy);
      const range = entity === game.boss ? 2 : 1;
      return distance >= 1 && distance <= range && vx * dx + vy * dy === distance;
    });
    game.turn++;
    if (!target) setMessage('Удар прошёл по воздуху. Подойдите ближе и повернитесь к цели.');
    else {
      target.hp--;
      if (target === game.boss) {
        if (target.hp <= 0) { target.hp = 0; target.alive = false; setMessage('Страж пал. Дальние ворота разблокированы.', 'good'); }
        else setMessage(`Удар по Стражу: осталось ${target.hp} единиц брони.`, 'good');
      } else if (target.hp <= 0) {
        game.enemies = game.enemies.filter((enemy) => enemy !== target);
        setMessage(`${target.name} повержен. Путь свободен.`, 'good');
      } else setMessage(`${target.name} ранен: ${target.hp} здоровья осталось.`);
    }
    afterTurn();
  }

  function enemyTurn() {
    const world = game.world, player = game.player;
    const distances = limitedDistances(world, player, 13);
    const occupied = new Set(game.enemies.map((enemy) => keyOf(enemy.x, enemy.y)));
    if (game.boss.alive) occupied.add(keyOf(game.boss.x, game.boss.y));
    for (const enemy of game.enemies) {
      const distance = distances.get(keyOf(enemy.x, enemy.y));
      if (distance === undefined || distance > enemy.aggro) continue;
      if (enemy.cooldown > 0) { enemy.cooldown--; continue; }
      if (distance === 1) {
        player.hp = Math.max(0, player.hp - enemy.damage);
        enemy.cooldown = enemy.kind === 'brute' ? 1 : 0;
        setMessage(`${enemy.name} атакует: −${enemy.damage} здоровья.`, 'danger');
        if (player.hp <= 0) return;
        continue;
      }
      if (enemy.kind === 'brute' && game.turn % 2) continue;
      const options = [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy]) => ({ x: enemy.x + dx, y: enemy.y + dy }))
        .filter((point) => walkable(world, point.x, point.y) && !occupied.has(keyOf(point.x, point.y)) && !game.hazards.has(keyOf(point.x, point.y)))
        .map((point) => ({ ...point, distance: distances.get(keyOf(point.x, point.y)) ?? Infinity }))
        .filter((point) => point.distance < distance)
        .sort((a, b) => a.distance - b.distance);
      if (options.length) {
        occupied.delete(keyOf(enemy.x, enemy.y));
        enemy.x = options[0].x; enemy.y = options[0].y;
        occupied.add(keyOf(enemy.x, enemy.y));
      }
    }
    const boss = game.boss;
    if (boss.alive) {
      const distance = distances.get(keyOf(boss.x, boss.y));
      if (distance !== undefined && distance <= 1 && boss.cooldown <= 0) {
        player.hp = Math.max(0, player.hp - 2); boss.cooldown = 2;
        setMessage('Страж ударил по земле: −2 здоровья.', 'danger');
      } else if (distance !== undefined && distance > 1 && distance <= 8 && boss.cooldown <= 0 && game.turn % 2 === 0) {
        const options = [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy]) => ({ x: boss.x + dx, y: boss.y + dy }))
          .filter((point) => walkable(world, point.x, point.y) && !occupied.has(keyOf(point.x, point.y)))
          .map((point) => ({ ...point, distance: distances.get(keyOf(point.x, point.y)) ?? Infinity }))
          .filter((point) => point.distance < distance)
          .sort((a, b) => a.distance - b.distance);
        if (options.length) { occupied.delete(keyOf(boss.x, boss.y)); boss.x = options[0].x; boss.y = options[0].y; occupied.add(keyOf(boss.x, boss.y)); }
      }
      if (boss.cooldown > 0) boss.cooldown--;
    }
  }

  function drawEnemy(entity, x, y, size, palette, boss = false) {
    const cx = x + size / 2, cy = y + size / 2, r = size * (boss ? .38 : .29);
    ctx.save();
    if (boss) {
      ctx.shadowColor = '#ee7959'; ctx.shadowBlur = 14;
      ctx.fillStyle = '#6f3834'; ctx.beginPath();
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 - Math.PI / 8; const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = '#f09772'; ctx.lineWidth = Math.max(1.5, size * .07); ctx.stroke();
      ctx.fillStyle = '#f4d18b'; ctx.fillRect(cx - size * .13, cy - size * .06, size * .26, size * .12);
      ctx.fillStyle = '#3b2728'; ctx.fillRect(cx - size * .04, cy - size * .06, size * .08, size * .12);
    } else if (entity.kind === 'brute') {
      ctx.fillStyle = entity.color; ctx.fillRect(cx - r, cy - r * .8, r * 2, r * 1.6);
      ctx.fillStyle = '#382d2a'; ctx.fillRect(cx - r * .55, cy - r * .2, r * 1.1, r * .25);
      ctx.fillStyle = '#f2dfad'; ctx.fillRect(cx - r * .42, cy - r * .27, r * .2, r * .12); ctx.fillRect(cx + r * .22, cy - r * .27, r * .2, r * .12);
    } else if (entity.kind === 'wraith') {
      ctx.globalAlpha = .82; ctx.fillStyle = entity.color; ctx.shadowColor = entity.color; ctx.shadowBlur = 9;
      ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 0); ctx.lineTo(cx + r, cy + r * .7); ctx.lineTo(cx + r * .35, cy + r * .35); ctx.lineTo(cx, cy + r * .75); ctx.lineTo(cx - r * .35, cy + r * .35); ctx.lineTo(cx - r, cy + r * .7); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      ctx.fillStyle = '#252638'; ctx.fillRect(cx - r * .35, cy - r * .15, r * .18, r * .15); ctx.fillRect(cx + r * .18, cy - r * .15, r * .18, r * .15);
    } else {
      ctx.fillStyle = entity.color; ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy + r * .72); ctx.lineTo(cx - r, cy + r * .72); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#392f2b'; ctx.fillRect(cx - r * .1, cy - r * .05, r * .2, r * .18);
    }
    if (entity.hp < entity.maxHp && !boss) {
      const barW = size * .64; ctx.fillStyle = '#191d1e'; ctx.fillRect(cx - barW / 2, y + size * .07, barW, 3);
      ctx.fillStyle = palette.relic; ctx.fillRect(cx - barW / 2, y + size * .07, barW * entity.hp / entity.maxHp, 3);
    }
    ctx.restore();
  }

  function drawPlayer(x, y, size) {
    const p = game.player, cx = x + size / 2, cy = y + size / 2;
    ctx.save();
    ctx.shadowColor = '#d6f36a'; ctx.shadowBlur = 9;
    ctx.fillStyle = '#d6f36a'; ctx.beginPath(); ctx.arc(cx, cy, size * .29, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#1e2a22'; ctx.beginPath(); ctx.arc(cx, cy, size * .11, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#eff1ec'; ctx.lineWidth = Math.max(1.5, size * .07); ctx.beginPath();
    ctx.moveTo(cx + p.facing.x * size * .22, cy + p.facing.y * size * .22);
    ctx.lineTo(cx + p.facing.x * size * .47, cy + p.facing.y * size * .47); ctx.stroke();
    ctx.restore();
  }

  function draw() {
    if (!game || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const size = Math.max(16, Math.min(29, Math.floor(Math.min(rect.width / 13, rect.height / 9))));
    const viewCols = Math.ceil(rect.width / size) + 1, viewRows = Math.ceil(rect.height / size) + 1;
    const world = game.world, p = game.player;
    const left = Math.max(0, Math.min(world.cols - viewCols, Math.floor(p.x - viewCols / 2)));
    const top = Math.max(0, Math.min(world.rows - viewRows, Math.floor(p.y - viewRows / 2)));
    const offsetX = Math.floor((rect.width - Math.min(world.cols, viewCols) * size) / 2);
    const offsetY = Math.floor((rect.height - Math.min(world.rows, viewRows) * size) / 2);
    const palette = palettes[world.biome] || palettes.grove;
    ctx.fillStyle = '#111719'; ctx.fillRect(0, 0, rect.width, rect.height);
    for (let y = top; y < Math.min(world.rows, top + viewRows); y++) for (let x = left; x < Math.min(world.cols, left + viewCols); x++) {
      const sx = offsetX + (x - left) * size, sy = offsetY + (y - top) * size;
      const tile = world.tiles[y][x], key = keyOf(x, y);
      if (tile === 0 || tile === 2) {
        ctx.fillStyle = tile === 2 ? '#34413d' : palette.wall; ctx.fillRect(sx, sy, size, size);
        ctx.strokeStyle = '#101719'; ctx.lineWidth = 1; ctx.strokeRect(sx + .5, sy + .5, size - 1, size - 1);
        if ((x * 7 + y * 11) % 5 === 0) { ctx.fillStyle = palette.trim + '55'; ctx.fillRect(sx + size * .22, sy + size * .22, size * .56, 2); }
        continue;
      }
      ctx.fillStyle = (x * 13 + y * 29) % 7 === 0 ? palette.floorAlt : palette.floor; ctx.fillRect(sx, sy, size, size);
      ctx.strokeStyle = '#10171944'; ctx.strokeRect(sx + .5, sy + .5, size - 1, size - 1);
      if (game.hazards.has(key) && !game.usedHazards.has(key)) {
        ctx.fillStyle = palette.hazard + '4f'; ctx.fillRect(sx + 2, sy + 2, size - 4, size - 4);
        ctx.fillStyle = palette.hazard; ctx.beginPath(); ctx.moveTo(sx + size / 2, sy + size * .22); ctx.lineTo(sx + size * .78, sy + size / 2); ctx.lineTo(sx + size / 2, sy + size * .78); ctx.lineTo(sx + size * .22, sy + size / 2); ctx.closePath(); ctx.fill();
      }
      if (game.relics.has(key)) {
        ctx.fillStyle = palette.relic + '55'; ctx.beginPath(); ctx.arc(sx + size / 2, sy + size / 2, size * .37, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = palette.relic; ctx.beginPath(); ctx.moveTo(sx + size / 2, sy + size * .22); ctx.lineTo(sx + size * .76, sy + size / 2); ctx.lineTo(sx + size / 2, sy + size * .76); ctx.lineTo(sx + size * .24, sy + size / 2); ctx.closePath(); ctx.fill();
      }
      if (x === world.start.x && y === world.start.y) { ctx.strokeStyle = palette.relic; ctx.lineWidth = 1.4; ctx.strokeRect(sx + 3, sy + 3, size - 6, size - 6); }
      if (x === world.exit.x && y === world.exit.y) {
        ctx.strokeStyle = game.boss.alive ? '#e78667' : palette.gate; ctx.lineWidth = 2;
        ctx.strokeRect(sx + size * .2, sy + size * .15, size * .6, size * .7);
        ctx.beginPath(); ctx.arc(sx + size / 2, sy + size * .48, size * .14, Math.PI, 0); ctx.stroke();
      }
    }
    for (const enemy of game.enemies) if (enemy.hp > 0 && enemy.x >= left && enemy.y >= top && enemy.x < left + viewCols && enemy.y < top + viewRows) drawEnemy(enemy, offsetX + (enemy.x - left) * size, offsetY + (enemy.y - top) * size, size, palette);
    if (game.boss.alive && game.boss.x >= left && game.boss.y >= top && game.boss.x < left + viewCols && game.boss.y < top + viewRows) drawEnemy(game.boss, offsetX + (game.boss.x - left) * size, offsetY + (game.boss.y - top) * size, size, palette, true);
    if (p.x >= left && p.y >= top && p.x < left + viewCols && p.y < top + viewRows) drawPlayer(offsetX + (p.x - left) * size, offsetY + (p.y - top) * size, size);
  }

  function resizeCanvas() { draw(); }
  function openGame() {
    if (!activeWorld) return;
    startGame(activeWorld);
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(draw);
  }

  $('#playButton').addEventListener('click', openGame);
  $('#closePlay').addEventListener('click', () => dialog.close());
  $('#gameRestart').addEventListener('click', () => startGame(activeWorld));
  $('#gameNewLevel').addEventListener('click', () => window.dispatchEvent(new Event('levelseed:new-level')));
  $('#gameAttack').addEventListener('click', attack);
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { if (game) draw(); });
  window.addEventListener('keydown', (event) => {
    if (!dialog.open || !game || game.finished) return;
    const moves = { ArrowUp: [0, -1], w: [0, -1], W: [0, -1], ArrowDown: [0, 1], s: [0, 1], S: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0], ArrowRight: [1, 0], d: [1, 0], D: [1, 0] };
    if (moves[event.key]) { event.preventDefault(); movePlayer(...moves[event.key]); }
    else if (event.code === 'Space') { event.preventDefault(); attack(); }
  });
  const direction = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  let holdDelay = null, holdRepeat = null;
  function stopHold() { clearTimeout(holdDelay); clearInterval(holdRepeat); holdDelay = holdRepeat = null; }
  document.querySelectorAll('[data-game-move]').forEach((button) => {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault(); button.setPointerCapture?.(event.pointerId);
      const [dx, dy] = direction[button.dataset.gameMove]; movePlayer(dx, dy);
      stopHold(); holdDelay = setTimeout(() => { holdRepeat = setInterval(() => movePlayer(dx, dy), 112); }, 260);
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave']) button.addEventListener(name, stopHold);
  });

  window.addEventListener('levelseed:world-generated', (event) => {
    activeWorld = event.detail?.world || activeWorld;
    if (dialog.open && activeWorld) startGame(activeWorld);
  });
  if ('ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe($('#gameStage'));
  } else window.addEventListener('resize', resizeCanvas, { passive: true });
})();
