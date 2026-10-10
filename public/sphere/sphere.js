/* 球体ビュー：円（工程）＝大円、点（コツ）＝円上の点、線（手順）＝隣接点をつなぐ弧、
   球（関係）＝工程をまたぐ弦。裏側（z<0）は破線＋薄色で描く。 */
class SphereView {
  constructor(canvas, { onSelect } = {}) {
    this.c = canvas; this.ctx = canvas.getContext('2d');
    this.onSelect = onSelect || (() => {});
    this.yaw = -0.6; this.pitch = 0.35;
    this.vx = 0; this.vy = 0;           // 慣性
    this.auto = true;                    // 触るまでゆっくり自動回転
    this.circles = []; this.points = []; this.links = [];
    this.layout = []; this.rings = [];   // 配置結果
    this.selected = null;
    this.drag = null;
    this._bind();
    this.resize();
    requestAnimationFrame(t => this._frame(t));
  }

  setData({ circles, points, links }) {
    this.circles = circles; this.points = points; this.links = links;
    this._layout();
  }

  /* --- レイアウト：各円に法線ベクトルを与え、点をその大円上に等間隔配置 --- */
  _layout() {
    const n = Math.max(this.circles.length, 1);
    const golden = Math.PI * (3 - Math.sqrt(5));
    this.rings = [];
    this.layout = [];
    const byCircle = new Map();
    for (const p of this.points) {
      const k = p.circleId || '__none';
      if (!byCircle.has(k)) byCircle.set(k, []);
      byCircle.get(k).push(p);
    }
    const circleIds = this.circles.map(c => c.id);
    if (byCircle.has('__none')) circleIds.push('__none');
    circleIds.forEach((cid, i) => {
      // 法線：球面上にばらける
      const t = n === 1 ? 0.5 : i / Math.max(circleIds.length - 1, 1);
      const z = 0.35 + 0.5 * (1 - t) ;           // 傾きを変える
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      const a = i * golden + 0.7;
      const nrm = norm([r * Math.cos(a), z, r * Math.sin(a)]);
      const u = norm(cross(nrm, Math.abs(nrm[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
      const v = cross(nrm, u);
      const circle = this.circles.find(c => c.id === cid);
      this.rings.push({ id: cid, nrm, u, v, color: circle ? circle.color : '#9aa3ad', name: circle ? circle.name : '未分類' });
      const pts = (byCircle.get(cid) || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const N = pts.length;
      pts.forEach((p, k) => {
        const th = (2 * Math.PI * k) / Math.max(N, 1) + i * 0.9;
        const pos = add(mul(u, Math.cos(th)), mul(v, Math.sin(th)));
        this.layout.push({ id: p.id, ring: cid, idx: k, pos, point: p });
      });
    });
  }

  /* --- 入力 --- */
  _bind() {
    const c = this.c;
    const pos = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      const [x, y] = pos(e);
      this.drag = { x, y, sx: x, sy: y, t: performance.now(), moved: false };
      this.vx = this.vy = 0; this.auto = false;
    });
    c.addEventListener('pointermove', e => {
      if (!this.drag) return;
      const [x, y] = pos(e);
      const dx = x - this.drag.x, dy = y - this.drag.y;
      if (Math.abs(x - this.drag.sx) + Math.abs(y - this.drag.sy) > 6) this.drag.moved = true;
      this.yaw += dx * 0.012; this.pitch += dy * 0.012;
      this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch));
      this.vx = dx * 0.012; this.vy = dy * 0.012;
      this.drag.x = x; this.drag.y = y;
    });
    const up = e => {
      if (!this.drag) return;
      if (!this.drag.moved) {
        const [x, y] = pos(e);
        const hit = this._hit(x, y);
        this.selected = hit ? hit.id : null;
        this.onSelect(hit ? hit.point : null);
        this.vx = this.vy = 0;
      }
      this.drag = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.c.getBoundingClientRect();
    this.w = r.width; this.h = r.height;
    this.c.width = r.width * dpr; this.c.height = r.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.R = Math.min(this.w, this.h) * 0.36;
    this.cx = this.w / 2; this.cy = this.h / 2;
  }

  /* --- 回転・投影 --- */
  _rot(p) {
    const [x, y, z] = p;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;        // Y軸
    const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;       // X軸
    return [x1, y2, z2];
  }
  _proj(p) {
    const [x, y, z] = this._rot(p);
    const s = 1 + z * 0.18;                                    // 軽い遠近
    return { x: this.cx + x * this.R * s, y: this.cy - y * this.R * s, z };
  }
  _hit(x, y) {
    let best = null, bd = 22;
    for (const L of this.layout) {
      const q = this._proj(L.pos);
      const d = Math.hypot(q.x - x, q.y - y) + (q.z < 0 ? 6 : 0);
      if (d < bd) { bd = d; best = L; }
    }
    return best;
  }

  /* --- 描画 --- */
  _frame(t) {
    // タブ切替や親ページのリサイズで canvas の大きさが変わったら描画サイズを合わせ直す
    const cw = this.c.clientWidth, ch = this.c.clientHeight;
    if (cw && ch && (cw !== this.w || ch !== this.h)) this.resize();
    if (!this.drag) {
      if (this.auto) { this.yaw += 0.0025; }
      else {
        this.yaw += this.vx; this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + this.vy));
        this.vx *= 0.94; this.vy *= 0.94;
      }
    }
    this.draw();
    requestAnimationFrame(t2 => this._frame(t2));
  }

  draw() {
    const ctx = this.ctx, R = this.R;
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.w) return;

    // 輪郭
    ctx.save();
    ctx.beginPath(); ctx.arc(this.cx, this.cy, R * 1.0, 0, Math.PI * 2);
    ctx.strokeStyle = '#c9ced5'; ctx.lineWidth = 1.5; ctx.stroke();
    // 回す矢印（装飾）
    ctx.beginPath(); ctx.arc(this.cx, this.cy, R * 1.2, Math.PI * 1.15, Math.PI * 1.95);
    ctx.strokeStyle = '#c44a2f'; ctx.lineWidth = 2; ctx.stroke();
    const ax = this.cx + R * 1.2 * Math.cos(Math.PI * 1.95), ay = this.cy + R * 1.2 * Math.sin(Math.PI * 1.95);
    ctx.beginPath(); ctx.moveTo(ax - 7, ay - 6); ctx.lineTo(ax + 2, ay + 1); ctx.lineTo(ax - 8, ay + 5); ctx.fillStyle = '#c44a2f'; ctx.fill();
    ctx.restore();

    // 裏→表の順で描くため、要素を集めて z でソート
    const segs = [];
    // 円（工程）の大円：64分割
    for (const ring of this.rings) {
      const pts = [];
      for (let k = 0; k <= 64; k++) {
        const th = (2 * Math.PI * k) / 64;
        pts.push(this._proj(add(mul(ring.u, Math.cos(th)), mul(ring.v, Math.sin(th)))));
      }
      for (let k = 0; k < 64; k++) {
        const a = pts[k], b = pts[k + 1];
        segs.push({ z: (a.z + b.z) / 2, kind: 'ring', a, b, color: ring.color });
      }
    }
    // 線（手順）：同じ円の隣接点を弧でつなぐ
    const byRing = new Map();
    for (const L of this.layout) { if (!byRing.has(L.ring)) byRing.set(L.ring, []); byRing.get(L.ring).push(L); }
    for (const [rid, arr] of byRing) {
      arr.sort((a, b) => a.idx - b.idx);
      for (let k = 0; k + 1 < arr.length; k++) {
        const A = arr[k], B = arr[k + 1];
        const hidden = A.point.state === 'hidden' || B.point.state === 'hidden';
        // 球面上の短弧を補間
        const steps = 10;
        for (let s = 0; s < steps; s++) {
          const p0 = slerp(A.pos, B.pos, s / steps), p1 = slerp(A.pos, B.pos, (s + 1) / steps);
          const a = this._proj(p0), b = this._proj(p1);
          segs.push({ z: (a.z + b.z) / 2, kind: 'line', a, b, hidden });
        }
      }
    }
    // 球（関係）：弦（球体を貫く）
    const byId = new Map(this.layout.map(L => [L.id, L]));
    for (const lk of this.links) {
      const A = byId.get(lk.from), B = byId.get(lk.to);
      if (!A || !B) continue;
      const a = this._proj(A.pos), b = this._proj(B.pos);
      segs.push({ z: (a.z + b.z) / 2, kind: 'chord', a, b });
    }
    segs.sort((p, q) => p.z - q.z);
    for (const s of segs) {
      const back = s.z < 0;
      ctx.beginPath(); ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y);
      if (s.kind === 'ring') {
        ctx.setLineDash(back ? [3, 5] : []);
        ctx.strokeStyle = s.color; ctx.globalAlpha = back ? 0.28 : 0.55; ctx.lineWidth = 1.2;
      } else if (s.kind === 'line') {
        ctx.setLineDash(back || s.hidden ? [4, 5] : []);
        ctx.strokeStyle = '#1f2a3a'; ctx.globalAlpha = back ? 0.25 : (s.hidden ? 0.5 : 0.9); ctx.lineWidth = back ? 1.4 : 2.2;
      } else {
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = '#c44a2f'; ctx.globalAlpha = back ? 0.25 : 0.6; ctx.lineWidth = 1.2;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;

    // 点
    const nodes = this.layout.map(L => ({ L, q: this._proj(L.pos) })).sort((a, b) => a.q.z - b.q.z);
    const showLabels = this.layout.length <= 16;
    for (const { L, q } of nodes) {
      const back = q.z < 0;
      const st = L.point.state || 'seen';
      const r = (st === 'seen' ? 5.5 : 5) * (1 + q.z * 0.15);
      ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
      ctx.globalAlpha = back ? 0.35 : 1;
      if (st === 'seen') { ctx.fillStyle = '#c44a2f'; ctx.fill(); }
      else if (st === 'told') { ctx.fillStyle = '#fff'; ctx.fill(); ctx.setLineDash([]); ctx.strokeStyle = '#c44a2f'; ctx.lineWidth = 2; ctx.stroke(); }
      else { ctx.fillStyle = '#fff'; ctx.fill(); ctx.setLineDash([2, 2]); ctx.strokeStyle = '#9aa3ad'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]); }
      if (this.selected === L.id) {
        ctx.beginPath(); ctx.arc(q.x, q.y, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = '#1f2a3a'; ctx.lineWidth = 1.5; ctx.globalAlpha = 1; ctx.stroke();
      }
      if (!back && (showLabels || this.selected === L.id) && q.z > 0.35) {
        ctx.globalAlpha = Math.min(1, (q.z - 0.35) * 2.5);
        ctx.font = (this.selected === L.id ? '600 ' : '') + '11px "Hiragino Sans", sans-serif';
        ctx.fillStyle = '#1f2a3a'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        const label = L.point.title.length > 12 ? L.point.title.slice(0, 12) + '…' : L.point.title;
        const w = ctx.measureText(label).width;
        if (q.x + r + 4 + w > this.w - 8) { ctx.textAlign = 'right'; ctx.fillText(label, q.x - r - 4, q.y); }
        else ctx.fillText(label, q.x + r + 4, q.y);
      }
      ctx.globalAlpha = 1;
    }
  }
}
/* ベクトル補助 */
function norm(v) { const l = Math.hypot(...v) || 1; return v.map(x => x / l); }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function slerp(a, b, t) {
  const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const om = Math.acos(d); if (om < 1e-4) return a;
  const s = Math.sin(om);
  return norm(add(mul(a, Math.sin((1 - t) * om) / s), mul(b, Math.sin(t * om) / s)));
}
