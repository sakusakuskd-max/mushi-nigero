// =============================================
//  スティック・やじるしキーの よみとり
//  （めいろ と むしの ゲームの りょうほうで つかう）
//  リモコンに よって スティックの おくりかたが ちがうので、
//  いろいろな おくりかたを ぜんぶ うけとれるように している
// =============================================

const ARROW = {
  arrowup: [0, -1], up: [0, -1],
  arrowdown: [0, 1], down: [0, 1],
  arrowleft: [-1, 0], left: [-1, 0],
  arrowright: [1, 0], right: [1, 0],
};
const KEYCODE = { 38: 'arrowup', 40: 'arrowdown', 37: 'arrowleft', 39: 'arrowright' };
const held = new Set();

// e.key → e.code → e.keyCode の じゅんで やじるしキーか しらべる
function arrowName(e) {
  const k = (e.key || '').toLowerCase();
  if (ARROW[k]) return k;
  const c = (e.code || '').toLowerCase();
  if (ARROW[c]) return c;
  return KEYCODE[e.keyCode] || null;
}
addEventListener('keydown', e => {
  const n = arrowName(e);
  if (n) {
    held.add(n);
    e.preventDefault(); // がめんが スクロールしないように
  }
  if (e.key === ' ' || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => {
  const n = arrowName(e);
  if (n) held.delete(n);
});
addEventListener('blur', () => held.clear());

// やじるしキー（キーボードモードの リモコンの スティック）
export function arrowMove() {
  let mx = 0, mz = 0;
  for (const n of held) { mx += ARROW[n][0]; mz += ARROW[n][1]; }
  return { mx: Math.max(-1, Math.min(1, mx)), mz: Math.max(-1, Math.min(1, mz)) };
}

// ゲームパッドモードの スティック
const hatSeen = {};
function padMove(gp) {
  let mx = gp.axes[0] || 0, mz = gp.axes[1] || 0;
  const pressed = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
  // じゅうじキー
  if (pressed(12)) mz = -1;
  if (pressed(13)) mz = 1;
  if (pressed(14)) mx = -1;
  if (pressed(15)) mx = 1;
  // ハットスイッチ（スティックが axes[9] に くる リモコン。はなすと 1.28 くらいに なる）
  const v = gp.axes[9];
  if (v !== undefined) {
    if (v > 1.1) hatSeen[gp.index] = true;
    if (hatSeen[gp.index] && v >= -1.05 && v <= 1.05) {
      const idx = Math.round((v + 1) / (2 / 7));
      if (Math.abs(v - (-1 + idx * 2 / 7)) < 0.08) {
        const a = (idx % 8) * Math.PI / 4; // 0=うえ から とけいまわり
        mx = Math.round(Math.sin(a));
        mz = -Math.round(Math.cos(a));
      }
    }
  }
  return { mx, mz };
}

// つながっている ぜんぶの コントローラーの なかで、いちばん うごいている スティック
export function padStick() {
  let best = { mx: 0, mz: 0 }, bestLen = 0;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp) continue;
    const m = padMove(gp);
    const len = Math.hypot(m.mx, m.mz);
    if (len > bestLen) { best = m; bestLen = len; }
  }
  return best;
}
