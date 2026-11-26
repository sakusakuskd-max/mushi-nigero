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
const FOG_COLOR = 0xb4bcc8;
scene.background = new THREE.Color(FOG_COLOR);
scene.fog = new THREE.FogExp2(FOG_COLOR, M.fog); // ふかい きり：とおくは みえない
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
  // くねくね ながい みち ＋ たくさんの わかれみち
  // （はんぶんは さいごに つくった ところから のばし、はんぶんは ランダムな ところから えだわかれ）
  const inMaze = new Set();
  const active = [[0, N - 1]];
  inMaze.add(`0,${N - 1}`);
  grid[2 * (N - 1) + 1][1] = OPEN;
  while (active.length) {
    const ai = rand() < M.winding ? active.length - 1 : Math.floor(rand() * active.length);
    const [cx, cz] = active[ai];
    const nbs = shuffle(DIRS.slice()).filter(([dx, dz]) => {
      const nx = cx + dx, nz = cz + dz;
      return nx >= 0 && nz >= 0 && nx < N && nz < N && !inMaze.has(`${nx},${nz}`);
    });
    if (!nbs.length) { active.splice(ai, 1); continue; }
    const [dx, dz] = nbs[0];
    const nx = cx + dx, nz = cz + dz;
    grid[2 * cz + 1 + dz][2 * cx + 1 + dx] = OPEN; // あいだの かべを こわす
    grid[2 * nz + 1][2 * nx + 1] = OPEN;
    inMaze.add(`${nx},${nz}`);
    active.push([nx, nz]);
  }
  // ぐるっと まわれる みち（かべを すこし こわす）
  for (let z = 1; z < W - 1; z++) {
    for (let x = 1; x < W - 1; x++) {
      if (grid[z][x] === WALL && (x % 2) !== (z % 2) && rand() < M.branches) grid[z][x] = OPEN;
    }
  }
}
const START_T = { x: 1, z: W - 2 };
const GOAL_T = { x: W - 2, z: 1 };
const key = t => `${t.x},${t.z}`;
const tileCenter = (t, y = 0) => new THREE.Vector3((t.x - W / 2 + 0.5) * T, y, (t.z - W / 2 + 0.5) * T);
const tileOf = (x, z) => ({ x: Math.floor(x / T + W / 2), z: Math.floor(z / T + W / 2) });
const isOpen = (x, z) => grid[z] && grid[z][x] !== undefined && grid[z][x] !== WALL;

// スタートからの きょりと、ゴールまでの みちを しらべる
function measure() {
  const dist = grid.map(r => r.map(() => -1));
  const prev = new Map();
  const q = [[START_T.x, START_T.z]];
  dist[START_T.z][START_T.x] = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const [x, z] = q[qi];
    for (const [dx, dz] of DIRS) {
      const nx = x + dx, nz = z + dz;
      if (!grid[nz] || grid[nz][nx] !== OPEN || dist[nz][nx] >= 0) continue;
      dist[nz][nx] = dist[z][x] + 1;
      prev.set(`${nx},${nz}`, [x, z]);
      q.push([nx, nz]);
    }
  }
  const path = [];
  for (let cur = [GOAL_T.x, GOAL_T.z]; cur; cur = prev.get(`${cur[0]},${cur[1]}`)) path.unshift({ x: cur[0], z: cur[1] });
  return { dist, path };
}

// おおきな ひろば：ゴールまでの みちの とちゅうに ひろい へやを つくって、
// まわりの かべを ぜんぶ あける → 1つの ひろばから 8ほんの みちが わかれる
const inHub = new Set();
const hubExits = []; // { x, z, dx, dz }（そとむき）
{
  const pre = measure().path;
  let len = pre.length;
  const hubCells = [];
  for (let k = 1; k <= M.hubs; k++) {
    const mid = Math.floor(pre.length * k / (M.hubs + 1));
    // ちかみちに ならない ばしょを さがす
    for (const off of [0, 3, -3, 6, -6, 9, -9, 12, -12, 15, -15, 18, -18]) {
      const t = pre[mid + off];
      if (!t) continue;
      const cx = clamp(Math.floor((t.x - 1) / 2), 1, N - 3);
      const cz = clamp(Math.floor((t.z - 1) / 2), 1, N - 3);
      if (hubCells.some(h => Math.abs(h.cx - cx) < 4 && Math.abs(h.cz - cz) < 4)) continue;
      const x0 = 2 * cx + 1, z0 = 2 * cz + 1;
      const saved = [];
      for (let z = z0; z <= z0 + 2; z++) for (let x = x0; x <= x0 + 2; x++) { saved.push(grid[z][x]); grid[z][x] = OPEN; }
      const l = measure().path.length;
      if (l < len - 2) {
        let n = 0;
        for (let z = z0; z <= z0 + 2; z++) for (let x = x0; x <= x0 + 2; x++) grid[z][x] = saved[n++];
        continue;
      }
      len = l;
      hubCells.push({ cx, cz });
      break;
    }
  }
  for (const { cx, cz } of hubCells) {
    const x0 = 2 * cx + 1, z0 = 2 * cz + 1;
    for (let z = z0; z <= z0 + 2; z++) for (let x = x0; x <= x0 + 2; x++) inHub.add(`${x},${z}`);
    for (const o of [0, 2]) {
      hubExits.push({ x: x0 - 1, z: z0 + o, dx: -1, dz: 0 });
      hubExits.push({ x: x0 + 3, z: z0 + o, dx: 1, dz: 0 });
      hubExits.push({ x: x0 + o, z: z0 - 1, dx: 0, dz: -1 });
      hubExits.push({ x: x0 + o, z: z0 + 3, dx: 0, dz: 1 });
    }
  }
  // でぐちを あける。でも ゴールへの ちかみちに なる でぐちは あけない（むずかしさを たもつ）
  for (const e of shuffle(hubExits.splice(0))) {
    if (grid[e.z][e.x] === OPEN) { hubExits.push(e); continue; }
    grid[e.z][e.x] = OPEN;
    const l = measure().path.length;
    if (l < len - 2) { grid[e.z][e.x] = WALL; continue; }
    len = l;
    hubExits.push(e);
  }
}
const { dist, path } = measure();
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
      if (Math.abs(dist[a[1]][a[0]] - dist[b[1]][b[0]]) < 10) continue;
      cands.push({ x, z });
    }
  }
  shuffle(cands).slice(0, M.secretPaths).forEach(t => { grid[t.z][t.x] = FAKE; });
}

// ばしょ きめ：チェックポイント・ほし
const used = new Set([key(path[0]), key(path[1] || path[0]), key(path[L - 1])]);
const checkpointTiles = [];
for (let i = 1; i <= M.checkpoints; i++) checkpointTiles.push(path[Math.floor((L * i) / (M.checkpoints + 1))]);
checkpointTiles.forEach(t => used.add(key(t)));
// ほし（いきどまりに かくす）
const starTiles = shuffle(deadEnds.slice()).slice(0, M.stars);
starTiles.forEach(t => used.add(key(t)));

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
  const bad = t => used.has(key(t)) || inHub.has(key(t));
  const ok = runs.filter(r => !r.some(bad));
  ok.sort((a, b) => (b.some(t => onPath.has(key(t))) - a.some(t => onPath.has(key(t)))) || b.length - a.length);
  const taken = new Set();
  for (const r of ok) {
    if (ballRuns.length >= M.spikeBalls) break;
    if (r.some(t => taken.has(key(t)))) continue;
    r.forEach(t => taken.add(key(t)));
    ballRuns.push(r);
  }
  // トゲボールを よける「くぼみ」を ろうかの よこに つくる
  for (const r of ballRuns) {
    const horizontal = r[0].z === r[1].z;
    const spots = r.length >= 7 ? [Math.floor(r.length / 3), Math.floor((2 * r.length) / 3)] : [Math.floor(r.length / 2)];
    for (const si of spots) {
      const t = r[si];
      const sides = horizontal ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
      for (const [dx, dz] of shuffle(sides)) {
        const nx = t.x + dx, nz = t.z + dz;
        if (nx < 1 || nz < 1 || nx > W - 2 || nz > W - 2) continue;
        if (grid[nz][nx] === OPEN) break; // もう よけられる ばしょが ある
        if (grid[nz][nx] === WALL) { grid[nz][nx] = OPEN; break; }
      }
    }
  }
}

// とびら（わかれみちの いりぐちに おく。なかみは あけるまで わからない）
const ballTiles = new Set(ballRuns.flat().map(key));
const doorDefs = [];
const doorKeys = new Set();
function tryDoor(x, z, dx, dz) {
  const k = `${x},${z}`;
  if ((x % 2) === (z % 2)) return;
  if (doorKeys.has(k) || used.has(k) || ballTiles.has(k) || inHub.has(k)) return;
  if (grid[z]?.[x] !== OPEN) return;
  const a = { x: x + dx, z: z + dz }, b = { x: x - dx, z: z - dz };
  if (grid[a.z]?.[a.x] !== OPEN || grid[b.z]?.[b.x] !== OPEN) return;
  if (grid[z + dx]?.[x + dz] !== WALL || grid[z - dx]?.[x - dz] !== WALL) return;
  for (const n of [a, b]) if ([START_T, GOAL_T, ...checkpointTiles].some(t => t.x === n.x && t.z === n.z)) return;
  doorKeys.add(k);
  doorDefs.push({ x, z, dx, dz });
}
for (const h of hubExits) {
  const out = dist[h.z + h.dz]?.[h.x + h.dx];
  if (onPath.has(key(h)) && out >= 0 && out < dist[h.z][h.x]) continue; // はいってきた みちには おかない
  if (rand() < M.hubDoorChance) tryDoor(h.x, h.z, h.dx, h.dz);
}
for (let z = 1; z < W; z += 2) for (let x = 1; x < W; x += 2) {
  if (grid[z][x] !== OPEN || inHub.has(`${x},${z}`)) continue;
  const nb = DIRS.filter(([dx, dz]) => grid[z + dz][x + dx] === OPEN);
  if (nb.length < 3) continue;
  let back = null, best = Infinity;
  for (const [dx, dz] of nb) {
    const d = dist[z + dz][x + dx];
    if (d >= 0 && d < best) { best = d; back = [dx, dz]; }
  }
  for (const [dx, dz] of nb) {
    if (back && dx === back[0] && dz === back[1]) continue;
    if (rand() < M.doorChance) tryDoor(x + dx, z + dz, dx, dz);
  }
}

// ============ みため ============
function canvasTex(draw, w = 256, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
// しろい だいりせき（おおきな いしの いた）
function drawStone(g, s, cracks) {
  g.fillStyle = '#f1f0ec';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * s, y = Math.random() * s, r = 20 + Math.random() * 60;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(190,195,205,0.18)');
    gr.addColorStop(1, 'rgba(190,195,205,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  }
  g.strokeStyle = 'rgba(150,158,170,0.18)';
  g.lineWidth = 1;
  for (let k = 0; k < 4; k++) {
    g.beginPath();
    let x = Math.random() * s, y = 0;
    g.moveTo(x, y);
    while (y < s) { x += (Math.random() - 0.5) * 50; y += 10 + Math.random() * 25; g.lineTo(x, y); }
    g.stroke();
  }
  g.strokeStyle = 'rgba(170,170,178,0.7)';
  g.lineWidth = 2;
  g.strokeRect(1.5, 1.5, s - 3, s / 2 - 3);
  g.strokeRect(1.5, s / 2 + 1.5, s - 3, s / 2 - 3);
  if (cracks) {
    g.strokeStyle = '#1a1a20';
    g.lineWidth = 6;
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      let x = s * (0.2 + 0.3 * k), y = 0;
      g.moveTo(x, y);
      while (y < s) { x += (Math.random() - 0.5) * 40; y += 20 + Math.random() * 20; g.lineTo(x, y); }
      g.stroke();
    }
  }
}
const wallTex = canvasTex(g => drawStone(g, 256, false));
const fakeTex = canvasTex(g => drawStone(g, 256, true));
const doorTex = canvasTex((g, w, h) => {
  g.fillStyle = '#8a5a2b';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = `hsl(28, 45%, ${30 + Math.random() * 8}%)`;
    g.fillRect(i * w / 4 + 2, 0, w / 4 - 4, h);
  }
  g.fillStyle = '#3b3b3b';
  for (const y of [70, h - 100]) {
    g.fillRect(0, y, w, 26);
    g.fillStyle = '#9a9a9a';
    for (let x = 16; x < w; x += 56) { g.beginPath(); g.arc(x, y + 13, 5, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#3b3b3b';
  }
  g.font = 'bold 200px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = '#1a1a1a';
  g.strokeText('?', w / 2, h / 2);
  g.fillStyle = '#ffd23f';
  g.fillText('?', w / 2, h / 2);
}, 256, 512);
const fogTex = canvasTex((g, s) => {
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * s, y = Math.random() * s, r = 30 + Math.random() * 70;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  }
});
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

const wallMat = new THREE.MeshLambertMaterial({ map: wallTex });
const wallGeo = new THREE.BoxGeometry(T, H, T);
function buildWalls(type, tex) {
  const tiles = [];
  for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) if (grid[z][x] === type) tiles.push({ x, z });
  const mesh = new THREE.InstancedMesh(wallGeo, tex === wallTex ? wallMat : new THREE.MeshLambertMaterial({ map: tex }), tiles.length);
  const m = new THREE.Matrix4();
  tiles.forEach((t, i) => mesh.setMatrixAt(i, m.makeTranslation(tileCenter(t, H / 2))));
  scene.add(mesh);
}
buildWalls(WALL, wallTex);
buildWalls(FAKE, fakeTex);

const spikeMat = new THREE.MeshLambertMaterial({ color: 0xcfd6dd });

// トゲボール
const ballMat = new THREE.MeshLambertMaterial({ color: 0x8b1e1e });
const ballSpikeGeo = new THREE.ConeGeometry(0.09, 0.35, 6);
const BALL_R = Math.min(0.45, T * 0.33);
function makeSpikeBall() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 16, 12), ballMat));
  for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) for (const c of [-1, 0, 1]) {
    if (!(a || b || c)) continue;
    const v = new THREE.Vector3(a, b, c).normalize();
    const sp = new THREE.Mesh(ballSpikeGeo, spikeMat);
    sp.position.copy(v).multiplyScalar(BALL_R + 0.1);
    sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
    g.add(sp);
  }
  scene.add(g);
  return g;
}
const balls = ballRuns.map((run, i) => {
  const g = makeSpikeBall();
  const a = tileCenter(run[0], BALL_R + 0.05);
  const b = tileCenter(run[run.length - 1], BALL_R + 0.05);
  return { g, a, b, len: a.distanceTo(b), phase: i * 0.7, horizontal: run[0].z === run[1].z };
});

// いわ
const ROCK_R = Math.min(0.5, T * 0.42);
const rockGeo = new THREE.DodecahedronGeometry(ROCK_R, 0);
const rockMat = new THREE.MeshLambertMaterial({ color: 0x6d655c, flatShading: true });
function makeRock() {
  const m = new THREE.Mesh(rockGeo, rockMat);
  scene.add(m);
  return m;
}

// もうじゅう（オオカミみたいな どうぶつ）
const furMat = new THREE.MeshLambertMaterial({ color: 0x4a3322 });
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
const toothMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
function makeBeast() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.9), furMat);
  body.position.y = 0.55;
  const headM = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.38, 0.4), furMat);
  headM.position.set(0, 0.85, 0.55);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.25), furMat);
  snout.position.set(0, 0.78, 0.82);
  g.add(body, headM, snout);
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 4), furMat);
    ear.position.set(sx * 0.13, 1.12, 0.5);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), eyeMat);
    eye.position.set(sx * 0.11, 0.92, 0.76);
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 4), toothMat);
    tooth.position.set(sx * 0.06, 0.66, 0.92);
    tooth.rotation.x = Math.PI;
    g.add(ear, eye, tooth);
  }
  g.legs = [];
  for (const [lx, lz] of [[-0.17, 0.3], [0.17, 0.3], [-0.17, -0.3], [0.17, -0.3]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 0.12), furMat);
    leg.position.set(lx, 0.2, lz);
    g.add(leg);
    g.legs.push(leg);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.4), furMat);
  tail.position.set(0, 0.7, -0.6);
  tail.rotation.x = -0.5;
  g.add(tail);
  scene.add(g);
  return g;
}

// とびら
const doorMat = new THREE.MeshLambertMaterial({ map: doorTex });
const DOOR_H = 2.4;
const doorGeo = new THREE.BoxGeometry(T * 0.98, DOOR_H, 0.1);
const lintelGeo = new THREE.BoxGeometry(T, H - DOOR_H, 0.3);
const doorMap = new Map();
const doors = doorDefs.map(d => {
  const root = new THREE.Group();
  root.position.copy(tileCenter(d));
  root.rotation.y = d.dx ? Math.PI / 2 : 0; // とびらの おもては ろうかの むき
  const pivot = new THREE.Group();
  pivot.position.x = -T * 0.49;
  const panel = new THREE.Mesh(doorGeo, doorMat);
  panel.position.set(T * 0.49, DOOR_H / 2, 0);
  pivot.add(panel);
  const lintel = new THREE.Mesh(lintelGeo, wallMat);
  lintel.position.y = DOOR_H + (H - DOOR_H) / 2;
  root.add(pivot, lintel);
  scene.add(root);
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0x8a6a00 }));
  star.position.copy(tileCenter(d, 1.2));
  star.visible = false;
  scene.add(star);
  const door = {
    ...d, pivot, star, open: false, openAt: 0, swing: 0, content: 'item', got: false,
    center: tileCenter(d), pass: new THREE.Vector3(d.dx ? 1 : 0, 0, d.dx ? 0 : 1),
  };
  doorMap.set(key(d), door);
  return door;
});
const closedDoorAt = (x, z) => { const d = doorMap.get(`${x},${z}`); return !!d && !d.open; };
// トゲボール・いわ・もうじゅうが とおれる ところ（ひみつの かべは とおれない）
const passable = (x, z) => grid[z]?.[x] === OPEN && !closedDoorAt(x, z);

// ひろばの でぐちの むこうの ふかい きり
const fogMat = new THREE.MeshBasicMaterial({
  map: fogTex, color: FOG_COLOR, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, fog: false,
});
const fogPlaneGeo = new THREE.PlaneGeometry(T, H);
for (const h of hubExits) {
  for (const k of [0.7, 1.1, 1.5, 1.9]) {
    const m = new THREE.Mesh(fogPlaneGeo, fogMat);
    m.position.copy(tileCenter(h, H / 2)).add(new THREE.Vector3(h.dx * T * k, 0, h.dz * T * k));
    m.rotation.y = h.dx ? Math.PI / 2 : 0;
    scene.add(m);
  }
}

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
  new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.45 })); // きりで とおくからは みえない
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
  if (info.map) {
    drawMap(info.map); // ちずを みている ときは ちずを おおきく
  } else {
    panel(92, 8, 840, 92);
    hctx.fillStyle = '#fff';
    hctx.font = 'bold 34px sans-serif';
    hctx.fillText(info.top, 512, 40);
    hctx.fillStyle = '#ffe9a0';
    hctx.font = '22px sans-serif';
    hctx.fillText(info.hint, 512, 78);
  }
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

// ちず（めいろ ぜんぶが みえる。でも ゴールは かいてない！）
const seen = grid.map(r => r.map(() => false));
function drawMap(m) {
  const size = 480, x0 = 512 - size / 2, y0 = 20, c = size / W;
  panel(x0 - 10, y0 - 10, size + 20, size + 20);
  for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) {
    // ひみつの かべは ちずでも かべに みえる
    hctx.fillStyle = grid[z][x] !== OPEN ? '#3a3f4a' : seen[z][x] ? '#f3edd2' : '#9298a3';
    hctx.fillRect(x0 + x * c, y0 + z * c, c + 0.5, c + 0.5);
  }
  const dot = (t, color, r) => {
    hctx.fillStyle = color;
    hctx.beginPath();
    hctx.arc(x0 + (t.x + 0.5) * c, y0 + (t.z + 0.5) * c, r, 0, Math.PI * 2);
    hctx.fill();
  };
  for (const d of doors) {
    if (d.open) continue;
    hctx.fillStyle = '#b06a28';
    const w = d.dx ? c * 0.35 : c, h = d.dx ? c : c * 0.35;
    hctx.fillRect(x0 + (d.x + 0.5) * c - w / 2, y0 + (d.z + 0.5) * c - h / 2, w, h);
  }
  for (const s of stars) if (!s.got && seen[s.t.z][s.t.x]) dot(s.t, '#ffc400', c * 0.35);
  for (const cp of checkpoints) dot(cp.t, cp.reached ? '#40d040' : '#ff4040', c * 0.3);
  dot(START_T, '#4090ff', c * 0.35);
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
let jumpPressed = false;
let dashPressed = false;
let jumpY = 0, jumpV = 0;     // ジャンプの たかさと はやさ
let dashUntil = 0, dashReady = 0;
const dashDir = new THREE.Vector3();
const overlay = document.getElementById('overlay');

addEventListener('keydown', e => {
  keys[e.code] = true;
  keyNames[(e.key || '').toLowerCase()] = true;
  if (e.repeat) return;
  if (keyIs(e, S.keyAgain) || e.code === 'KeyM' || e.code === 'Enter') againPressed = true;
  if (keyIs(e, M.keyJump) || e.code === 'Space') jumpPressed = true;
  if (keyIs(e, S.keyRun) || e.code === 'ShiftLeft' || e.code === 'ShiftRight') dashPressed = true;
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
    if (down(S.padRunButton)) dashPressed = true;
    if (down(S.padCrouchButton)) jumpPressed = true;
    out.again = down(S.padActionButton);
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
      out.run = pressed(0) || pressed(3);   // ひだりトリガー：ダッシュ／はしる
    } else if (src.handedness === 'right') {
      out.turn = ax[0];
      out.jumpHeld = pressed(0);            // みぎトリガー：ジャンプ
      out.againHeld = pressed(4) || pressed(5); // A・B：ちず／もういちど
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
let xrAgainPrev = false, xrJumpPrev = false, xrRunPrev = false;

function solidAt(x, z) {
  const tt = tileOf(x, z);
  return !isOpen(tt.x, tt.z) || closedDoorAt(tt.x, tt.z);
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
  if (t < invulnUntil || gameState !== 'play') return false;
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
  return true;
}

// とびらの なかみを きめる（あそぶ たびに かわる）
function pickContent() {
  const table = [['item', M.doorItem], ['beast', M.doorBeast], ['ball', M.doorBall], ['rock', M.doorRock]];
  let r = Math.random() * table.reduce((a, [, w]) => a + w, 0);
  for (const [name, w] of table) { if ((r -= w) < 0) return name; }
  return 'item';
}
// とびらから でてきた もの
const active = [];
function removeActive(o) {
  scene.remove(o.g);
  active.splice(active.indexOf(o), 1);
}
function openDoor(d) {
  d.open = true;
  d.openAt = t;
  // じぶんが いる ほうと はんたいがわから でてくる
  const side = Math.sign(head.clone().sub(d.center).dot(d.pass)) || 1;
  d.swing = side * 1.5;
  beep([180, 140], 0.15, 'sawtooth', 0.06);
  const from = d.center.clone().addScaledVector(d.pass, -side * T);
  const dir = d.pass.clone().multiplyScalar(side);
  if (d.content === 'item') {
    d.star.visible = true;
    return;
  }
  if (d.content === 'beast') {
    const g = makeBeast();
    g.position.copy(from);
    g.rotation.y = Math.atan2(dir.x, dir.z);
    active.push({ kind: 'beast', g, born: t, state: 'wait' });
    beep([140, 110, 90], 0.15, 'sawtooth', 0.15);
    showMsg('もうじゅうだ！ にげろ！', '#ff7040', 1.2);
    return;
  }
  const ball = d.content === 'ball';
  const g = ball ? makeSpikeBall() : makeRock();
  const r = ball ? BALL_R : ROCK_R;
  g.position.copy(from).setY(r + 0.05);
  active.push({ kind: d.content, g, r, dir, born: t, state: 'wait', speed: ball ? M.flyBallSpeed : M.rockSpeed, base: from.clone() });
  if (ball) {
    beep([1200, 800], 0.06, 'square', 0.06);
    showMsg('トゲボール！ ジャンプ！', '#ff5050', 1);
  } else {
    beep([90, 70, 60], 0.12, 'sawtooth', 0.12);
    showMsg('いわが くる！ よこへ にげろ！', '#ffb060', 1);
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
  for (const d of doors) {
    d.open = false;
    d.swing = 0;
    d.pivot.rotation.y = 0;
    d.content = pickContent();
    d.got = false;
    d.star.visible = false;
  }
  while (active.length) removeActive(active[0]);
  gameState = 'play';
  elapsed = 0;
  hits = 0;
  mapOn = false;
  msg = null;
  invulnUntil = 0;
  jumpY = 0;
  jumpV = 0;
  dashUntil = 0;
  player.position.y = 0;
}
restart();

// もうじゅうが じぶんの ところへ くるための ちず（じぶんからの きょり）
const chaseMap = grid.map(r => r.map(() => -1));
let nextChaseMap = 0;
function buildChaseMap(from) {
  for (const r of chaseMap) r.fill(-1);
  if (!passable(from.x, from.z)) return;
  const q = [[from.x, from.z]];
  chaseMap[from.z][from.x] = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const [x, z] = q[qi];
    for (const [dx, dz] of DIRS) {
      const nx = x + dx, nz = z + dz;
      if (!passable(nx, nz) || chaseMap[nz][nx] >= 0) continue;
      chaseMap[nz][nx] = chaseMap[z][x] + 1;
      q.push([nx, nz]);
    }
  }
}
const beastTo = new THREE.Vector3();
function updateBeast(o, age, dt) {
  const g = o.g;
  if (o.state === 'wait') {
    g.position.y = Math.abs(Math.sin(age * 12)) * 0.08; // うなっている
    if (age > 0.6) o.state = 'chase';
    return;
  }
  if (o.state === 'leave') {
    g.position.y -= dt * 1.5; // じめんに もぐって かえっていく
    if (g.position.y < -1.3) removeActive(o);
    return;
  }
  if (age > M.beastTime) {
    o.state = 'leave';
    showMsg('もうじゅうが あきらめた', '#a0ffa0', 1);
    return;
  }
  const bt = tileOf(g.position.x, g.position.z);
  const pt = tileOf(head.x, head.z);
  if (bt.x === pt.x && bt.z === pt.z) {
    beastTo.set(head.x, 0, head.z);
  } else {
    let best = chaseMap[bt.z]?.[bt.x], next = null;
    for (const [dx, dz] of DIRS) {
      const v = chaseMap[bt.z + dz]?.[bt.x + dx];
      if (v >= 0 && (best < 0 || v < best)) { best = v; next = { x: bt.x + dx, z: bt.z + dz }; }
    }
    if (!next) return; // とどかない ところに いる
    beastTo.copy(tileCenter(next));
    // まがりかどで かべに めりこまないよう、いまの マスの まんなかを とおる
    const c = tileCenter(bt);
    if (next.x !== bt.x && Math.abs(g.position.z - c.z) > 0.05) beastTo.set(g.position.x, 0, c.z);
    if (next.z !== bt.z && Math.abs(g.position.x - c.x) > 0.05) beastTo.set(c.x, 0, g.position.z);
  }
  const dx = beastTo.x - g.position.x, dz = beastTo.z - g.position.z;
  const d = Math.hypot(dx, dz);
  if (d > 0.001) {
    const step = Math.min(d, M.beastSpeed * dt);
    g.position.x += (dx / d) * step;
    g.position.z += (dz / d) * step;
    g.rotation.y = Math.atan2(dx, dz);
  }
  g.position.y = Math.abs(Math.sin(t * 14)) * 0.06;
  g.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(t * 14 + (i % 2) * Math.PI) * 0.6; });
  if (Math.hypot(head.x - g.position.x, head.z - g.position.z) < 0.45 + PR && hurt()) {
    o.state = 'leave';
  }
}

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
    if (xi.jumpHeld && !xrJumpPrev) jumpPressed = true;
    xrJumpPrev = !!xi.jumpHeld;
    if (xi.run && !xrRunPrev) dashPressed = true;
    xrRunPrev = !!xi.run;
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
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
  fwd.normalize();
  right.set(-fwd.z, 0, fwd.x);
  move.set(0, 0, 0).addScaledVector(fwd, -mz).addScaledVector(right, mx);
  if (move.length() > 1) move.normalize();

  // --- ダッシュ（いっしゅん すごく はやく すすむ） ---
  if (dashPressed && t >= dashReady) {
    dashDir.copy(move.lengthSq() > 0.01 ? move : fwd).normalize();
    dashUntil = t + M.dashTime;
    dashReady = t + M.dashCooldown;
    beep([500, 900], 0.06, 'triangle', 0.08);
  }
  dashPressed = false;
  const dashing = t < dashUntil;

  // --- ジャンプ ---
  if (jumpPressed && jumpY <= 0.001) {
    jumpV = M.jumpPower;
    beep([600, 1000], 0.07, 'sine', 0.1);
  }
  jumpPressed = false;
  if (jumpY > 0 || jumpV > 0) {
    jumpV -= 12 * dt;
    jumpY = Math.max(0, jumpY + jumpV * dt);
    if (jumpY === 0) jumpV = 0;
  }
  player.position.y = jumpY;

  if (mx || mz || dashing) {
    let dx, dz;
    if (dashing) {
      dx = dashDir.x * M.dashSpeed * dt;
      dz = dashDir.z * M.dashSpeed * dt;
    } else {
      const speed = run ? S.runSpeed : S.walkSpeed;
      dx = move.x * speed * dt;
      dz = move.z * speed * dt;
    }
    if (blocked(head.x + dx, head.z)) dx = 0;
    if (blocked(head.x + dx, head.z + dz)) dz = 0;
    player.position.x += dx;
    player.position.z += dz;
  }
  camera.getWorldPosition(head);
  const pt = tileOf(head.x, head.z);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if (seen[pt.z + dz] && seen[pt.z + dz][pt.x + dx] !== undefined) seen[pt.z + dz][pt.x + dx] = true;
  }

  // --- とびら（ちかづくと あく） ---
  for (const d of doors) {
    if (!d.open) {
      if (Math.hypot(head.x - d.center.x, head.z - d.center.z) < 1.0) openDoor(d); // おしたら あく
      continue;
    }
    d.pivot.rotation.y += (d.swing - d.pivot.rotation.y) * (1 - Math.exp(-12 * dt));
    if (d.content === 'item' && !d.got) {
      d.star.rotation.y += dt * 2;
      d.star.position.y = 1.2 + Math.sin(t * 3) * 0.1;
      if (Math.hypot(head.x - d.center.x, head.z - d.center.z) < 0.7) {
        d.got = true;
        d.star.visible = false;
        beep([988, 1319], 0.1, 'triangle', 0.15);
        showMsg('ほし ゲット！', '#ffd23f', 1.2);
      }
    }
  }

  // --- とびらから でてきた もの ---
  if (active.some(o => o.kind === 'beast') && t >= nextChaseMap) { buildChaseMap(pt); nextChaseMap = t + 0.25; }
  for (const o of active.slice()) {
    const age = t - o.born;
    if (o.kind === 'beast') { updateBeast(o, age, dt); continue; }
    if (o.state === 'wait') {
      // ゴゴゴ… と ゆれてから ころがってくる
      o.g.position.x = o.base.x + Math.sin(t * 70) * 0.04;
      o.g.position.z = o.base.z + Math.cos(t * 63) * 0.04;
      if (age > 0.8) { o.state = 'roll'; o.g.position.x = o.base.x; o.g.position.z = o.base.z; }
    } else if (o.state === 'roll') {
      o.g.position.addScaledVector(o.dir, o.speed * dt);
      const axis = new THREE.Vector3(o.dir.z, 0, -o.dir.x);
      o.g.rotateOnWorldAxis(axis, (o.speed * dt) / o.r);
      const front = tileOf(o.g.position.x + o.dir.x * o.r, o.g.position.z + o.dir.z * o.r);
      if (!passable(front.x, front.z)) {
        o.state = 'break';
        o.breakAt = t;
        beep([200, 120], 0.08, 'square', 0.08);
      }
    } else {
      const k = 1 - (t - o.breakAt) / 0.3;
      if (k <= 0) { removeActive(o); continue; }
      o.g.scale.setScalar(k);
    }
    if (o.state !== 'break' && Math.hypot(head.x - o.g.position.x, head.z - o.g.position.z) < o.r + PR) {
      if (o.kind === 'rock' || jumpY < 0.6) hurt(); // トゲボールは ジャンプで よけられる。いわは むり！
    }
  }

  // --- トゲボール ---
  for (const b of balls) {
    // はしっこで ballWait びょう とまって、また ころがる
    const travel = b.len / M.ballSpeed;
    const total = 2 * (travel + M.ballWait);
    const s = (t + b.phase * total) % total;
    let u;
    if (s < M.ballWait) u = 0;
    else if (s < M.ballWait + travel) u = (s - M.ballWait) / travel;
    else if (s < 2 * M.ballWait + travel) u = 1;
    else u = 1 - (s - 2 * M.ballWait - travel) / travel;
    u = u * u * (3 - 2 * u); // うごきはじめと とまる ときは ゆっくり
    b.g.position.lerpVectors(b.a, b.b, u);
    if (b.horizontal) b.g.rotation.z = -b.g.position.x / BALL_R;
    else b.g.rotation.x = b.g.position.z / BALL_R;
    const near = Math.hypot(head.x - b.g.position.x, head.z - b.g.position.z) < BALL_R + PR + 0.05;
    if (near && jumpY < 0.6) hurt(); // ジャンプで とびこえられる
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
  const got = stars.filter(s => s.got).length + doors.filter(d => d.got).length;
  const total = stars.length + doors.filter(d => d.content === 'item').length;
  const info = {
    top: `★ ${got}/${total}　いたい ${hits}かい　${Math.floor(elapsed)}びょう`,
    hint: 'A：ジャンプ　B：ダッシュ　X か OK：ちず　みぎ・ひだり：まがる',
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
    const perfect = hits === 0 && got === total ? '　パーフェクト！' : '';
    info.big = 'ゴール！';
    info.bigColor = '#ffe066';
    info.small = [
      `タイム ${Math.round(elapsed)}びょう　★ ${got}/${total}　いたい ${hits}かい${perfect}`,
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
// ほかの タブや アプリに きりかえたら おとを とめる
document.addEventListener('visibilitychange', () => {
  if (document.hidden) actx.suspend();
  else if (started) actx.resume();
});
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (started) update(dt);
  if (phoneMode && !renderer.xr.isPresenting) stereo.render(scene, camera);
  else renderer.render(scene, camera);
});

// デバッグよう
window.__maze = {
  grid, path, doors, active, hubExits, balls, stars, checkpoints, player, camera, deadEnds,
  get state() { return gameState; }, get hits() { return hits; },
  goTo: tile => teleportTo(tile),
};
