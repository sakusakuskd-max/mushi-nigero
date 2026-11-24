import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { StereoEffect } from 'three/addons/effects/StereoEffect.js';
import { SETTINGS as S, MAZE as M } from './settings.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ============ がめんの じゅんび ============
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87c5ff);
scene.fog = new THREE.Fog(0x87c5ff, 10, 45);
scene.add(new THREE.HemisphereLight(0xffffff, 0x665544, 1.8));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(8, 20, 4);
scene.add(sun);

const player = new THREE.Group();
scene.add(player);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 200);
camera.rotation.order = 'YXZ';
camera.position.y = M.eyeHeight;
player.add(camera);

const listener = new THREE.AudioListener();
camera.add(listener);
const actx = listener.context;
function beep(freqs, dur = 0.12, type = 'square', vol = 0.12) {
  let t = actx.currentTime;
  for (const f of freqs) {
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.value = f;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + dur);
    t += dur;
  }
}
function startAudio() { if (actx.state !== 'running') actx.resume(); }

function makeRandom(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = makeRandom(M.seed);
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ============ めいろを つくる ============
// grid[z][x]： 1=かべ 0=みち 2=ひみつの かべ（とおれる）
const N = M.size;
const W = N * 2 + 1;
const T = M.pathWidth;
const H = M.wallHeight;
const WALL = 1, OPEN = 0, FAKE = 2;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const grid = Array.from({ length: W }, () => Array(W).fill(WALL));
{
  const visited = new Set([`0,${N - 1}`]);
  const stack = [[0, N - 1]];
  grid[2 * (N - 1) + 1][1] = OPEN;
  while (stack.length) {
    const [cx, cz] = stack[stack.length - 1];
    const next = DIRS.map(([dx, dz]) => [cx + dx, cz + dz, dx, dz])
      .filter(([x, z]) => x >= 0 && z >= 0 && x < N && z < N && !visited.has(`${x},${z}`));
    if (!next.length) { stack.pop(); continue; }
    const [nx, nz, dx, dz] = next[Math.floor(rand() * next.length)];
    grid[2 * cz + 1 + dz][2 * cx + 1 + dx] = OPEN;
    grid[2 * nz + 1][2 * nx + 1] = OPEN;
    visited.add(`${nx},${nz}`);
    stack.push([nx, nz]);
  }
}
const START_T = { x: 1, z: W - 2 };
const GOAL_T = { x: W - 2, z: 1 };
const key = t => `${t.x},${t.z}`;
const tileCenter = (t, y = 0) => new THREE.Vector3((t.x - W / 2 + 0.5) * T, y, (t.z - W / 2 + 0.5) * T);
const tileOf = (x, z) => ({ x: Math.floor(x / T + W / 2), z: Math.floor(z / T + W / 2) });
const isOpen = (x, z) => grid[z] && grid[z][x] !== undefined && grid[z][x] !== WALL;

// スタートからの きょりと、ゴールまでの みち
const dist = grid.map(r => r.map(() => -1));
const prev = new Map();
{
  const q = [[START_T.x, START_T.z]];
  dist[START_T.z][START_T.x] = 0;
  while (q.length) {
    const [x, z] = q.shift();
    for (const [dx, dz] of DIRS) {
      const nx = x + dx, nz = z + dz;
      if (!grid[nz] || grid[nz][nx] !== OPEN || dist[nz][nx] >= 0) continue;
      dist[nz][nx] = dist[z][x] + 1;
      prev.set(`${nx},${nz}`, [x, z]);
      q.push([nx, nz]);
    }
  }
}
const path = [];
for (let cur = [GOAL_T.x, GOAL_T.z]; cur; cur = prev.get(`${cur[0]},${cur[1]}`)) {
  path.unshift({ x: cur[0], z: cur[1] });
}
const onPath = new Set(path.map(key));
const L = path.length;

// いきどまり
const deadEnds = [];
for (let z = 1; z < W; z += 2) {
  for (let x = 1; x < W; x += 2) {
    if (grid[z][x] !== OPEN) continue;
    if ((x === START_T.x && z === START_T.z) || (x === GOAL_T.x && z === GOAL_T.z)) continue;
    const n = DIRS.filter(([dx, dz]) => grid[z + dz][x + dx] === OPEN).length;
    if (n === 1) deadEnds.push({ x, z });
  }
}

// ひみつの ぬけみち（とおくの みちどうしを つなぐ にせものの かべ）
{
  const cands = [];
  for (let z = 1; z < W - 1; z++) {
    for (let x = 1; x < W - 1; x++) {
      if (grid[z][x] !== WALL || (x % 2) === (z % 2)) continue;
      const pair = x % 2 === 0 ? [[x - 1, z], [x + 1, z]] : [[x, z - 1], [x, z + 1]];
      const [a, b] = pair;
      if (grid[a[1]][a[0]] !== OPEN || grid[b[1]][b[0]] !== OPEN) continue;
      if (Math.abs(dist[a[1]][a[0]] - dist[b[1]][b[0]]) < 12) continue;
      cands.push({ x, z });
    }
  }
  shuffle(cands).slice(0, M.secretPaths).forEach(t => { grid[t.z][t.x] = FAKE; });
}

// ばしょ きめ：チェックポイント・トゲ・ほし
const used = new Set([key(path[0]), key(path[1] || path[0]), key(path[L - 1])]);
const checkpointTiles = [path[Math.floor(L / 3)], path[Math.floor((2 * L) / 3)]];
checkpointTiles.forEach(t => used.add(key(t)));

const trapDefs = [];
function addTrap(t, phase) {
  if (!t || used.has(key(t))) return false;
  trapDefs.push({ x: t.x, z: t.z, phase });
  used.add(key(t));
  return true;
}
// ゴールの てまえの「トゲの ろうか」（3れんぞく、じゅんばんに でる）
const zoneStart = Math.floor(L * 0.78);
for (let k = 0; k < 3; k++) addTrap(path[zoneStart + k], k * 0.22);
// みちの とちゅうの トゲ
const restTraps = Math.max(0, M.spikeTraps - 3);
for (let i = 0; i < restTraps; i++) {
  const idx = Math.floor(3 + (L * 0.75 - 3) * (i + 0.5) / restTraps);
  for (const d of [0, 1, -1, 2, -2]) if (addTrap(path[idx + d], rand())) break;
}
// ほし（いきどまりに かくす。はんぶんは トゲで まもられている）
const starTiles = shuffle(deadEnds.slice()).slice(0, M.stars);
starTiles.forEach((t, i) => {
  used.add(key(t));
  if (i % 2 === 1) {
    for (const [dx, dz] of DIRS) {
      const n = { x: t.x + dx, z: t.z + dz };
      if (grid[n.z][n.x] === OPEN && !onPath.has(key(n))) { addTrap(n, rand()); break; }
    }
  }
});

// トゲボールが ころがる まっすぐな ろうか
const ballRuns = [];
{
  const runs = [];
  const scan = (horizontal) => {
    for (let a = 1; a < W - 1; a++) {
      let run = [];
      for (let b = 1; b < W; b++) {
        const t = horizontal ? { x: b, z: a } : { x: a, z: b };
        if (b < W - 1 && grid[t.z][t.x] === OPEN) { run.push(t); continue; }
        if (run.length >= 4) runs.push(run);
        run = [];
      }
    }
  };
  scan(true);
  scan(false);
  const bad = t => used.has(key(t)) || trapDefs.some(d => d.x === t.x && d.z === t.z);
  const ok = runs.filter(r => !r.some(bad));
  ok.sort((a, b) => (b.some(t => onPath.has(key(t))) - a.some(t => onPath.has(key(t)))) || b.length - a.length);
  const taken = new Set();
  for (const r of ok) {
    if (ballRuns.length >= M.spikeBalls) break;
    if (r.some(t => taken.has(key(t)))) continue;
    r.forEach(t => taken.add(key(t)));
    ballRuns.push(r);
  }
}

// ============ みため ============
function canvasTex(draw, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
function drawBricks(g, s, base, cracks) {
  g.fillStyle = '#d8c8a8';
  g.fillRect(0, 0, s, s);
  const rows = 8, bh = s / rows, bw = s / 4;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * bw / 2;
    for (let c = -1; c < 5; c++) {
      const l = 30 + Math.random() * 12;
      g.fillStyle = `hsl(${base}, 45%, ${l}%)`;
      g.fillRect(c * bw + off + 2, r * bh + 2, bw - 4, bh - 4);
    }
  }
  if (cracks) {
    g.strokeStyle = '#2a1a10';
    g.lineWidth = 4;
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      let x = s * (0.2 + 0.3 * k), y = 0;
      g.moveTo(x, y);
      while (y < s) { x += (Math.random() - 0.5) * 40; y += 20 + Math.random() * 20; g.lineTo(x, y); }
      g.stroke();
    }
  }
}
const wallTex = canvasTex((g, s) => drawBricks(g, s, 18, false));
const fakeTex = canvasTex((g, s) => drawBricks(g, s, 22, true));
const floorTex = canvasTex((g, s) => {
  g.fillStyle = '#6f7a6a';
  g.fillRect(0, 0, s, s);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    g.fillStyle = `hsl(100, 8%, ${44 + Math.random() * 10}%)`;
    g.fillRect(x * s / 4 + 3, y * s / 4 + 3, s / 4 - 6, s / 4 - 6);
  }
});
floorTex.repeat.set(W, W);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * T, W * T), new THREE.MeshLambertMaterial({ map: floorTex }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const outside = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0x6cbf4a }));
outside.rotation.x = -Math.PI / 2;
outside.position.y = -0.01;
scene.add(outside);

const wallGeo = new THREE.BoxGeometry(T, H, T);
function buildWalls(type, tex) {
  const tiles = [];
  for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) if (grid[z][x] === type) tiles.push({ x, z });
  const mesh = new THREE.InstancedMesh(wallGeo, new THREE.MeshLambertMaterial({ map: tex }), tiles.length);
  const m = new THREE.Matrix4();
  tiles.forEach((t, i) => mesh.setMatrixAt(i, m.makeTranslation(tileCenter(t, H / 2))));
  scene.add(mesh);
}
buildWalls(WALL, wallTex);
buildWalls(FAKE, fakeTex);

// トゲの わな
const spikeGeo = new THREE.ConeGeometry(0.13, 0.6, 6);
const spikeMat = new THREE.MeshLambertMaterial({ color: 0xcfd6dd });
const plateMat = new THREE.MeshLambertMaterial({ color: 0x3a3a44 });
const traps = trapDefs.map(d => {
  const g = new THREE.Group();
  g.position.copy(tileCenter(d));
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(T * 0.95, T * 0.95), plateMat);
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = 0.01;
  const spikes = new THREE.Group();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const s = new THREE.Mesh(spikeGeo, spikeMat);
    s.position.set((i - 1) * T / 3, 0.3, (j - 1) * T / 3);
    spikes.add(s);
  }
  spikes.position.y = -0.6;
  g.add(plate, spikes);
  scene.add(g);
  return { ...d, spikes, up: false };
});

// トゲボール
const ballMat = new THREE.MeshLambertMaterial({ color: 0x8b1e1e });
const ballSpikeGeo = new THREE.ConeGeometry(0.09, 0.35, 6);
const BALL_R = 0.45;
const balls = ballRuns.map((run, i) => {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 16, 12), ballMat));
  const dirs = [];
  for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) for (const c of [-1, 0, 1]) {
    if (a || b || c) dirs.push(new THREE.Vector3(a, b, c).normalize());
  }
  for (const v of dirs) {
    const s = new THREE.Mesh(ballSpikeGeo, spikeMat);
    s.position.copy(v).multiplyScalar(BALL_R + 0.1);
    s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
    g.add(s);
  }
  scene.add(g);
  const a = tileCenter(run[0], BALL_R + 0.05);
  const b = tileCenter(run[run.length - 1], BALL_R + 0.05);
  return { g, a, b, len: a.distanceTo(b), phase: i * 0.7, horizontal: run[0].z === run[1].z };
});

// チェックポイントの はた
const flagShape = new THREE.Shape();
flagShape.moveTo(0, 0);
flagShape.lineTo(0.8, -0.25);
flagShape.lineTo(0, -0.5);
const flagGeo = new THREE.ShapeGeometry(flagShape);
const checkpoints = checkpointTiles.map(t => {
  const g = new THREE.Group();
  g.position.copy(tileCenter(t));
  g.position.x += T * 0.3;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 8), new THREE.MeshLambertMaterial({ color: 0xeeeeee }));
  pole.position.y = 1.1;
  const mat = new THREE.MeshBasicMaterial({ color: 0xff4040, side: THREE.DoubleSide });
  const flag = new THREE.Mesh(flagGeo, mat);
  flag.position.y = 2.15;
  g.add(pole, flag);
  scene.add(g);
  return { t, mat, reached: false };
});

// ほし
const starGeo = new THREE.OctahedronGeometry(0.3);
const starMat = new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0x8a6a00 });
const stars = starTiles.map(t => {
  const m = new THREE.Mesh(starGeo, starMat);
  m.position.copy(tileCenter(t, 1.2));
  scene.add(m);
  return { t, m, got: false };
});

// ゴール（たからばこ）
const goal = new THREE.Group();
goal.position.copy(tileCenter(GOAL_T));
const chest = new THREE.Mesh(new THREE.BoxGeometry(1, 0.6, 0.7), new THREE.MeshLambertMaterial({ color: 0x8b5a2b }));
chest.position.y = 0.3;
const lid = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.22, 0.74), new THREE.MeshLambertMaterial({ color: 0xffc83d, emissive: 0x664400 }));
lid.position.y = 0.7;
const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 12, 16),
  new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.45, fog: false }));
glow.position.y = 6;
goal.add(chest, lid, glow);
scene.add(goal);

// あかい フラッシュ（いたい！）
const flashMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
const flash = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), flashMat);
flash.position.z = -0.3;
flash.renderOrder = 999;
camera.add(flash);

const ctrlFactory = new XRControllerModelFactory();
for (let i = 0; i < 2; i++) {
  const grip = renderer.xr.getControllerGrip(i);
  grip.add(ctrlFactory.createControllerModel(grip));
  player.add(grip);
}

// ============ HUD ============
const hudCanvas = document.createElement('canvas');
hudCanvas.width = 1024;
hudCanvas.height = 512;
const hctx = hudCanvas.getContext('2d');
const hudTex = new THREE.CanvasTexture(hudCanvas);
hudTex.colorSpace = THREE.SRGBColorSpace;
const hud = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 0.5),
  new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthTest: false, depthWrite: false, fog: false })
);
hud.position.set(0, 0, -1);
hud.renderOrder = 1000;
camera.add(hud);

function panel(x, y, w, h) {
  hctx.fillStyle = 'rgba(0,0,0,0.55)';
  hctx.beginPath();
  if (hctx.roundRect) hctx.roundRect(x, y, w, h, 18);
  else hctx.rect(x, y, w, h);
  hctx.fill();
}
let hudKey = '';
function drawHUD(info) {
  const k = JSON.stringify(info);
  if (k === hudKey) return;
  hudKey = k;
  hctx.clearRect(0, 0, 1024, 512);
  hctx.textAlign = 'center';
  hctx.textBaseline = 'middle';
  panel(232, 8, 560, 92);
  hctx.fillStyle = '#fff';
  hctx.font = 'bold 34px sans-serif';
  hctx.fillText(info.top, 512, 40);
  hctx.fillStyle = '#ffe9a0';
  hctx.font = '22px sans-serif';
  hctx.fillText(info.hint, 512, 78);

  if (info.map) drawMap(info.map);
  if (info.big) {
    panel(112, 170, 800, 230);
    hctx.fillStyle = info.bigColor;
    hctx.font = 'bold 80px sans-serif';
    hctx.fillText(info.big, 512, 240);
    hctx.fillStyle = '#fff';
    hctx.font = '30px sans-serif';
    (info.small || []).forEach((s, i) => hctx.fillText(s, 512, 310 + i * 40));
  }
  hudTex.needsUpdate = true;
}

// ちず（とおった ところだけ みえる）
const seen = grid.map(r => r.map(() => false));
function drawMap(m) {
  const size = 380, x0 = 512 - size / 2, y0 = 112, c = size / W;
  panel(x0 - 10, y0 - 10, size + 20, size + 20);
  for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) {
    if (!seen[z][x]) continue;
    hctx.fillStyle = grid[z][x] === OPEN ? '#d9d2b8' : '#7a4a2a';
    hctx.fillRect(x0 + x * c, y0 + z * c, c + 0.5, c + 0.5);
  }
  const dot = (t, color, r) => {
    hctx.fillStyle = color;
    hctx.beginPath();
    hctx.arc(x0 + (t.x + 0.5) * c, y0 + (t.z + 0.5) * c, r, 0, Math.PI * 2);
    hctx.fill();
  };
  for (const s of stars) if (!s.got && seen[s.t.z][s.t.x]) dot(s.t, '#ffc400', c * 0.35);
  for (const cp of checkpoints) if (seen[cp.t.z][cp.t.x]) dot(cp.t, cp.reached ? '#40d040' : '#ff4040', c * 0.3);
  for (const tr of traps) if (seen[tr.z][tr.x]) dot(tr, '#555', c * 0.3);
  dot(GOAL_T, '#ffe066', c * 0.45);
  // じぶん（やじるし）
  const px = x0 + m.px * c, pz = y0 + m.pz * c;
  hctx.save();
  hctx.translate(px, pz);
  hctx.rotate(-m.yaw);
  hctx.fillStyle = '#ff2a2a';
  hctx.beginPath();
  hctx.moveTo(0, -c * 0.7);
  hctx.lineTo(c * 0.45, c * 0.45);
  hctx.lineTo(-c * 0.45, c * 0.45);
  hctx.closePath();
  hctx.fill();
  hctx.restore();
}

// ============ そうさ ============
const keys = {};
const keyNames = {};
const keyIs = (e, setting) => [].concat(setting).includes((e.key || '').toLowerCase());
let pitch = 0;
let started = false;
let mapOn = false;
let againPressed = false;
const overlay = document.getElementById('overlay');

addEventListener('keydown', e => {
  keys[e.code] = true;
  keyNames[(e.key || '').toLowerCase()] = true;
  if (e.repeat) return;
  if (keyIs(e, S.keyAgain) || e.code === 'KeyM' || e.code === 'Enter') againPressed = true;
  if (keyIs(e, S.keyRecenter) || e.code === 'KeyR') alignToCorridor();
  if (started && gameState === 'play') {
    if (keyIs(e, S.keyTurnRight) || e.code === 'KeyE') snapTurn(-1);
    if (keyIs(e, S.keyTurnLeft) || e.code === 'KeyQ') snapTurn(1);
  }
});
addEventListener('keyup', e => {
  keys[e.code] = false;
  keyNames[(e.key || '').toLowerCase()] = false;
});
overlay.addEventListener('click', e => {
  if (e.target.closest('#phone, a')) return;
  overlay.classList.add('hidden');
  started = true;
  startAudio();
  renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
});
renderer.domElement.addEventListener('click', () => {
  if (!renderer.xr.isPresenting && !phoneMode) renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && !renderer.xr.isPresenting && !phoneMode) {
    started = false;
    overlay.querySelector('#play').textContent = 'クリックして つづける';
    overlay.classList.remove('hidden');
  }
});
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== renderer.domElement) return;
  player.rotation.y -= e.movementX * 0.0025;
  pitch = clamp(pitch - e.movementY * 0.0025, -1.4, 1.4);
});
renderer.xr.addEventListener('sessionstart', () => {
  overlay.classList.add('hidden');
  started = true;
  startAudio();
});

const head = new THREE.Vector3();
const before = new THREE.Vector3();
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const move = new THREE.Vector3();

function snapTurn(dir) {
  camera.getWorldPosition(before);
  player.rotation.y += dir * M.turnAngle * DEG;
  camera.getWorldPosition(head);
  player.position.x += before.x - head.x;
  player.position.z += before.z - head.z;
}
function viewYaw() {
  camera.getWorldDirection(fwd);
  return Math.atan2(-fwd.x, -fwd.z);
}
// いま みている むきを、いちばん ちかい ろうかの むきに あわせる
function alignToCorridor() {
  const y = viewYaw();
  const target = Math.round(y / (Math.PI / 2)) * (Math.PI / 2);
  camera.getWorldPosition(before);
  player.rotation.y += target - y;
  camera.getWorldPosition(head);
  player.position.x += before.x - head.x;
  player.position.z += before.z - head.z;
}

// ---- スマホVRモード ----
let phoneMode = false;
let gyro = null;
const stereo = new StereoEffect(renderer);
const gyroQ = new THREE.Quaternion();
const gyroEuler = new THREE.Euler();
const q90 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const qTmp = new THREE.Quaternion();
const zAxis = new THREE.Vector3(0, 0, 1);
function screenAngle() {
  return (screen.orientation && screen.orientation.angle) || window.orientation || 0;
}
function updateGyroQ() {
  if (!gyro) return false;
  gyroEuler.set(gyro.beta * DEG, gyro.alpha * DEG, -gyro.gamma * DEG, 'YXZ');
  gyroQ.setFromEuler(gyroEuler);
  gyroQ.multiply(q90);
  gyroQ.multiply(qTmp.setFromAxisAngle(zAxis, -screenAngle() * DEG));
  return true;
}
// スマホの いまの むきを、スタートの むきに あわせる
function faceStart() {
  if (phoneMode && updateGyroQ()) {
    const e = new THREE.Euler().setFromQuaternion(gyroQ, 'YXZ');
    player.rotation.y = startYaw - e.y;
  } else {
    player.rotation.y = startYaw;
  }
}
addEventListener('deviceorientation', e => {
  if (e.alpha == null) return;
  const first = !gyro;
  gyro = { alpha: e.alpha, beta: e.beta, gamma: e.gamma };
  if (first && phoneMode) faceStart();
});
function fitSize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  const w = phoneMode ? window.innerWidth / 2 : window.innerWidth;
  camera.aspect = w / window.innerHeight;
  camera.updateProjectionMatrix();
  if (phoneMode) stereo.setSize(window.innerWidth, window.innerHeight);
}
addEventListener('resize', fitSize);
document.getElementById('phone').addEventListener('click', async () => {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      await DeviceOrientationEvent.requestPermission();
    }
  } catch (err) { /* むしする */ }
  document.documentElement.requestFullscreen?.()?.catch?.(() => {});
  screen.orientation?.lock?.('landscape')?.catch?.(() => {});
  navigator.wakeLock?.request?.('screen')?.catch?.(() => {});
  phoneMode = true;
  hud.scale.setScalar(0.7);
  document.getElementById('VRButton')?.remove();
  fitSize();
  overlay.classList.add('hidden');
  started = true;
  startAudio();
  faceStart();
});

// ---- ゲームパッド ----
let padPrev = [];
function readPad() {
  const out = { mx: 0, mz: 0, turn: 0, run: false, again: false };
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp) continue;
    const pressed = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const down = i => pressed(i) && !padPrev[i];
    out.mx = gp.axes[0] || 0;
    out.mz = gp.axes[1] || 0;
    if (gp.axes.length >= 4) out.turn = gp.axes[2] || 0;
    if (pressed(12)) out.mz = -1;
    if (pressed(13)) out.mz = 1;
    if (pressed(14)) out.mx = -1;
    if (pressed(15)) out.mx = 1;
    out.run = pressed(S.padRunButton);
    out.again = down(S.padActionButton) || down(S.padCrouchButton);
    if (down(S.padRecenterButton)) alignToCorridor();
    padPrev = gp.buttons.map(b => b.pressed);
    break;
  }
  return out;
}
function readXRInput() {
  const out = { mx: 0, mz: 0, turn: 0, run: false, again: false };
  const session = renderer.xr.getSession();
  if (!session) return out;
  for (const src of session.inputSources) {
    const gp = src.gamepad;
    if (!gp) continue;
    const ax = gp.axes.length >= 4 ? [gp.axes[2], gp.axes[3]] : [gp.axes[0] || 0, gp.axes[1] || 0];
    const pressed = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
    if (src.handedness === 'left') {
      out.mx = ax[0];
      out.mz = ax[1];
      out.run = pressed(0) || pressed(3);
    } else if (src.handedness === 'right') {
      out.turn = ax[0];
      out.againHeld = pressed(0) || pressed(4);
    }
  }
  return out;
}

// ============ ゲームの すすみかた ============
const startTile = path[0];
const firstStep = path[1] || path[0];
const startYaw = Math.atan2(-(firstStep.x - startTile.x), -(firstStep.z - startTile.z));
const PR = 0.3; // じぶんの からだの ふとさ

let gameState = 'play';
let t = 0, elapsed = 0, endTime = 0, hits = 0, invulnUntil = 0;
let respawn = startTile;
let msg = null; // {text, color, until}
let snapped = false;
let xrAgainPrev = false;

function solidAt(x, z) {
  const tt = tileOf(x, z);
  return !isOpen(tt.x, tt.z);
}
function blocked(x, z) {
  return solidAt(x - PR, z - PR) || solidAt(x + PR, z - PR) || solidAt(x - PR, z + PR) || solidAt(x + PR, z + PR);
}
function teleportTo(tile) {
  const c = tileCenter(tile);
  camera.getWorldPosition(head);
  player.position.x += c.x - head.x;
  player.position.z += c.z - head.z;
}
function showMsg(text, color, sec) { msg = { text, color, until: t + sec }; }

function hurt() {
  if (t < invulnUntil || gameState !== 'play') return;
  hits++;
  invulnUntil = t + 1.5;
  flashMat.opacity = 0.6;
  beep([300, 200], 0.15, 'sawtooth', 0.12);
  showMsg('いたい！', '#ff5050', 1.3);
  teleportTo(respawn);
  // みちの さきの ほうを むく
  const i = path.findIndex(p => p.x === respawn.x && p.z === respawn.z);
  const next = path[i + 1];
  if (next) {
    const target = Math.atan2(-(next.x - respawn.x), -(next.z - respawn.z));
    camera.getWorldPosition(before);
    player.rotation.y += target - viewYaw();
    camera.getWorldPosition(head);
    player.position.x += before.x - head.x;
    player.position.z += before.z - head.z;
  }
}

function restart() {
  player.position.set(0, 0, 0);
  faceStart();
  teleportTo(startTile);
  respawn = startTile;
  for (const s of stars) { s.got = false; s.m.visible = true; }
  for (const cp of checkpoints) { cp.reached = false; cp.mat.color.setHex(0xff4040); }
  for (const row of seen) row.fill(false);
  gameState = 'play';
  elapsed = 0;
  hits = 0;
  mapOn = false;
  msg = null;
  invulnUntil = 0;
}
restart();

function update(dt) {
  t += dt;
  const presenting = renderer.xr.isPresenting;

  // --- にゅうりょく ---
  let mx = 0, mz = 0, run = false, turn = 0, again = againPressed;
  againPressed = false;
  if (presenting) {
    const xi = readXRInput();
    ({ mx, mz, run, turn } = xi);
    if (xi.againHeld && !xrAgainPrev) again = true;
    xrAgainPrev = !!xi.againHeld;
  } else {
    const p = readPad();
    mx = p.mx;
    mz = p.mz;
    turn = p.turn;
    run = p.run;
    if (p.again) again = true;
    if (keys.KeyW || keys.ArrowUp) mz -= 1;
    if (keys.KeyS || keys.ArrowDown) mz += 1;
    if (keys.KeyA || keys.ArrowLeft) mx -= 1;
    if (keys.KeyD || keys.ArrowRight) mx += 1;
    run = run || keys.ShiftLeft || keys.ShiftRight || keyNames[S.keyRun];
    camera.position.y = M.eyeHeight;
    if (phoneMode && updateGyroQ()) camera.quaternion.copy(gyroQ);
    else camera.rotation.set(pitch, 0, 0);
  }

  flashMat.opacity = Math.max(0, flashMat.opacity - dt * 1.2);

  if (gameState !== 'play') {
    if (again && t - endTime > 1) restart();
    drawStatus();
    return;
  }
  if (again) mapOn = !mapOn;
  elapsed += dt;

  // --- まがる（スティック） ---
  if (Math.abs(turn) > 0.7 && !snapped) { snapped = true; snapTurn(-Math.sign(turn)); }
  else if (Math.abs(turn) < 0.3) snapped = false;

  // --- あるく（かべに ぶつかる） ---
  if (Math.abs(mx) < 0.15) mx = 0;
  if (Math.abs(mz) < 0.15) mz = 0;
  camera.getWorldPosition(head);
  if (mx || mz) {
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    right.set(-fwd.z, 0, fwd.x);
    move.set(0, 0, 0).addScaledVector(fwd, -mz).addScaledVector(right, mx);
    if (move.length() > 1) move.normalize();
    const speed = run ? S.runSpeed : S.walkSpeed;
    let dx = move.x * speed * dt, dz = move.z * speed * dt;
    if (blocked(head.x + dx, head.z)) dx = 0;
    if (blocked(head.x + dx, head.z + dz)) dz = 0;
    player.position.x += dx;
    player.position.z += dz;
    camera.getWorldPosition(head);
  }
  const pt = tileOf(head.x, head.z);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if (seen[pt.z + dz] && seen[pt.z + dz][pt.x + dx] !== undefined) seen[pt.z + dz][pt.x + dx] = true;
  }

  // --- トゲの わな ---
  for (const tr of traps) {
    const c = (t * M.spikeSpeed / 3 + tr.phase) % 1;
    const up = c < 0.4;
    let y = up ? 0 : -0.6;
    let shake = 0;
    if (!up && c > 0.82) { y = -0.45; shake = Math.sin(t * 90) * 0.03; } // もうすぐ でるよ！
    tr.spikes.position.y += (y - tr.spikes.position.y) * (1 - Math.exp(-25 * dt));
    tr.spikes.position.x = shake;
    if (up && !tr.up) {
      const d = Math.hypot(head.x - tr.spikes.parent.position.x, head.z - tr.spikes.parent.position.z);
      if (d < 8) beep([1400, 2000], 0.04, 'square', 0.05);
    }
    tr.up = up;
    if (tr.spikes.position.y > -0.25 && pt.x === tr.x && pt.z === tr.z) hurt();
  }

  // --- トゲボール ---
  for (const b of balls) {
    let u = (t * M.ballSpeed / b.len + b.phase) % 2;
    if (u > 1) u = 2 - u;
    b.g.position.lerpVectors(b.a, b.b, u);
    if (b.horizontal) b.g.rotation.z = -b.g.position.x / BALL_R;
    else b.g.rotation.x = b.g.position.z / BALL_R;
    if (Math.hypot(head.x - b.g.position.x, head.z - b.g.position.z) < BALL_R + PR + 0.1) hurt();
  }

  // --- ほし ---
  for (const s of stars) {
    if (s.got) continue;
    s.m.rotation.y += dt * 2;
    s.m.position.y = 1.2 + Math.sin(t * 3) * 0.1;
    if (Math.hypot(head.x - s.m.position.x, head.z - s.m.position.z) < 0.8) {
      s.got = true;
      s.m.visible = false;
      beep([988, 1319], 0.1, 'triangle', 0.15);
      showMsg('ほし ゲット！', '#ffd23f', 1.2);
    }
  }

  // --- チェックポイント ---
  for (const cp of checkpoints) {
    if (!cp.reached && pt.x === cp.t.x && pt.z === cp.t.z) {
      cp.reached = true;
      cp.mat.color.setHex(0x40d040);
      respawn = cp.t;
      beep([660, 880], 0.1, 'triangle', 0.12);
      showMsg('チェックポイント！', '#60ff60', 1.5);
    }
  }

  // --- ゴール ---
  lid.rotation.x = 0;
  if (pt.x === GOAL_T.x && pt.z === GOAL_T.z) {
    gameState = 'clear';
    endTime = t;
    lid.rotation.x = -0.6;
    beep([523, 659, 784, 1047], 0.15, 'triangle', 0.15);
  }
  drawStatus();
}

function drawStatus() {
  const got = stars.filter(s => s.got).length;
  const info = {
    top: `★ ${got}/${stars.length}　いたい ${hits}かい　${Math.floor(elapsed)}びょう`,
    hint: 'X か OK：ちず　みぎ・ひだりの ボタン：まがる',
  };
  if (mapOn && gameState === 'play') {
    const yaw = viewYaw();
    info.map = {
      px: Math.round((head.x / T + W / 2) * 4) / 4,
      pz: Math.round((head.z / T + W / 2) * 4) / 4,
      yaw: Math.round(yaw / (Math.PI / 8)) * (Math.PI / 8),
      n: seen.reduce((a, r) => a + r.filter(Boolean).length, 0),
      got,
    };
  }
  if (gameState === 'clear') {
    const perfect = hits === 0 && got === stars.length ? '　パーフェクト！' : '';
    info.big = 'ゴール！';
    info.bigColor = '#ffe066';
    info.small = [
      `タイム ${Math.round(elapsed)}びょう　★ ${got}/${stars.length}　いたい ${hits}かい${perfect}`,
      'X か OK で もういちど',
    ];
  } else if (msg && t < msg.until) {
    info.big = msg.text;
    info.bigColor = msg.color;
  }
  drawHUD(info);
}

// ============ まいフレーム ============
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (started) update(dt);
  if (phoneMode && !renderer.xr.isPresenting) stereo.render(scene, camera);
  else renderer.render(scene, camera);
});

// デバッグよう
window.__maze = {
  grid, path, traps, balls, stars, checkpoints, player, camera, deadEnds,
  get state() { return gameState; }, get hits() { return hits; },
  goTo: tile => teleportTo(tile),
};
