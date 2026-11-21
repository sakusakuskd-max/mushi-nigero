import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { StereoEffect } from 'three/addons/effects/StereoEffect.js';
import { SETTINGS as S } from './settings.js';

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
scene.background = new THREE.Color(0x9fd3ff);
scene.fog = new THREE.Fog(0x9fd3ff, 20, 70);
scene.add(new THREE.HemisphereLight(0xffffff, 0x557744, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(10, 20, 5);
scene.add(sun);

// プレイヤー（player の なかに カメラ ＝ じぶんの あたま）
const player = new THREE.Group();
scene.add(player);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 200);
camera.rotation.order = 'YXZ';
camera.position.y = 1.5;
player.add(camera);

const listener = new THREE.AudioListener();
camera.add(listener);
const actx = listener.context;

// ============ ランダム（mapSeed で おなじ マップに なる） ============
function makeRandom(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = makeRandom(S.mapSeed);
const rr = (min, max) => min + (max - min) * rand();

// ============ フィールド ============
const HALF = S.fieldSize / 2;
const START = new THREE.Vector3(0, 0, HALF - 4);
const GOAL = new THREE.Vector3(0, 0, -HALF + 4);

const blockers = [];  // むしの しせんを さえぎる もの
const colliders = []; // ぶつかる もの {x,z,r}
const bugAvoid = [];  // むしが よける もの {x,z,r}
const bushes = [];    // しげみ {x,z,r}
const placed = [];

function findSpot(r) {
  for (let i = 0; i < 300; i++) {
    const x = rr(-HALF + 2, HALF - 2);
    const z = rr(-HALF + 2, HALF - 2);
    if (Math.hypot(x - START.x, z - START.z) < 6) continue;
    if (Math.hypot(x - GOAL.x, z - GOAL.z) < 6) continue;
    if (placed.some(p => Math.hypot(x - p.x, z - p.z) < p.r + r + 0.6)) continue;
    placed.push({ x, z, r });
    return { x, z };
  }
  return null;
}

// じめん
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(S.fieldSize + 80, S.fieldSize + 80),
  new THREE.MeshLambertMaterial({ color: 0x6cbf4a })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// さく
const fenceMat = new THREE.MeshLambertMaterial({ color: 0x9b6b3d });
for (const [x, z, rot] of [[0, HALF, 0], [0, -HALF, 0], [HALF, 0, 1], [-HALF, 0, 1]]) {
  const f = new THREE.Mesh(new THREE.BoxGeometry(S.fieldSize, 1, 0.2), fenceMat);
  f.position.set(x, 0.5, z);
  f.rotation.y = rot * Math.PI / 2;
  scene.add(f);
}

// 木
const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.5, 8);
const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a4a26 });
const leafGeo = new THREE.ConeGeometry(1.6, 3.5, 8);
const leafMat = new THREE.MeshLambertMaterial({ color: 0x2f7a35 });
for (let i = 0; i < S.treeCount; i++) {
  const p = findSpot(1.3);
  if (!p) break;
  const s = rr(0.8, 1.3);
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.set(p.x, 1.25 * s, p.z);
  trunk.scale.setScalar(s);
  const leaf = new THREE.Mesh(leafGeo, leafMat);
  leaf.position.set(p.x, 3.75 * s, p.z);
  leaf.scale.setScalar(s);
  scene.add(trunk, leaf);
  blockers.push(trunk, leaf);
  colliders.push({ x: p.x, z: p.z, r: 0.35 * s });
  bugAvoid.push({ x: p.x, z: p.z, r: 1.5 * s });
}

// 岩
const rockGeo = new THREE.DodecahedronGeometry(1, 0);
const rockMat = new THREE.MeshLambertMaterial({ color: 0x8a8a8a, flatShading: true });
for (let i = 0; i < S.rockCount; i++) {
  const r = rr(0.6, 1.1);
  const p = findSpot(r);
  if (!p) break;
  const rock = new THREE.Mesh(rockGeo, rockMat);
  rock.position.set(p.x, r * 0.5, p.z);
  rock.scale.set(r, r * rr(0.8, 1.2), r);
  rock.rotation.y = rr(0, Math.PI * 2);
  scene.add(rock);
  blockers.push(rock);
  colliders.push({ x: p.x, z: p.z, r: r * 0.9 });
  bugAvoid.push({ x: p.x, z: p.z, r: r });
}

// しげみ
const bushGeo = new THREE.IcosahedronGeometry(1, 1);
const bushMat = new THREE.MeshLambertMaterial({ color: 0x3f9a3a, side: THREE.DoubleSide, flatShading: true });
for (let i = 0; i < S.bushCount; i++) {
  const r = rr(1.0, 1.6);
  const p = findSpot(r);
  if (!p) break;
  for (let k = 0; k < 3; k++) {
    const b = new THREE.Mesh(bushGeo, bushMat);
    const a = (k / 3) * Math.PI * 2 + rr(0, 1);
    b.position.set(p.x + Math.cos(a) * r * 0.35, 0.45, p.z + Math.sin(a) * r * 0.35);
    b.scale.set(r * 0.75, rr(0.75, 1.0), r * 0.75);
    scene.add(b);
  }
  bushes.push({ x: p.x, z: p.z, r });
}

// ゴール
const goal = new THREE.Group();
const goalMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.6, fog: false });
const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 12, 16), goalMat);
pillar.position.y = 6;
const ring = new THREE.Mesh(new THREE.TorusGeometry(2, 0.15, 8, 40), goalMat);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.1;
goal.add(pillar, ring);
goal.position.copy(GOAL);
scene.add(goal);

// VRコントローラーの みため
const ctrlFactory = new XRControllerModelFactory();
for (let i = 0; i < 2; i++) {
  const grip = renderer.xr.getControllerGrip(i);
  grip.add(ctrlFactory.createControllerModel(grip));
  player.add(grip);
}

// ============ おと ============
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
function startAudio() {
  if (actx.state !== 'running') actx.resume();
}

// ============ むし ============
function makeMarkTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = 'bold 110px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = '#000';
  g.strokeText(text, 64, 70);
  g.fillStyle = color;
  g.fillText(text, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const qMarkMat = new THREE.SpriteMaterial({ map: makeMarkTexture('?', '#ffd23f'), transparent: true });
const eMarkMat = new THREE.SpriteMaterial({ map: makeMarkTexture('!', '#ff3b3b'), transparent: true });

const bodyGeo = new THREE.SphereGeometry(1, 12, 8);
const bodyMat = new THREE.MeshLambertMaterial({ color: 0x2b2118 });
const bellyMat = new THREE.MeshLambertMaterial({ color: 0xe8b820 });
const wingGeo = new THREE.PlaneGeometry(0.75, 0.3);
wingGeo.translate(0.375, 0, 0);
const wingMat = new THREE.MeshBasicMaterial({ color: 0xddeeff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
const eyeGeo = new THREE.SphereGeometry(0.08, 8, 6);
const STATE_COLOR = { patrol: 0xbfff40, alert: 0xffaa00, search: 0xffaa00, chase: 0xff2020 };

const raycaster = new THREE.Raycaster();
const tmpDir = new THREE.Vector3();
const tmpV = new THREE.Vector3();

function lerpAngle(a, b, t) {
  const d = ((((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  return a + d * t;
}

class Bug {
  constructor(index) {
    this.index = index;
    this.waypoints = [];
    for (let k = 0; k < 4; k++) {
      this.waypoints.push(new THREE.Vector3(rr(-HALF + 3, HALF - 3), 0, rr(-HALF + 3, HALF - 20)));
    }
    this.pos = new THREE.Vector3();
    this.lastSeen = new THREE.Vector3();
    this.searchTarget = new THREE.Vector3();
    this.phase = rand() * 10;
    this.baseFreq = 160 + index * 14;
    this.build();
    this.reset();
  }

  build() {
    const g = new THREE.Group();
    const belly = new THREE.Mesh(bodyGeo, bellyMat);
    belly.scale.set(0.28, 0.26, 0.42);
    belly.position.z = -0.4;
    const thorax = new THREE.Mesh(bodyGeo, bodyMat);
    thorax.scale.setScalar(0.22);
    const head = new THREE.Mesh(bodyGeo, bodyMat);
    head.scale.setScalar(0.17);
    head.position.z = 0.3;
    this.eyeMat = new THREE.MeshBasicMaterial({ color: STATE_COLOR.patrol });
    const eyeL = new THREE.Mesh(eyeGeo, this.eyeMat);
    eyeL.position.set(-0.09, 0.06, 0.42);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.09;
    this.wings = [];
    for (const side of [1, -1]) {
      const w = new THREE.Mesh(wingGeo, wingMat);
      w.position.set(0, 0.15, -0.05);
      if (side < 0) w.rotation.y = Math.PI;
      this.wings.push(w);
      g.add(w);
    }
    this.qMark = new THREE.Sprite(qMarkMat);
    this.qMark.position.y = 0.7;
    this.eMark = new THREE.Sprite(eMarkMat);
    this.eMark.position.y = 0.7;
    this.eMark.scale.setScalar(0.7);
    g.add(belly, thorax, head, eyeL, eyeR, this.qMark, this.eMark);
    g.scale.setScalar(S.bugSize);
    scene.add(g);
    this.group = g;

    // じめんの「みえる はんい」
    this.fanMat = new THREE.MeshBasicMaterial({ color: STATE_COLOR.patrol, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
    const half = S.bugSightAngle * DEG;
    const fan = new THREE.Mesh(new THREE.CircleGeometry(S.bugSightDistance, 24, -Math.PI / 2 - half, half * 2), this.fanMat);
    fan.rotation.x = -Math.PI / 2;
    this.fan = new THREE.Group();
    this.fan.add(fan);
    this.fan.visible = S.showSightCone;
    scene.add(this.fan);

    // ブーンという はおと（ちかいほど おおきく きこえる）
    const osc = actx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = this.baseFreq;
    const lfo = actx.createOscillator();
    lfo.frequency.value = 23 + this.index;
    const lfoGain = actx.createGain();
    lfoGain.gain.value = 18;
    lfo.connect(lfoGain).connect(osc.frequency);
    const filter = actx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    osc.connect(filter);
    osc.start();
    lfo.start();
    this.osc = osc;
    const sound = new THREE.PositionalAudio(listener);
    sound.setNodeSource(filter);
    sound.setRefDistance(1.5);
    sound.setRolloffFactor(1.6);
    sound.setVolume(0.35);
    g.add(sound);
  }

  reset() {
    this.pos.copy(this.waypoints[0]);
    this.pos.y = S.bugFlyHeight;
    this.curY = S.bugFlyHeight;
    this.wp = 1;
    this.state = 'patrol';
    this.prevState = '';
    this.aw = 0; // きづき度 0〜1
    this.lost = 0;
    this.timer = 0;
    this.yaw = rand() * Math.PI * 2;
  }

  distXZ(v) {
    return Math.hypot(v.x - this.pos.x, v.z - this.pos.z);
  }

  moveToward(target, speed, dt) {
    const p = this.pos;
    tmpV.set(target.x - p.x, 0, target.z - p.z);
    const d = tmpV.length();
    if (d < 0.05) return d;
    tmpV.multiplyScalar(1 / d);
    for (const c of bugAvoid) {
      const dx = p.x - c.x, dz = p.z - c.z;
      const dist = Math.hypot(dx, dz);
      const lim = c.r + 0.6;
      if (dist < lim && dist > 0.001) {
        const push = ((lim - dist) / lim) * 2;
        tmpV.x += (dx / dist) * push;
        tmpV.z += (dz / dist) * push;
      }
    }
    tmpV.normalize();
    const step = Math.min(speed * dt, d);
    p.x = clamp(p.x + tmpV.x * step, -HALF + 1, HALF - 1);
    p.z = clamp(p.z + tmpV.z * step, -HALF + 1, HALF - 1);
    this.yaw = lerpAngle(this.yaw, Math.atan2(tmpV.x, tmpV.z), 1 - Math.exp(-6 * dt));
    return d;
  }

  // プレイヤーが みえたら「きづく はやさ」を かえす（みえないと 0）
  look(head, hide) {
    const p = this.pos;
    const dx = head.x - p.x, dy = head.y - p.y, dz = head.z - p.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const chasing = this.state === 'chase';
    const maxDist = chasing ? S.bugSightDistance * 1.4 : S.bugSightDistance;
    if (dist > maxDist || dist < 0.01) return 0;
    if (!chasing) {
      const hd = Math.hypot(dx, dz);
      if (hd > 0.5) {
        const cos = (dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / hd;
        if (cos < Math.cos(S.bugSightAngle * DEG)) return 0;
      }
    } else if (hide < 0.3 && dist > 3) {
      return 0; // しげみで しゃがむと おいかけていても みうしなう
    }
    tmpDir.set(dx / dist, dy / dist, dz / dist);
    raycaster.set(p, tmpDir);
    raycaster.far = dist - 0.3;
    if (raycaster.intersectObjects(blockers, false).length > 0) return 0;
    let rate = hide / S.findTime;
    rate *= dist < 4 ? 2.5 : 1.6 - dist / maxDist;
    return rate;
  }

  alert(where, aw) {
    if (this.state === 'chase') return;
    this.state = 'alert';
    this.lastSeen.copy(where);
    this.aw = Math.max(this.aw, aw);
  }

  startChase(g) {
    if (this.state === 'chase') return;
    this.state = 'chase';
    this.aw = 1;
    this.lost = 0;
    this.lastSeen.copy(g.head);
    g.onFound(this);
  }

  pickSearch() {
    const a = Math.random() * Math.PI * 2;
    const r = 2 + Math.random() * 4;
    this.searchTarget.set(
      clamp(this.lastSeen.x + Math.cos(a) * r, -HALF + 2, HALF - 2),
      0,
      clamp(this.lastSeen.z + Math.sin(a) * r, -HALF + 2, HALF - 2)
    );
  }

  update(dt, g) {
    const { head, hide, noise } = g;
    const rate = this.look(head, hide);
    const seen = rate > 0;
    const hd = this.distXZ(head);
    const hears = noise && hd < S.runNoiseDistance;
    let targetY = S.bugFlyHeight;

    switch (this.state) {
      case 'patrol': { // みまわり
        if (seen) { this.aw += rate * dt; this.lastSeen.copy(head); }
        else this.aw = Math.max(0, this.aw - 0.25 * dt);
        if (hears) { this.alert(head, 0.4); break; }
        if (this.moveToward(this.waypoints[this.wp], S.bugPatrolSpeed, dt) < 0.6) {
          this.wp = (this.wp + 1) % this.waypoints.length;
        }
        if (this.aw >= 1) this.startChase(g);
        else if (this.aw > 0.35) this.state = 'alert';
        break;
      }
      case 'alert': { // あやしい…？
        if (seen) { this.aw += rate * dt; this.lastSeen.copy(head); }
        else this.aw -= 0.12 * dt;
        if (hears) this.lastSeen.copy(head);
        if (this.distXZ(this.lastSeen) > 1.5) this.moveToward(this.lastSeen, S.bugPatrolSpeed * 0.8, dt);
        else this.yaw += dt * 1.2; // きょろきょろ
        if (this.aw >= 1) this.startChase(g);
        else if (this.aw <= 0.05) { this.aw = 0; this.state = 'patrol'; }
        break;
      }
      case 'chase': { // おいかける！
        if (seen) { this.lastSeen.copy(head); this.lost = 0; }
        else this.lost += dt;
        targetY = Math.max(0.6, this.lastSeen.y - 0.1);
        this.moveToward(this.lastSeen, S.bugChaseSpeed, dt);
        if (this.lost > S.loseTime) {
          this.state = 'search';
          this.timer = 0;
          this.aw = 0.6;
          this.pickSearch();
        }
        break;
      }
      case 'search': { // さがす
        if (seen) { this.aw += rate * 2 * dt; this.lastSeen.copy(head); }
        if (noise && hd < S.runNoiseDistance * 1.3) this.aw = 1;
        this.timer += dt;
        if (this.moveToward(this.searchTarget, S.bugPatrolSpeed * 1.1, dt) < 0.6) this.pickSearch();
        targetY = 1.6;
        if (this.aw >= 1) this.startChase(g);
        else if (this.timer > S.giveUpTime) { this.state = 'patrol'; this.aw = 0; }
        break;
      }
    }
    this.aw = clamp(this.aw, 0, 1);

    // うごきと みため
    this.curY += (targetY - this.curY) * (1 - Math.exp(-2 * dt));
    this.pos.y = this.curY;
    const bob = Math.sin(g.t * 3 + this.phase) * 0.12;
    this.group.position.set(this.pos.x, this.pos.y + bob, this.pos.z);
    this.group.rotation.y = this.yaw;
    const flap = Math.sin(g.t * 45 + this.phase) * 0.9;
    for (const w of this.wings) w.rotation.z = flap;
    this.qMark.visible = this.state === 'alert' || this.state === 'search' || this.aw > 0.1;
    this.qMark.visible &&= this.state !== 'chase';
    this.qMark.scale.setScalar(0.3 + this.aw * 0.5);
    this.eMark.visible = this.state === 'chase';
    this.fan.position.set(this.pos.x, 0.04, this.pos.z);
    this.fan.rotation.y = this.yaw;
    this.fan.visible = S.showSightCone && this.state !== 'chase';

    if (this.state !== this.prevState) {
      const col = STATE_COLOR[this.state];
      this.eyeMat.color.setHex(col);
      this.fanMat.color.setHex(col);
      const f = this.state === 'chase' ? this.baseFreq * 1.6 : this.baseFreq;
      this.osc.frequency.setTargetAtTime(f, actx.currentTime, 0.15);
      this.prevState = this.state;
    }

    // つかまった？
    if (this.group.position.distanceTo(head) < S.catchDistance * S.bugSize) g.onCaught();
  }
}

const bugs = [];
for (let i = 0; i < S.bugCount; i++) bugs.push(new Bug(i));

// ============ HUD（めの まえの ひょうじ） ============
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
  hctx.fillStyle = 'rgba(0,0,0,0.5)';
  hctx.beginPath();
  if (hctx.roundRect) hctx.roundRect(x, y, w, h, 18);
  else hctx.rect(x, y, w, h);
  hctx.fill();
}

let hudKey = '';
function drawHUD(info) {
  const key = JSON.stringify(info);
  if (key === hudKey) return;
  hudKey = key;
  hctx.clearRect(0, 0, 1024, 512);
  hctx.textAlign = 'center';
  hctx.textBaseline = 'middle';

  panel(272, 8, 480, 96);
  if (info.chase) {
    hctx.fillStyle = '#ff4040';
    hctx.font = 'bold 50px sans-serif';
    hctx.fillText('みつかった！ にげろ！', 512, 46);
  } else {
    hctx.fillStyle = '#fff';
    hctx.font = 'bold 30px sans-serif';
    hctx.fillText('きづかれ度', 360, 46);
    hctx.fillStyle = 'rgba(255,255,255,0.25)';
    hctx.fillRect(450, 32, 280, 28);
    const a = info.aw;
    hctx.fillStyle = a < 0.35 ? '#7fe07f' : a < 0.7 ? '#ffd23f' : '#ff7a30';
    hctx.fillRect(450, 32, 280 * a, 28);
  }
  hctx.fillStyle = '#ffe9a0';
  hctx.font = '24px sans-serif';
  hctx.fillText(info.st, 512, 84);

  if (info.big) {
    panel(112, 170, 800, 230);
    hctx.fillStyle = info.bigColor;
    hctx.font = 'bold 80px sans-serif';
    hctx.fillText(info.big, 512, 240);
    hctx.fillStyle = '#fff';
    hctx.font = '30px sans-serif';
    info.small.forEach((s, i) => hctx.fillText(s, 512, 310 + i * 40));
  }
  hudTex.needsUpdate = true;
}

// ============ そうさ ============
const keys = {};
let pitch = 0;
let started = false;
let lastKey = '';
const overlay = document.getElementById('overlay');

const keyNames = {}; // おされている キー（e.key で きろく）
const keyIs = (e, setting) => [].concat(setting).includes((e.key || '').toLowerCase());
let againPressed = false;

addEventListener('keydown', e => {
  keys[e.code] = true;
  keyNames[(e.key || '').toLowerCase()] = true;
  lastKey = `code=${e.code || '?'}  key=${e.key}  keyCode=${e.keyCode}`;
  if (e.repeat) return; // おしっぱなしの くりかえしは むし
  if (e.code === 'Space' || e.code === 'KeyX' || keyIs(e, S.keyCrouch)) crouchToggle = !crouchToggle;
  if (e.code === 'KeyR' || keyIs(e, S.keyRecenter)) recenter();
  if (keyIs(e, S.keyAgain)) againPressed = true;
  if (started && gameState === 'play') {
    if (keyIs(e, S.keyTurnRight)) snapTurn(-1);
    if (keyIs(e, S.keyTurnLeft)) snapTurn(1);
  }
});
addEventListener('keyup', e => {
  keys[e.code] = false;
  keyNames[(e.key || '').toLowerCase()] = false;
});
// いまの ばしょで くるっと むきを かえる（dir: 1=ひだり, -1=みぎ）
function snapTurn(dir) {
  camera.getWorldPosition(before);
  player.rotation.y += dir * 30 * DEG;
  camera.getWorldPosition(head);
  player.position.x += before.x - head.x;
  player.position.z += before.z - head.z;
}
overlay.addEventListener('click', e => {
  if (e.target.closest('#phone, #padtest-btn')) return;
  overlay.classList.add('hidden');
  started = true;
  startAudio();
  renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
});
renderer.domElement.addEventListener('click', () => {
  if (!renderer.xr.isPresenting && !phoneMode) renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
});

// ---- スマホVRモード（ゴーグルに スマホを いれて あそぶ） ----
let phoneMode = false;
let gyro = null; // {alpha, beta, gamma}
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
// いま むいている ほうこうを「まえ（ゴールの ほう）」に する
function recenter() {
  if (!phoneMode || !updateGyroQ()) return;
  const e = new THREE.Euler().setFromQuaternion(gyroQ, 'YXZ');
  player.rotation.y = -e.y;
}
addEventListener('deviceorientation', e => {
  if (e.alpha == null) return;
  const first = !gyro;
  gyro = { alpha: e.alpha, beta: e.beta, gamma: e.gamma };
  if (first) recenter();
});
function fitSize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  const w = phoneMode ? window.innerWidth / 2 : window.innerWidth;
  camera.aspect = w / window.innerHeight;
  camera.updateProjectionMatrix();
  if (phoneMode) stereo.setSize(window.innerWidth, window.innerHeight);
}
document.getElementById('phone').addEventListener('click', async () => {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      await DeviceOrientationEvent.requestPermission(); // iPhoneは きょかが ひつよう
    }
  } catch (err) { /* むしする */ }
  document.documentElement.requestFullscreen?.()?.catch?.(() => {});
  screen.orientation?.lock?.('landscape')?.catch?.(() => {});
  navigator.wakeLock?.request?.('screen')?.catch?.(() => {}); // がめんが きえないように
  phoneMode = true;
  hud.scale.setScalar(0.7); // ゴーグルの はしは みにくいので ちいさめに
  document.getElementById('VRButton')?.remove();
  fitSize();
  overlay.classList.add('hidden');
  started = true;
  startAudio();
  recenter();
});

// ---- コントローラー（Bluetoothリモコン / ゲームパッド） ----
let crouchToggle = false;
let padPrev = [];
function readPad() {
  const out = { mx: 0, mz: 0, turn: 0, run: false, action: false, any: false, pad: null };
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp) continue;
    out.pad = gp;
    const pressed = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const down = i => pressed(i) && !padPrev[i];
    out.mx = gp.axes[0] || 0;
    out.mz = gp.axes[1] || 0;
    if (gp.axes.length >= 4) out.turn = gp.axes[2] || 0;
    // じゅうじキー（ある ばあい）
    if (pressed(12)) out.mz = -1;
    if (pressed(13)) out.mz = 1;
    if (pressed(14)) out.mx = -1;
    if (pressed(15)) out.mx = 1;
    out.run = pressed(S.padRunButton);
    out.action = pressed(S.padActionButton);
    out.any = gp.buttons.some(b => b.pressed);
    if (down(S.padCrouchButton)) crouchToggle = !crouchToggle;
    if (down(S.padRecenterButton)) recenter();
    padPrev = gp.buttons.map(b => b.pressed);
    break;
  }
  return out;
}

// ---- コントローラーテスト がめん ----
let lastPointer = '';
let pointerCount = 0;
for (const type of ['pointerdown', 'pointermove', 'wheel', 'touchstart']) {
  addEventListener(type, e => {
    pointerCount++;
    const where = e.clientX != null ? ` x=${Math.round(e.clientX)} y=${Math.round(e.clientY)}` : '';
    const kind = e.pointerType ? ` (${e.pointerType})` : '';
    lastPointer = `${type}${kind}${where}  [${pointerCount}かいめ]`;
  }, { passive: true });
}
const padtest = document.getElementById('padtest');
const padtestOut = document.getElementById('padtest-out');
document.getElementById('padtest-btn').addEventListener('click', () => {
  padtest.classList.remove('hidden');
});
document.getElementById('padtest-close').addEventListener('click', () => {
  padtest.classList.add('hidden');
});
function updatePadTest() {
  if (padtest.classList.contains('hidden')) return;
  const pads = (navigator.getGamepads ? [...navigator.getGamepads()] : []).filter(Boolean);
  const lines = [];
  if (!pads.length) lines.push('ゲームパッド：みつからない（ボタンを どれか おしてみて）');
  for (const gp of pads) {
    lines.push(`ゲームパッド：${gp.id}`);
    lines.push(`スティック：${gp.axes.map(a => a.toFixed(2)).join('  ')}`);
    const on = gp.buttons.map((b, i) => (b.pressed ? i : null)).filter(i => i !== null);
    lines.push(`おしている ボタン ばんごう：${on.length ? on.join(', ') : 'なし'}`);
  }
  lines.push(`さいごに おされた キー：${lastKey || 'なし'}`);
  lines.push(`マウス／タッチ：${lastPointer || 'なし'}`);
  padtestOut.textContent = lines.join('\n');
}

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
addEventListener('resize', fitSize);

function readXRInput() {
  const out = { mx: 0, mz: 0, turn: 0, run: false, action: false };
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
      out.action = pressed(0) || pressed(4);
    }
  }
  return out;
}

// ============ ゲームの すすみかた ============
const head = new THREE.Vector3();
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const move = new THREE.Vector3();
const before = new THREE.Vector3();

let gameState = 'play'; // play / over / clear
let endTime = 0;
let elapsed = 0;
let foundCount = 0;
let maxHeadY = 0;
let snapped = false;
let actionPrev = false;

const game = {
  t: 0,
  head,
  hide: 1,
  noise: false,
  onFound(bug) {
    if (!bugs.some(b => b !== bug && b.state === 'chase')) {
      foundCount++;
      beep([880, 1320], 0.09);
    }
    for (const b of bugs) {
      if (b !== bug && b.distXZ(bug.pos) < S.callFriendsDistance) b.alert(head, 0.6);
    }
  },
  onCaught() {
    if (gameState !== 'play') return;
    gameState = 'over';
    endTime = game.t;
    beep([440, 330, 220], 0.25, 'sawtooth', 0.1);
  },
};

function restart() {
  player.position.copy(START);
  player.rotation.y = 0;
  pitch = 0;
  crouchToggle = false;
  recenter();
  for (const b of bugs) b.reset();
  gameState = 'play';
  elapsed = 0;
  foundCount = 0;
}
restart();

function update(dt) {
  game.t += dt;
  const presenting = renderer.xr.isPresenting;

  // --- にゅうりょく ---
  let mx = 0, mz = 0, run = false, turn = 0, action = false, crouch = false;
  if (presenting) {
    const xi = readXRInput();
    ({ mx, mz, run, turn, action } = xi);
    const y = camera.position.y; // VRでは ほんとうの あたまの たかさ
    if (y > maxHeadY) maxHeadY = y;
    crouch = maxHeadY > 0.6 && y < maxHeadY * S.crouchRatio;
  } else {
    const p = readPad();
    mx = p.mx;
    mz = p.mz;
    turn = p.turn;
    if (keys.KeyW || keys.ArrowUp) mz -= 1;
    if (keys.KeyS || keys.ArrowDown) mz += 1;
    if (keys.KeyA || keys.ArrowLeft) mx -= 1;
    if (keys.KeyD || keys.ArrowRight) mx += 1;
    run = keys.ShiftLeft || keys.ShiftRight || p.run || keyNames[S.keyRun];
    action = keys.Enter || p.action || (gameState !== 'play' && p.any) || againPressed;
    againPressed = false;
    const wantCrouch = keys.KeyC || keys.ControlLeft || crouchToggle;
    const h = wantCrouch ? 0.85 : 1.5;
    camera.position.y += (h - camera.position.y) * (1 - Math.exp(-10 * dt));
    if (phoneMode && updateGyroQ()) camera.quaternion.copy(gyroQ); // スマホの むきで みまわす
    else camera.rotation.set(pitch, 0, 0);
    crouch = camera.position.y < 1.15;
  }
  const actionDown = action && !actionPrev;
  actionPrev = action;

  if (gameState !== 'play') {
    if (actionDown && game.t - endTime > 1) restart();
    camera.getWorldPosition(head);
    drawEnd();
    return;
  }
  elapsed += dt;

  // --- むきをかえる（VR右スティック） ---
  if (Math.abs(turn) > 0.7 && !snapped) {
    snapped = true;
    snapTurn(-Math.sign(turn));
  } else if (Math.abs(turn) < 0.3) snapped = false;

  // --- あるく ---
  if (Math.abs(mx) < 0.15) mx = 0;
  if (Math.abs(mz) < 0.15) mz = 0;
  let moving = false;
  if (mx || mz) {
    const speed = crouch ? S.crouchSpeed : run ? S.runSpeed : S.walkSpeed;
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    right.set(-fwd.z, 0, fwd.x);
    move.set(0, 0, 0).addScaledVector(fwd, -mz).addScaledVector(right, mx);
    if (move.length() > 1) move.normalize();
    player.position.addScaledVector(move, speed * dt);
    moving = true;
  }

  // --- ぶつかる ---
  camera.getWorldPosition(head);
  for (const c of colliders) {
    const dx = head.x - c.x, dz = head.z - c.z;
    const d = Math.hypot(dx, dz);
    const min = c.r + 0.3;
    if (d < min && d > 1e-4) {
      player.position.x += (dx / d) * (min - d);
      player.position.z += (dz / d) * (min - d);
    }
  }
  camera.getWorldPosition(head);
  const lim = HALF - 0.6;
  if (head.x > lim) player.position.x -= head.x - lim;
  if (head.x < -lim) player.position.x -= head.x + lim;
  if (head.z > lim) player.position.z -= head.z - lim;
  if (head.z < -lim) player.position.z -= head.z + lim;
  camera.getWorldPosition(head);

  // --- かくれてる？ ---
  const inBush = bushes.some(b => Math.hypot(head.x - b.x, head.z - b.z) < b.r * 0.9);
  let hide = 1;
  if (inBush && crouch) hide = S.bushCrouchHide;
  else if (inBush) hide = S.bushStandHide;
  else if (crouch) hide = S.crouchHide;
  game.hide = hide;
  game.noise = moving && run && !crouch;

  // --- むしを うごかす ---
  for (const b of bugs) b.update(dt, game);
  if (gameState !== 'play') { drawEnd(); return; }

  // --- ゴール？ ---
  const goalDist = Math.hypot(head.x - GOAL.x, head.z - GOAL.z);
  if (goalDist < 2.2) {
    gameState = 'clear';
    endTime = game.t;
    beep([523, 659, 784, 1047], 0.15, 'triangle', 0.15);
    drawEnd();
    return;
  }

  const st = [];
  if (hide <= S.bushCrouchHide) st.push('かくれてる！');
  else if (inBush) st.push('しげみ');
  if (crouch) st.push('しゃがみ');
  if (game.noise) st.push('あしおと！');
  st.push(`ゴールまで ${Math.round(goalDist)}m`);
  drawHUD({
    chase: bugs.some(b => b.state === 'chase'),
    aw: Math.round(Math.max(...bugs.map(b => b.aw), 0) * 20) / 20,
    st: st.join('　'),
  });
}

function drawEnd() {
  const again = renderer.xr.isPresenting ? '右トリガーで もういちど'
    : phoneMode ? 'ボタンを おして もういちど' : 'Enter で もういちど';
  if (gameState === 'over') {
    drawHUD({ chase: true, aw: 1, st: '', big: 'つかまった…', bigColor: '#ff5050', small: [again] });
  } else if (gameState === 'clear') {
    const perfect = foundCount === 0 ? '　パーフェクト！' : '';
    drawHUD({
      chase: false, aw: 0, st: '',
      big: 'ゴール！', bigColor: '#ffe066',
      small: [`タイム ${Math.round(elapsed)}びょう　みつかった ${foundCount}かい${perfect}`, again],
    });
  }
}

// ============ まいフレーム ============
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (started) update(dt);
  updatePadTest();
  if (phoneMode && !renderer.xr.isPresenting) stereo.render(scene, camera);
  else renderer.render(scene, camera);
});

// デバッグよう（ブラウザの コンソールから みられる）
window.__game = { bugs, player, camera, get state() { return gameState; } };
