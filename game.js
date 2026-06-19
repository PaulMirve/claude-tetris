'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

// Fix 1 & 2: Remove dead top-level COLORS; define BASE_COLORS once and share it.
const BASE_COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
];

// Fix 8: Shared alpha helper used by all skins.
function withAlpha(ctx, alpha, fn) {
  ctx.globalAlpha = alpha ?? 1;
  fn();
  ctx.globalAlpha = 1;
}

// Fix 7: Pixel skin offscreen checkerboard cache.
const pixelCache = { canvas: null, blockSize: null };
function getPixelCheckerboard(size) {
  if (pixelCache.canvas && pixelCache.blockSize === size) return pixelCache.canvas;
  const offscreen = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(size, size)
    : (() => { const c = document.createElement('canvas'); c.width = size; c.height = size; return c; })();
  const octx = offscreen.getContext('2d');
  const grid = 4;
  const cellW = (size - 2) / grid;
  const cellH = (size - 2) / grid;
  for (let gr = 0; gr < grid; gr++) {
    for (let gc = 0; gc < grid; gc++) {
      const isLight = (gr + gc) % 2 === 0;
      octx.fillStyle = isLight ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)';
      octx.fillRect(1 + gc * cellW, 1 + gr * cellH, cellW, cellH);
    }
  }
  pixelCache.canvas = offscreen;
  pixelCache.blockSize = size;
  return offscreen;
}

const SKINS = {
  Retro: {
    colors: BASE_COLORS,
    canvasBackground: null,
    drawBlock(ctx, x, y, colorIdx, size, alpha) {
      const color = this.colors[colorIdx];
      withAlpha(ctx, alpha, () => {
        ctx.fillStyle = color;
        ctx.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(x * size + 1, y * size + 1, size - 2, 4);
      });
    },
  },

  // Fix 4: shadowBlur is set once in draw() before the board loop, not per block.
  Neon: {
    colors: BASE_COLORS,
    canvasBackground: '#000000', // Fix 5: canvasBackground property
    drawBlock(ctx, x, y, colorIdx, size, alpha) {
      const color = this.colors[colorIdx];
      withAlpha(ctx, alpha, () => {
        ctx.shadowColor = color;
        ctx.fillStyle = color;
        ctx.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
      });
    },
  },

  Pastel: {
    colors: [
      null,
      '#a8eaf4', // I - pastel cyan
      '#fff3b0', // O - pastel yellow
      '#ddb8e8', // T - pastel purple
      '#b8e6ba', // S - pastel green
      '#f5b8b8', // Z - pastel red
      '#c8dff8', // J - pastel blue
      '#ffd9a8', // L - pastel orange
    ],
    canvasBackground: null,
    drawBlock(ctx, x, y, colorIdx, size, alpha) {
      const color = this.colors[colorIdx];
      withAlpha(ctx, alpha, () => {
        const px = x * size + 1;
        const py = y * size + 1;
        const w = size - 2;
        const h = size - 2;
        const r = Math.min(6, w / 3);
        ctx.fillStyle = color;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(px, py, w, h, r);
        } else {
          ctx.moveTo(px + r, py);
          ctx.lineTo(px + w - r, py);
          ctx.quadraticCurveTo(px + w, py, px + w, py + r);
          ctx.lineTo(px + w, py + h - r);
          ctx.quadraticCurveTo(px + w, py + h, px + w - r, py + h);
          ctx.lineTo(px + r, py + h);
          ctx.quadraticCurveTo(px, py + h, px, py + h - r);
          ctx.lineTo(px, py + r);
          ctx.quadraticCurveTo(px, py, px + r, py);
          ctx.closePath();
        }
        ctx.fill();
      });
    },
  },

  Pixel: {
    colors: BASE_COLORS,
    canvasBackground: null,
    drawBlock(ctx, x, y, colorIdx, size, alpha) {
      const color = this.colors[colorIdx];
      // Fix 7: use pre-rendered offscreen checkerboard
      withAlpha(ctx, alpha, () => {
        ctx.fillStyle = color;
        ctx.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
        ctx.drawImage(getPixelCheckerboard(size), x * size, y * size);
      });
    },
  },
};

// Fix 3: Remove dead activeSkin initialiser — applySkin() always sets it before it is read.
let activeSkin = 'Retro';

// Fix 6: Cache grid color; updated only in applyTheme().
let cachedGridColor = '';

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const skin = SKINS[activeSkin] || SKINS.Retro;
  skin.drawBlock(context, x, y, colorIndex, size, alpha);
}

function drawGrid() {
  // Fix 6: use cached grid color instead of getComputedStyle every frame
  ctx.strokeStyle = cachedGridColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Fix 5: use canvasBackground property generically
  const skin = SKINS[activeSkin] || SKINS.Retro;
  if (skin.canvasBackground) {
    ctx.fillStyle = skin.canvasBackground;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  drawGrid();

  // Fix 4: set Neon shadowBlur once before board loop, reset after
  if (activeSkin === 'Neon') {
    ctx.shadowBlur = 12;
  }

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);

  if (activeSkin === 'Neon') {
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

const themeCheckbox = document.getElementById('theme-checkbox');

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeCheckbox.checked = theme === 'light';
  // Fix 6: cache grid color whenever theme changes
  cachedGridColor = getComputedStyle(document.documentElement).getPropertyValue('--color-grid').trim();
}

themeCheckbox.addEventListener('change', () => {
  const theme = themeCheckbox.checked ? 'light' : 'dark';
  applyTheme(theme);
  localStorage.setItem('tetris-theme', theme);
});

applyTheme(localStorage.getItem('tetris-theme') || 'dark');

const skinSelect = document.getElementById('skin-select');

function applySkin(skinName) {
  if (!SKINS[skinName]) skinName = 'Retro';
  activeSkin = skinName;
  skinSelect.value = skinName;
  localStorage.setItem('tetris-skin', skinName);
  // Invalidate Pixel skin checkerboard cache when skin changes
  pixelCache.canvas = null;
  pixelCache.blockSize = null;
  if (current) draw();
}

skinSelect.addEventListener('change', () => {
  applySkin(skinSelect.value);
});

// Fix 3: applySkin() is the sole setter of activeSkin; the old line-145 initialiser is removed.
applySkin(localStorage.getItem('tetris-skin') || 'Retro');

init();
