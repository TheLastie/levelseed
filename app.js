(() => {
  const $ = (selector) => document.querySelector(selector);
  const canvas = $('#levelMap');
  const ctx = canvas.getContext('2d');
  const seedInput = $('#seedInput');
  const algorithmSelect = $('#algorithmSelect');
  const biomeSelect = $('#biomeSelect');
  const sizeSelect = $('#sizeSelect');
  const dangerSelect = $('#dangerSelect');
  const densitySlider = $('#densitySlider');
  const densityValue = $('#densityValue');
  const toast = $('#toast');
  const colors = {
    grove: { name: 'ЗАРОСШИЙ ХРАМ', floor: '#4d6552', floorAlt: '#59705a', wall: '#27332f', wallLight: '#35443c', trim: '#7c9a63', hazard: '#e78554', relic: '#d5f36b', water: '#6598a0' },
    foundry: { name: 'МЕДНАЯ КУЗНЯ', floor: '#665449', floorAlt: '#80634d', wall: '#342d2b', wallLight: '#49403b', trim: '#b87a45', hazard: '#ff6c48', relic: '#e6cb68', water: '#598d99' },
    glacier: { name: 'СИНИЙ РАЗЛОМ', floor: '#496170', floorAlt: '#587786', wall: '#273640', wallLight: '#344650', trim: '#73a2b8', hazard: '#eb8a62', relic: '#d7ef90', water: '#73b7c0' }
  };
  const sizes = { small: [22, 15], standard: [28, 18], large: [64, 40], vast: [96, 64], colossal: [160, 96], giant: [256, 160], epic: [384, 240], world: [512, 320] };
  const algorithms = {
    bsp: {
      title: 'Binary Space Partitioning',
      code: ['положить всю карту в очередь', 'разделить крупную область пополам', 'повторять, пока хватает места', 'вписать комнаты и соединить центры'],
      stages: [['ОБЛАСТЬ', 'Весь уровень начинается с одного прямоугольника.'], ['РАЗДЕЛЕНИЕ', 'BSP снова и снова делит крупнейшие области на две.'], ['КОМНАТЫ', 'Внутри конечных областей появляются комнаты; коридоры связывают их в сеть.'], ['СОБЫТИЯ', 'В самой дальней комнате появляется выход, между комнатами — реликвии и угрозы.']]
    },
    cellular: {
      title: 'Cellular Automaton',
      code: ['случайно заполнить карту стенами', 'посчитать соседей каждой клетки', 'сгладить границы несколько раз', 'соединить изолированные полости', 'разместить вход и цель'],
      stages: [['ШУМ', 'Случайное поле стен и проходов задаёт форму будущей пещеры.'], ['ПОКОЛЕНИЕ 01', 'Клетки меняют состояние, глядя на восемь соседей.'], ['СГЛАЖИВАНИЕ', 'Правило большинства убирает одиночные пиксели и собирает крупные залы.'], ['СВЯЗНОСТЬ', 'Изолированные полости соединяются кратчайшими тоннелями.'], ['СОБЫТИЯ', 'Вход и выход занимают самые удалённые точки общей пещеры.']]
    },
    walker: {
      title: 'Random Walk + Growth',
      code: ['поставить первого землекопа в центре', 'сделать шаг и убрать стену', 'иногда менять направление', 'возобновлять путь у найденной тропы', 'добавить развилки и цели'],
      stages: [['ТОЧКА СТАРТА', 'Первый проход начинается в центре пустой карты.'], ['ПЕРВЫЙ СЛЕД', 'Землекоп движется по клеткам и оставляет после себя открытый пол.'], ['РОСТ СЕТИ', 'Новый шаг иногда начинается с уже найденной тропы — так появляются ответвления.'], ['ЗАМЫКАНИЕ', 'Развилки и петли превращают случайный след в проходимую сеть.'], ['СОБЫТИЯ', 'На длинном маршруте размещаются вход, дальняя цель и игровые находки.']]
    }
  };
  const difficulty = { calm: 0.018, tense: 0.045, brutal: 0.082 };
  let currentWorld = null;
  let toastTimer;
  let traceTimer = null;
  let traceIndex = 0;
  let levelNumber = 0;

  function hashString(value) {
    let h = 1779033703 ^ value.length;
    for (let i = 0; i < value.length; i++) {
      h = Math.imul(h ^ value.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return () => {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }

  function seededRandom(seed) {
    const seedHash = hashString(seed)();
    let state = seedHash || 1;
    return () => {
      state += 0x6D2B79F5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeSeed() {
    const bytes = new Uint32Array(1);
    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
    else bytes[0] = Math.floor(Math.random() * 0xffffffff);
    return bytes[0].toString(36).toUpperCase().padStart(7, '0').slice(-7);
  }

  function makeRoom(rng, cols, rows, roomTarget) {
    const widthVariety = roomTarget > 10 ? 3 : 5;
    const heightVariety = roomTarget > 10 ? 2 : 3;
    const w = 3 + Math.floor(rng() * Math.min(widthVariety, Math.max(1, cols - 6)));
    const h = 3 + Math.floor(rng() * Math.min(heightVariety, Math.max(1, rows - 5)));
    const x = 1 + Math.floor(rng() * Math.max(1, cols - w - 2));
    const y = 1 + Math.floor(rng() * Math.max(1, rows - h - 2));
    return { x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2) };
  }

  function intersects(a, b) {
    return a.x - 1 < b.x + b.w && a.x + a.w + 1 > b.x && a.y - 1 < b.y + b.h && a.y + a.h + 1 > b.y;
  }

  function carve(world, x, y) {
    if (x >= 1 && y >= 1 && x < world.cols - 1 && y < world.rows - 1) world.tiles[y][x] = 1;
  }

  function connectRooms(world, a, b, rng) {
    let x = a.cx;
    let y = a.cy;
    const horizontalFirst = rng() > 0.5;
    const carveHorizontal = (toX) => {
      const step = Math.sign(toX - x);
      while (x !== toX) { carve(world, x, y); x += step; }
      carve(world, x, y);
    };
    const carveVertical = (toY) => {
      const step = Math.sign(toY - y);
      while (y !== toY) { carve(world, x, y); y += step; }
      carve(world, x, y);
    };
    if (horizontalFirst) { carveHorizontal(b.cx); carveVertical(b.cy); }
    else { carveVertical(b.cy); carveHorizontal(b.cx); }
  }

  function generateWorld() {
    const seed = (seedInput.value.trim() || makeSeed()).slice(0, 20);
    seedInput.value = seed;
    const [cols, rows] = sizes[sizeSelect.value];
    const rng = seededRandom(`${seed}|${biomeSelect.value}|${sizeSelect.value}|${densitySlider.value}|${dangerSelect.value}`);
    const tiles = Array.from({ length: rows }, () => Array(cols).fill(0));
    const world = { seed, cols, rows, tiles, rooms: [], hazards: [], relics: [], start: null, exit: null, biome: biomeSelect.value };
    const roomTarget = Number(densitySlider.value);
    for (let attempt = 0; attempt < roomTarget * 80 && world.rooms.length < roomTarget; attempt++) {
      const room = makeRoom(rng, cols, rows, roomTarget);
      if (world.rooms.some((other) => intersects(room, other))) continue;
      for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) carve(world, x, y);
      if (world.rooms.length) connectRooms(world, world.rooms[world.rooms.length - 1], room, rng);
      world.rooms.push(room);
    }
    if (world.rooms.length < 2) {
      world.rooms = [];
      for (let i = 0; i < 3; i++) {
        const room = { x: 2 + i * Math.floor((cols - 9) / 3), y: 2 + (i % 2) * Math.floor((rows - 7) / 2), w: 5, h: 4 };
        room.cx = room.x + 2; room.cy = room.y + 1;
        for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) carve(world, x, y);
        if (world.rooms.length) connectRooms(world, world.rooms[world.rooms.length - 1], room, rng);
        world.rooms.push(room);
      }
    }
    world.start = { x: world.rooms[0].cx, y: world.rooms[0].cy };
    let farthest = world.rooms[1];
    for (const room of world.rooms.slice(1)) {
      const d = Math.abs(room.cx - world.start.x) + Math.abs(room.cy - world.start.y);
      const current = Math.abs(farthest.cx - world.start.x) + Math.abs(farthest.cy - world.start.y);
      if (d > current) farthest = room;
    }
    world.exit = { x: farthest.cx, y: farthest.cy };

    const floorCells = [];
    for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - 1; x++) if (tiles[y][x] === 1 && !(x === world.start.x && y === world.start.y) && !(x === world.exit.x && y === world.exit.y)) floorCells.push({ x, y });
    for (let i = floorCells.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [floorCells[i], floorCells[j]] = [floorCells[j], floorCells[i]]; }
    const hazardCount = Math.max(2, Math.round(floorCells.length * difficulty[dangerSelect.value]));
    for (let i = 0; i < hazardCount && i < floorCells.length; i++) world.hazards.push(floorCells[i]);
    const relicCount = Math.min(5, Math.max(2, Math.floor(world.rooms.length / 3)));
    for (let i = hazardCount; i < hazardCount + relicCount && i < floorCells.length; i++) world.relics.push(floorCells[i]);

    currentWorld = world;
    levelNumber++;
    renderWorld(world, rng);
    syncFavoriteButton();
    updateUrl();
  }

  function renderWorld(world, rng) {
    const palette = colors[world.biome];
    const cell = 22;
    canvas.width = world.cols * cell;
    canvas.height = world.rows * cell;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#121619';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const hazardSet = new Set(world.hazards.map((p) => `${p.x},${p.y}`));
    const relicSet = new Set(world.relics.map((p) => `${p.x},${p.y}`));
    const exitSet = `${world.exit.x},${world.exit.y}`;
    const startSet = `${world.start.x},${world.start.y}`;

    for (let y = 0; y < world.rows; y++) for (let x = 0; x < world.cols; x++) {
      const px = x * cell;
      const py = y * cell;
      const key = `${x},${y}`;
      if (!world.tiles[y][x]) {
        ctx.fillStyle = palette.wall;
        ctx.fillRect(px, py, cell, cell);
        ctx.fillStyle = palette.wallLight;
        if (rng() > 0.67) ctx.fillRect(px + 3, py + 3, cell - 6, 2);
        if (rng() > 0.8) ctx.fillRect(px + 3, py + 7, 2, 8);
        ctx.strokeStyle = '#101519'; ctx.lineWidth = 1; ctx.strokeRect(px + .5, py + .5, cell - 1, cell - 1);
        continue;
      }
      ctx.fillStyle = rng() > .78 ? palette.floorAlt : palette.floor;
      ctx.fillRect(px, py, cell, cell);
      ctx.strokeStyle = '#19232930'; ctx.lineWidth = 1; ctx.strokeRect(px + .5, py + .5, cell - 1, cell - 1);
      if (rng() > .83) {
        ctx.fillStyle = palette.trim + '88';
        ctx.fillRect(px + 6 + Math.floor(rng() * 6), py + 6 + Math.floor(rng() * 6), 3, 3);
      }
      if (hazardSet.has(key)) {
        ctx.fillStyle = palette.hazard + '45'; ctx.fillRect(px + 2, py + 2, cell - 4, cell - 4);
        ctx.fillStyle = palette.hazard; ctx.beginPath(); ctx.moveTo(px + cell / 2, py + 5); ctx.lineTo(px + cell - 5, py + cell / 2); ctx.lineTo(px + cell / 2, py + cell - 5); ctx.lineTo(px + 5, py + cell / 2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#25231e'; ctx.fillRect(px + 9, py + 8, 4, 6);
      } else if (relicSet.has(key)) {
        ctx.fillStyle = palette.relic + '36'; ctx.beginPath(); ctx.arc(px + 11, py + 11, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = palette.relic; ctx.beginPath(); ctx.moveTo(px + 11, py + 5); ctx.lineTo(px + 16, py + 11); ctx.lineTo(px + 11, py + 17); ctx.lineTo(px + 6, py + 11); ctx.closePath(); ctx.fill();
      }
      if (key === exitSet) {
        ctx.fillStyle = '#70d2ef2b'; ctx.fillRect(px + 1, py + 1, cell - 2, cell - 2);
        ctx.strokeStyle = '#8be3fb'; ctx.lineWidth = 2; ctx.strokeRect(px + 4, py + 4, cell - 8, cell - 8);
        ctx.fillStyle = '#8be3fb'; ctx.fillRect(px + 8, py + 8, 6, 6);
      }
      if (key === startSet) {
        ctx.fillStyle = '#d6f36a35'; ctx.fillRect(px + 1, py + 1, cell - 2, cell - 2);
        ctx.fillStyle = palette.relic; ctx.beginPath(); ctx.arc(px + 11, py + 11, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#293320'; ctx.beginPath(); ctx.arc(px + 11, py + 11, 2, 0, Math.PI * 2); ctx.fill();
      }
    }
    $('#roomCount').textContent = world.rooms.length;
    $('#relicCount').textContent = world.relics.length;
    $('#dangerCount').textContent = world.hazards.length;
    $('#biomeReadout').textContent = palette.name;
    $('#sizeReadout').textContent = `${world.cols} × ${world.rows}`;
    $('#levelNumber').textContent = `МИР ${String(levelNumber).padStart(3, '0')}`;
    canvas.setAttribute('aria-label', `Карта ${palette.name.toLowerCase()}, зерно ${world.seed}, ${world.rooms.length} комнат`);
  }

  function updateDensity() {
    densityValue.value = densitySlider.value;
    densityValue.textContent = densitySlider.value;
    const min = Number(densitySlider.min), max = Number(densitySlider.max);
    const progress = ((Number(densitySlider.value) - min) / (max - min)) * 100;
    densitySlider.style.setProperty('--range-progress', `${progress}%`);
  }

  function paramsForWorld(world = currentWorld) {
    if (!world) return {};
    return { seed: world.seed, biome: world.biome, size: sizeSelect.value, density: densitySlider.value, danger: dangerSelect.value };
  }

  function updateUrl() {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(paramsForWorld())) url.searchParams.set(key, value);
    history.replaceState({}, '', url);
  }

  function setFromUrl() {
    const params = new URLSearchParams(location.search);
    if (params.has('seed')) seedInput.value = params.get('seed').slice(0, 20);
    if (colors[params.get('biome')]) biomeSelect.value = params.get('biome');
    if (sizes[params.get('size')]) sizeSelect.value = params.get('size');
    if (params.has('density')) densitySlider.value = String(Math.min(15, Math.max(5, Number(params.get('density')) || 9)));
    if (difficulty[params.get('danger')]) dangerSelect.value = params.get('danger');
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2200);
  }

  function getFavorites() {
    try { return JSON.parse(localStorage.getItem('levelseed:favorites') || '[]'); }
    catch { return []; }
  }

  function saveFavorites(items) {
    try { localStorage.setItem('levelseed:favorites', JSON.stringify(items.slice(0, 8))); }
    catch { showToast('Не удалось сохранить закладки в этом браузере.'); }
    renderFavorites();
  }

  function renderFavorites() {
    const list = getFavorites();
    $('#favoriteTotal').textContent = `${list.length} / 8`;
    const target = $('#favoritesList');
    target.replaceChildren();
    if (!list.length) {
      const empty = document.createElement('p'); empty.className = 'empty-favorites'; empty.textContent = 'Сохрани карту, чтобы быстро вернуться к ней.'; target.append(empty); return;
    }
    for (const item of list) {
      const row = document.createElement('div'); row.className = 'favorite-row';
      const load = document.createElement('button'); load.type = 'button'; load.className = 'favorite-item';
      load.innerHTML = `<span>${escapeHtml(item.seed)}</span><small>${escapeHtml(item.algorithm?.toUpperCase() || colors[item.biome]?.name || 'МИР')}</small>`;
      load.addEventListener('click', () => {
        seedInput.value = item.seed; algorithmSelect.value = item.algorithm || 'bsp'; biomeSelect.value = item.biome; sizeSelect.value = item.size; densitySlider.value = item.density; dangerSelect.value = item.danger;
        updateDensity(); generateWorld(); showToast(`Мир ${item.seed} восстановлен.`);
      });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'favorite-remove'; remove.setAttribute('aria-label', `Удалить ${item.seed} из закладок`); remove.textContent = '×';
      remove.addEventListener('click', () => saveFavorites(getFavorites().filter((fav) => fav.seed !== item.seed || fav.biome !== item.biome)));
      row.append(load, remove); target.append(row);
    }
  }

  function syncFavoriteButton() {
    if (!currentWorld) return;
    const saved = getFavorites().some((item) => item.seed === currentWorld.seed && item.algorithm === currentWorld.algorithm && item.biome === currentWorld.biome && item.size === sizeSelect.value && item.density === densitySlider.value && item.danger === dangerSelect.value);
    const button = $('#favoriteButton');
    button.classList.toggle('is-saved', saved);
    button.setAttribute('aria-pressed', String(saved));
    $('#favoriteButton .star-icon').textContent = saved ? '★' : '☆';
  }

  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

  function toggleFavorite() {
    const favorites = getFavorites();
    const key = (item) => item.seed === currentWorld.seed && item.algorithm === currentWorld.algorithm && item.biome === currentWorld.biome && item.size === sizeSelect.value && item.density === densitySlider.value && item.danger === dangerSelect.value;
    if (favorites.some(key)) {
      saveFavorites(favorites.filter((item) => !key(item)));
      $('#favoriteButton').classList.remove('is-saved'); $('#favoriteButton').setAttribute('aria-pressed', 'false'); $('#favoriteButton .star-icon').textContent = '☆';
      showToast('Удалено из закладок.');
      return;
    }
    if (favorites.length >= 8) { showToast('Все 8 закладок заняты. Удали одну, чтобы продолжить.'); return; }
    favorites.unshift(paramsForWorld()); saveFavorites(favorites);
    $('#favoriteButton').classList.add('is-saved'); $('#favoriteButton').setAttribute('aria-pressed', 'true'); $('#favoriteButton .star-icon').textContent = '★';
    showToast('Мир сохранён в закладки.');
  }

  async function copyShareLink() {
    updateUrl();
    try { await navigator.clipboard.writeText(location.href); showToast('Ссылка на этот мир скопирована.'); }
    catch { showToast('Скопируй адрес страницы из строки браузера.'); }
  }

  function downloadMap() {
    const anchor = document.createElement('a');
    anchor.download = `levelseed-${currentWorld.seed.toLowerCase()}.png`;
    anchor.href = canvas.toDataURL('image/png');
    anchor.click();
    showToast('Карта скачана в PNG.');
  }

  function wireEvents() {
    $('#generateButton').addEventListener('click', generateWorld);
    $('#randomSeed').addEventListener('click', () => { seedInput.value = makeSeed(); generateWorld(); });
    window.addEventListener('levelseed:new-level', () => { seedInput.value = makeSeed(); generateWorld(); });
    $('#favoriteButton').addEventListener('click', toggleFavorite);
    $('#shareButton').addEventListener('click', copyShareLink);
    $('#downloadButton').addEventListener('click', downloadMap);
    seedInput.addEventListener('change', () => { if (seedInput.value.trim()) generateWorld(); });
    densitySlider.addEventListener('input', updateDensity);
    densitySlider.addEventListener('change', generateWorld);
    for (const select of [biomeSelect, sizeSelect, dangerSelect]) select.addEventListener('change', generateWorld);
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      if (event.target === seedInput) { event.preventDefault(); generateWorld(); return; }
      if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLSelectElement) return;
      generateWorld();
    });
  }

  function cloneGrid(grid) { return grid.map((row) => row.slice()); }

  function snapshot(trace, label, description, codeLine, tiles) {
    trace.push({ label, description, codeLine, tiles: cloneGrid(tiles) });
  }

  function splitSpace(world, rng, density) {
    const area = (world.cols - 2) * (world.rows - 2);
    const minW = Math.max(6, Math.round(world.cols / 20));
    const minH = Math.max(5, Math.round(world.rows / 16));
    const target = Math.max(5, Math.min(Math.floor(area / (minW * minH)), Math.round(Number(density) * area / 416)));
    const leaves = [{ x: 1, y: 1, w: world.cols - 2, h: world.rows - 2 }];
    const dividers = [];
    while (leaves.length < target) {
      const sorted = leaves.slice().sort((a, b) => b.w * b.h - a.w * a.h);
      const current = sorted.find((part) => part.w >= minW * 2 || part.h >= minH * 2);
      if (!current) break;
      const vertical = current.w >= minW * 2 && (current.h < minH * 2 || current.w > current.h || rng() > .5);
      if (vertical) {
        const cut = current.x + minW + Math.floor(rng() * Math.max(1, current.w - minW * 2 + 1));
        dividers.push({ x1: cut, y1: current.y, x2: cut, y2: current.y + current.h - 1 });
        leaves.splice(leaves.indexOf(current), 1, { x: current.x, y: current.y, w: cut - current.x, h: current.h }, { x: cut, y: current.y, w: current.x + current.w - cut, h: current.h });
      } else {
        const cut = current.y + minH + Math.floor(rng() * Math.max(1, current.h - minH * 2 + 1));
        dividers.push({ x1: current.x, y1: cut, x2: current.x + current.w - 1, y2: cut });
        leaves.splice(leaves.indexOf(current), 1, { x: current.x, y: current.y, w: current.w, h: cut - current.y }, { x: current.x, y: cut, w: current.w, h: current.y + current.h - cut });
      }
    }
    world.tiles = Array.from({ length: world.rows }, () => Array(world.cols).fill(0));
    const trace = [];
    snapshot(trace, '01 · ОБЛАСТЬ', algorithms.bsp.stages[0][1], 0, world.tiles);
    for (const line of dividers) {
      if (line.x1 === line.x2) for (let y = line.y1; y <= line.y2; y++) world.tiles[y][line.x1] = 2;
      else for (let x = line.x1; x <= line.x2; x++) world.tiles[line.y1][x] = 2;
    }
    snapshot(trace, '02 · РАЗДЕЛЕНИЕ', algorithms.bsp.stages[1][1], 1, world.tiles);
    const rooms = leaves.map((part) => {
      const marginX = Math.min(2, Math.max(1, Math.floor((part.w - 3) / 2)));
      const marginY = Math.min(2, Math.max(1, Math.floor((part.h - 3) / 2)));
      const room = { x: part.x + marginX, y: part.y + marginY, w: Math.max(3, part.w - marginX - 1 - Math.floor(rng() * Math.max(1, marginX))), h: Math.max(3, part.h - marginY - 1 - Math.floor(rng() * Math.max(1, marginY))) };
      room.w = Math.min(room.w, world.cols - room.x - 2); room.h = Math.min(room.h, world.rows - room.y - 2);
      room.cx = room.x + Math.floor(room.w / 2); room.cy = room.y + Math.floor(room.h / 2);
      for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) world.tiles[y][x] = 1;
      return room;
    });
    world.rooms = rooms;
    for (let i = 1; i < rooms.length; i++) connectRooms(world, rooms[i - 1], rooms[i], rng);
    snapshot(trace, '03 · КОМНАТЫ', algorithms.bsp.stages[2][1], 2, world.tiles);
    return trace;
  }

  function floorComponents(tiles, cols, rows) {
    const visited = new Uint8Array(cols * rows);
    const found = [];
    for (let sy = 1; sy < rows - 1; sy++) for (let sx = 1; sx < cols - 1; sx++) {
      const start = sy * cols + sx;
      if (visited[start] || tiles[sy][sx] !== 1) continue;
      const points = []; const queue = [start]; visited[start] = 1;
      for (let q = 0; q < queue.length; q++) {
        const idx = queue[q]; const x = idx % cols; const y = Math.floor(idx / cols); points.push({ x, y });
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          if (nx < 1 || ny < 1 || nx >= cols - 1 || ny >= rows - 1) continue;
          const ni = ny * cols + nx;
          if (!visited[ni] && tiles[ny][nx] === 1) { visited[ni] = 1; queue.push(ni); }
        }
      }
      found.push(points);
    }
    return found.sort((a, b) => b.length - a.length);
  }

  function connectCaves(world) {
    const comps = floorComponents(world.tiles, world.cols, world.rows);
    if (!comps.length) { world.tiles[Math.floor(world.rows / 2)][Math.floor(world.cols / 2)] = 1; return; }
    let main = comps[0].slice();
    for (const component of comps.slice(1)) {
      let cx = 0, cy = 0;
      for (const point of component) { cx += point.x; cy += point.y; }
      cx = Math.round(cx / component.length); cy = Math.round(cy / component.length);
      let nearest = main[0], best = Infinity;
      for (const point of main) { const dist = (point.x - cx) ** 2 + (point.y - cy) ** 2; if (dist < best) { best = dist; nearest = point; } }
      const from = component[0];
      let x = from.x, y = from.y;
      while (x !== nearest.x) { world.tiles[y][x] = 1; x += Math.sign(nearest.x - x); }
      while (y !== nearest.y) { world.tiles[y][x] = 1; y += Math.sign(nearest.y - y); }
      world.tiles[y][x] = 1;
      main.push(...component, { x: from.x, y: from.y }, { x: nearest.x, y: nearest.y });
    }
  }

  function buildCave(world, rng, density) {
    const trace = [];
    const tiles = Array.from({ length: world.rows }, () => Array(world.cols).fill(0));
    const wallChance = .64 + (Number(density) - 10) * .006;
    for (let y = 1; y < world.rows - 1; y++) for (let x = 1; x < world.cols - 1; x++) tiles[y][x] = rng() < wallChance ? 0 : 1;
    world.tiles = tiles;
    snapshot(trace, '01 · ШУМ', algorithms.cellular.stages[0][1], 0, tiles);
    for (let generation = 0; generation < 4; generation++) {
      const next = tiles.map((row) => row.slice());
      for (let y = 1; y < world.rows - 1; y++) for (let x = 1; x < world.cols - 1; x++) {
        let walls = 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if ((ox || oy) && tiles[y + oy][x + ox] === 0) walls++;
        next[y][x] = walls >= 5 ? 0 : 1;
      }
      for (let x = 0; x < world.cols; x++) { next[0][x] = 0; next[world.rows - 1][x] = 0; }
      for (let y = 0; y < world.rows; y++) { next[y][0] = 0; next[y][world.cols - 1] = 0; }
      for (let y = 0; y < world.rows; y++) tiles[y] = next[y];
      if (generation === 0) snapshot(trace, '02 · ПОКОЛЕНИЕ 01', algorithms.cellular.stages[1][1], 1, tiles);
    }
    snapshot(trace, '03 · СГЛАЖИВАНИЕ', algorithms.cellular.stages[2][1], 2, tiles);
    connectCaves(world);
    snapshot(trace, '04 · СВЯЗНОСТЬ', algorithms.cellular.stages[3][1], 3, tiles);
    world.rooms = [];
    return trace;
  }

  function buildWalk(world, rng, density) {
    const trace = [];
    const tiles = Array.from({ length: world.rows }, () => Array(world.cols).fill(0));
    world.tiles = tiles;
    let x = Math.floor(world.cols / 2), y = Math.floor(world.rows / 2), direction = Math.floor(rng() * 4);
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const target = Math.floor((world.cols - 2) * (world.rows - 2) * (.12 + Number(density) * .022));
    let floorCount = 0, steps = 0;
    const floorCells = [];
    const addCell = (cx, cy) => { if (cx > 0 && cy > 0 && cx < world.cols - 1 && cy < world.rows - 1 && tiles[cy][cx] !== 1) { tiles[cy][cx] = 1; floorCells.push({ x: cx, y: cy }); floorCount++; } };
    addCell(x, y);
    snapshot(trace, '01 · ТОЧКА СТАРТА', algorithms.walker.stages[0][1], 0, tiles);
    let capturedFirst = false, capturedSecond = false;
    const limit = Math.max(target * 80, 1000);
    while (floorCount < target && steps < limit) {
      if (steps % 18 === 0 && floorCells.length > 4) { const cell = floorCells[Math.floor(rng() * floorCells.length)]; x = cell.x; y = cell.y; }
      if (rng() < .38) direction = Math.floor(rng() * 4);
      let [dx, dy] = dirs[direction];
      let nx = x + dx, ny = y + dy;
      if (nx < 1 || ny < 1 || nx >= world.cols - 1 || ny >= world.rows - 1) { direction = (direction + 2 + Math.floor(rng() * 2)) % 4; [dx, dy] = dirs[direction]; nx = x + dx; ny = y + dy; }
      x = nx; y = ny; addCell(x, y); steps++;
      if (!capturedFirst && floorCount >= target * .25) { capturedFirst = true; snapshot(trace, '02 · ПЕРВЫЙ СЛЕД', algorithms.walker.stages[1][1], 1, tiles); }
      if (!capturedSecond && floorCount >= target * .64) { capturedSecond = true; snapshot(trace, '03 · РОСТ СЕТИ', algorithms.walker.stages[2][1], 2, tiles); }
    }
    world.walkSteps = steps;
    world.rooms = [];
    if (!capturedFirst) snapshot(trace, '02 · ПЕРВЫЙ СЛЕД', algorithms.walker.stages[1][1], 1, tiles);
    if (!capturedSecond) snapshot(trace, '03 · РОСТ СЕТИ', algorithms.walker.stages[2][1], 2, tiles);
    snapshot(trace, '04 · ЗАМЫКАНИЕ', algorithms.walker.stages[3][1], 3, tiles);
    return trace;
  }

  function farthestFrom(world, origin) {
    const total = world.cols * world.rows; const dist = new Int32Array(total); dist.fill(-1);
    const start = origin.y * world.cols + origin.x; const queue = [start]; dist[start] = 0; let far = start;
    for (let i = 0; i < queue.length; i++) {
      const idx = queue[i], x = idx % world.cols, y = Math.floor(idx / world.cols);
      if (dist[idx] > dist[far]) far = idx;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 1 || ny < 1 || nx >= world.cols - 1 || ny >= world.rows - 1 || world.tiles[ny][nx] !== 1) continue;
        const ni = ny * world.cols + nx;
        if (dist[ni] === -1) { dist[ni] = dist[idx] + 1; queue.push(ni); }
      }
    }
    return { x: far % world.cols, y: Math.floor(far / world.cols), distance: dist[far] };
  }

  function placeWorldObjects(world, rng) {
    const floorCells = [];
    for (let y = 1; y < world.rows - 1; y++) for (let x = 1; x < world.cols - 1; x++) if (world.tiles[y][x] === 1) floorCells.push({ x, y });
    if (!floorCells.length) { const x = Math.floor(world.cols / 2), y = Math.floor(world.rows / 2); world.tiles[y][x] = 1; floorCells.push({ x, y }); }
    const start = floorCells[Math.floor(rng() * Math.min(floorCells.length, Math.max(1, Math.floor(floorCells.length * .12))))];
    world.start = { x: start.x, y: start.y };
    const far = farthestFrom(world, world.start);
    world.exit = { x: far.x, y: far.y };
    const available = floorCells.filter((p) => (p.x !== world.start.x || p.y !== world.start.y) && (p.x !== world.exit.x || p.y !== world.exit.y));
    for (let i = available.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [available[i], available[j]] = [available[j], available[i]]; }
    const hazardTotal = Math.min(300, Math.max(2, Math.round(floorCells.length * difficulty[dangerSelect.value])));
    world.hazards = available.slice(0, hazardTotal);
    const relicTotal = Math.min(40, Math.max(2, Math.floor(floorCells.length / 140)));
    world.relics = available.slice(hazardTotal, hazardTotal + relicTotal);
    world.floorCount = floorCells.length;
  }

  function tileWord(count) {
    const lastTwo = count % 100;
    const last = count % 10;
    if (last === 1 && lastTwo !== 11) return 'клетка';
    if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return 'клетки';
    return 'клеток';
  }

  function generateWorld() {
    if (traceTimer) { clearInterval(traceTimer); traceTimer = null; }
    const seed = (seedInput.value.trim() || makeSeed()).slice(0, 20);
    seedInput.value = seed;
    const [cols, rows] = sizes[sizeSelect.value];
    const algorithm = algorithmSelect.value;
    const rng = seededRandom(`${seed}|${algorithm}|${biomeSelect.value}|${sizeSelect.value}|${densitySlider.value}|${dangerSelect.value}`);
    const world = { seed, cols, rows, algorithm, biome: biomeSelect.value, tiles: Array.from({ length: rows }, () => Array(cols).fill(0)), rooms: [], hazards: [], relics: [] };
    const trace = algorithm === 'cellular' ? buildCave(world, rng, densitySlider.value) : algorithm === 'walker' ? buildWalk(world, rng, densitySlider.value) : splitSpace(world, rng, densitySlider.value);
    placeWorldObjects(world, rng);
    const meta = algorithms[algorithm];
    snapshot(trace, `${String(trace.length + 1).padStart(2, '0')} · ФИНИШ`, meta.stages[meta.stages.length - 1][1], meta.stages.length - 1, world.tiles);
    world.trace = trace;
    currentWorld = world;
    levelNumber++;
    world.level = levelNumber;
    window.dispatchEvent(new CustomEvent('levelseed:world-generated', { detail: { world } }));
    $('#traceTitle').textContent = meta.title;
    renderAlgorithmCode(algorithm);
    traceIndex = 0;
    renderTraceStep(0);
    if (traceTimer) clearInterval(traceTimer);
    traceTimer = setInterval(() => {
      if (traceIndex >= currentWorld.trace.length - 1) { clearInterval(traceTimer); traceTimer = null; return; }
      renderTraceStep(traceIndex + 1);
    }, cols > 80 ? 450 : 330);
    syncFavoriteButton();
    updateUrl();
  }

  function renderWorld(world) {
    const palette = colors[world.biome];
    const cell = Math.max(4, Math.min(18, Math.floor(Math.sqrt(3000000 / (world.cols * world.rows)))));
    canvas.width = world.cols * cell;
    canvas.height = world.rows * cell;
    const zoom = Number($('#zoomSlider').value);
    canvas.style.width = `${zoom}%`;
    $('#zoomValue').textContent = `${zoom}%`;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#121619'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const visualRng = seededRandom(`${world.seed}|${world.algorithm}|texture|${traceIndex}`);
    const hazardSet = new Set((world.hazards || []).map((p) => `${p.x},${p.y}`));
    const relicSet = new Set((world.relics || []).map((p) => `${p.x},${p.y}`));
    const exitSet = world.exit ? `${world.exit.x},${world.exit.y}` : '';
    const startSet = world.start ? `${world.start.x},${world.start.y}` : '';
    for (let y = 0; y < world.rows; y++) for (let x = 0; x < world.cols; x++) {
      const px = x * cell, py = y * cell, key = `${x},${y}`, value = world.tiles[y][x];
      if (value === 0) {
        ctx.fillStyle = palette.wall; ctx.fillRect(px, py, cell, cell);
        if (visualRng() > .72) { ctx.fillStyle = palette.wallLight; ctx.fillRect(px + 2, py + 2, cell - 4, 2); }
        ctx.strokeStyle = '#101519'; ctx.lineWidth = 1; ctx.strokeRect(px + .5, py + .5, cell - 1, cell - 1);
        continue;
      }
      if (value === 2) {
        ctx.fillStyle = '#30393c'; ctx.fillRect(px, py, cell, cell);
        ctx.fillStyle = palette.trim; ctx.fillRect(px + cell / 2 - 1, py + cell / 2 - 1, 2, 2);
        continue;
      }
      ctx.fillStyle = visualRng() > .8 ? palette.floorAlt : palette.floor; ctx.fillRect(px, py, cell, cell);
      ctx.strokeStyle = '#19232930'; ctx.lineWidth = 1; ctx.strokeRect(px + .5, py + .5, cell - 1, cell - 1);
      if (cell > 8 && visualRng() > .9) { ctx.fillStyle = palette.trim + '88'; ctx.fillRect(px + 5, py + 5, 3, 3); }
      if (hazardSet.has(key)) {
        ctx.fillStyle = palette.hazard + '45'; ctx.fillRect(px + 2, py + 2, cell - 4, cell - 4);
        ctx.fillStyle = palette.hazard; ctx.beginPath(); ctx.moveTo(px + cell / 2, py + 3); ctx.lineTo(px + cell - 3, py + cell / 2); ctx.lineTo(px + cell / 2, py + cell - 3); ctx.lineTo(px + 3, py + cell / 2); ctx.closePath(); ctx.fill();
        if (cell >= 12) { ctx.fillStyle = '#25231e'; ctx.fillRect(px + cell / 2 - 1, py + cell / 2 - 3, 2, 6); }
      } else if (relicSet.has(key)) {
        ctx.fillStyle = palette.relic + '36'; ctx.beginPath(); ctx.arc(px + cell / 2, py + cell / 2, cell / 2 - 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = palette.relic; ctx.beginPath(); ctx.moveTo(px + cell / 2, py + 3); ctx.lineTo(px + cell - 3, py + cell / 2); ctx.lineTo(px + cell / 2, py + cell - 3); ctx.lineTo(px + 3, py + cell / 2); ctx.closePath(); ctx.fill();
      }
      if (key === exitSet) {
        ctx.fillStyle = '#70d2ef2b'; ctx.fillRect(px + 1, py + 1, cell - 2, cell - 2);
        ctx.strokeStyle = '#8be3fb'; ctx.lineWidth = 2; ctx.strokeRect(px + 3, py + 3, cell - 6, cell - 6);
        ctx.fillStyle = '#8be3fb'; ctx.fillRect(px + 6, py + 6, Math.max(2, cell - 12), Math.max(2, cell - 12));
      }
      if (key === startSet) {
        ctx.fillStyle = '#d6f36a35'; ctx.fillRect(px + 1, py + 1, cell - 2, cell - 2);
        ctx.fillStyle = palette.relic; ctx.beginPath(); ctx.arc(px + cell / 2, py + cell / 2, Math.max(2, cell / 3), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#293320'; ctx.beginPath(); ctx.arc(px + cell / 2, py + cell / 2, Math.max(1, cell / 8), 0, Math.PI * 2); ctx.fill();
      }
    }
    const floors = world.tiles.reduce((sum, row) => sum + row.reduce((count, tile) => count + (tile === 1 ? 1 : 0), 0), 0);
    const primary = world.algorithm === 'bsp' ? String(world.rooms.length) : world.algorithm === 'cellular' ? `${Math.round(floors / (world.cols * world.rows) * 100)}%` : floors.toLocaleString('ru-RU');
    $('#primaryCount').textContent = primary;
    $('#primaryLabel').textContent = world.algorithm === 'bsp' ? 'КОМНАТЫ' : world.algorithm === 'cellular' ? 'ПОЛОСТЬ' : 'ПРОХОДЫ';
    $('#relicCount').textContent = (world.relics || []).length;
    $('#dangerCount').textContent = (world.hazards || []).length;
    $('#biomeReadout').textContent = palette.name;
    $('#sizeReadout').textContent = `${world.cols} × ${world.rows}`;
    const tileCount = world.cols * world.rows;
    $('#sizeNote').textContent = `${tileCount.toLocaleString('ru-RU')} ${tileWord(tileCount)}`;
    $('#levelNumber').textContent = `МИР ${String(levelNumber).padStart(3, '0')}`;
    canvas.setAttribute('aria-label', `Карта ${palette.name.toLowerCase()}, алгоритм ${algorithms[world.algorithm].title}, зерно ${world.seed}`);
  }

  function downloadMap() {
    canvas.toBlob((blob) => {
      if (!blob) { showToast('Не удалось экспортировать карту.'); return; }
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.download = `levelseed-${currentWorld.seed.toLowerCase()}.png`; link.href = url; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('Карта скачана в PNG.');
    }, 'image/png');
  }

  function renderAlgorithmCode(algorithm) {
    const target = $('#algorithmCode'); target.replaceChildren();
    for (const [index, line] of algorithms[algorithm].code.entries()) {
      const item = document.createElement('li'); item.dataset.number = `${String(index + 1).padStart(2, '0')}`; item.textContent = line; target.append(item);
    }
  }

  function renderTraceStep(index) {
    if (!currentWorld?.trace?.length) return;
    traceIndex = Math.max(0, Math.min(index, currentWorld.trace.length - 1));
    const step = currentWorld.trace[traceIndex];
    const isFinal = traceIndex === currentWorld.trace.length - 1;
    const preview = { ...currentWorld, tiles: step.tiles, rooms: (isFinal || step.codeLine >= 2) ? currentWorld.rooms : [], hazards: isFinal ? currentWorld.hazards : [], relics: isFinal ? currentWorld.relics : [], start: isFinal ? currentWorld.start : null, exit: isFinal ? currentWorld.exit : null };
    renderWorld(preview);
    $('#traceStage').textContent = step.label;
    $('#traceDescription').textContent = step.description;
    $('#traceProgress').style.width = `${((traceIndex + 1) / currentWorld.trace.length) * 100}%`;
    [...$('#algorithmCode').children].forEach((line, i) => line.classList.toggle('is-active', i === step.codeLine));
  }

  function playTrace() {
    if (!currentWorld?.trace?.length) return;
    if (traceTimer) clearInterval(traceTimer);
    traceTimer = null;
    renderTraceStep(0);
    traceTimer = setInterval(() => {
      if (!currentWorld || traceIndex >= currentWorld.trace.length - 1) { clearInterval(traceTimer); traceTimer = null; return; }
      renderTraceStep(traceIndex + 1);
    }, currentWorld.cols > 80 ? 450 : 330);
  }

  function updateAlgorithmLabels() {
    const labels = {
      bsp: ['Число комнат', 'МЕНЬШЕ', 'БОЛЬШЕ'],
      cellular: ['Плотность скалы', 'ПЕЩЕРИСТО', 'КАМЕНИСТО'],
      walker: ['Разрастание пути', 'КОМПАКТНО', 'РАЗВЕТВЛЁННО']
    }[algorithmSelect.value];
    $('#densityLabel').textContent = labels[0]; $('#densityLow').textContent = labels[1]; $('#densityHigh').textContent = labels[2];
  }

  function updateDensity() {
    densityValue.value = densitySlider.value; densityValue.textContent = densitySlider.value;
    const min = Number(densitySlider.min), max = Number(densitySlider.max);
    densitySlider.style.setProperty('--range-progress', `${((Number(densitySlider.value) - min) / (max - min)) * 100}%`);
    updateAlgorithmLabels();
  }

  function paramsForWorld(world = currentWorld) {
    if (!world) return {};
    return { seed: world.seed, algorithm: world.algorithm, biome: world.biome, size: sizeSelect.value, density: densitySlider.value, danger: dangerSelect.value };
  }

  function setFromUrl() {
    const params = new URLSearchParams(location.search);
    if (params.has('seed')) seedInput.value = params.get('seed').slice(0, 20);
    if (algorithms[params.get('algorithm')]) algorithmSelect.value = params.get('algorithm');
    if (colors[params.get('biome')]) biomeSelect.value = params.get('biome');
    if (sizes[params.get('size')]) sizeSelect.value = params.get('size');
    if (params.has('density')) densitySlider.value = String(Math.min(15, Math.max(5, Number(params.get('density')) || 9)));
    if (difficulty[params.get('danger')]) dangerSelect.value = params.get('danger');
  }

  function wireEvents() {
    $('#generateButton').addEventListener('click', generateWorld);
    $('#randomSeed').addEventListener('click', () => { seedInput.value = makeSeed(); generateWorld(); });
    $('#favoriteButton').addEventListener('click', toggleFavorite);
    $('#shareButton').addEventListener('click', copyShareLink);
    $('#downloadButton').addEventListener('click', downloadMap);
    $('#jsonButton').addEventListener('click', downloadWorldJson);
    $('#traceReplay').addEventListener('click', playTrace);
    $('#traceNext').addEventListener('click', () => {
      if (traceTimer) { clearInterval(traceTimer); traceTimer = null; }
      if (currentWorld?.trace) renderTraceStep((traceIndex + 1) % currentWorld.trace.length);
    });
    $('#zoomSlider').addEventListener('input', () => {
      const zoom = $('#zoomSlider').value; $('#zoomValue').textContent = `${zoom}%`; canvas.style.width = `${zoom}%`;
    });
    seedInput.addEventListener('change', () => { if (seedInput.value.trim()) generateWorld(); });
    densitySlider.addEventListener('input', updateDensity);
    densitySlider.addEventListener('change', generateWorld);
    for (const select of [algorithmSelect, biomeSelect, sizeSelect, dangerSelect]) select.addEventListener('change', () => { updateDensity(); generateWorld(); });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      if (event.target === seedInput) { event.preventDefault(); generateWorld(); return; }
      if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
      generateWorld();
    });
  }

  function downloadWorldJson() {
    const payload = {
      format: 'levelseed-map-v1', seed: currentWorld.seed, algorithm: currentWorld.algorithm, biome: currentWorld.biome,
      width: currentWorld.cols, height: currentWorld.rows,
      legend: { 0: 'wall', 1: 'floor', 2: 'partition' }, tiles: currentWorld.tiles,
      entrance: currentWorld.start, exit: currentWorld.exit, rooms: currentWorld.rooms,
      walkSteps: currentWorld.walkSteps || null, hazards: currentWorld.hazards, relics: currentWorld.relics
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `levelseed-${currentWorld.seed.toLowerCase()}.json`; link.click(); URL.revokeObjectURL(url);
    showToast('Данные уровня сохранены в JSON.');
  }

  setFromUrl();
  if (!seedInput.value) seedInput.value = 'GROVE-7A2D';
  updateDensity();
  wireEvents();
  renderFavorites();
  generateWorld();
})();
