
class Sub {
  constructor(host, vk) { this.host = host; this._vk = vk; this.state = {}; }
  get props() { return this.host.props; }
  get rootEl() {
    if (this._root) return this._root;
    const r = this.host._rootEl;
    return (r && r.querySelector('[data-fd-view="' + this._vk + '"]')) || r;
  }
  set rootEl(v) { this._root = v; }
  setState(u) {
    const p = typeof u === 'function' ? u(this.state) : u;
    this.state = Object.assign({}, this.state, p);
    this.host.forceUpdate();
  }
  forceUpdate() { this.host.forceUpdate(); }
}
class LandLogic extends Sub {
  state = { dark: null };
  isDark() {
    if (this.state && this.state.dark != null) return this.state.dark;
    try { const s = localStorage.getItem('fd-landing-dark'); if (s != null) return s === '1'; } catch (e) {}
    return true;
  }
  urlFor() {
    return this.isDark()
      ? '/v2/media/hero-dark.mp4'
      : '/v2/media/hero-light.mp4';
  }
  renderVals() {
    const dark = this.isDark();
    // Original NovaAI material system — identical in both modes; the toggle only swaps the video
    const t = {
      bg: '#0a0a0a', overlay: 'rgba(0,0,0,0.2)',
      ink: '#ffffff', ink90: 'rgba(255,255,255,0.9)', ink85: 'rgba(255,255,255,0.85)', ink80: 'rgba(255,255,255,0.8)',
      ink70: 'rgba(255,255,255,0.7)', ink60: 'rgba(255,255,255,0.6)', ink55: 'rgba(255,255,255,0.55)', ink40: 'rgba(255,255,255,0.4)',
      glass15: 'rgba(255,255,255,0.15)', glass10: 'rgba(255,255,255,0.10)', glassHover: 'rgba(255,255,255,0.25)', glassHover20: 'rgba(255,255,255,0.2)',
      line15: 'rgba(255,255,255,0.15)', line20: 'rgba(255,255,255,0.2)', line25: 'rgba(255,255,255,0.25)',
      shadowS: '0 2px 4px rgba(0,0,0,0.35)', shadowL: '0 4px 12px rgba(0,0,0,0.45)',
      ctaBg: '#ffffff', ctaFg: '#000000', ctaHoverBg: 'rgba(255,255,255,0.85)',
    };
    const navSolid = (this.props.navCtaStyle ?? 'glass') === 'solid';
    return {
      dark, notDark: !dark, ...t,
      navBtnBg: navSolid ? t.ctaBg : t.glass15,
      navBtnFg: navSolid ? t.ctaFg : t.ink,
      navBtnBorder: navSolid ? 'transparent' : t.line20,
      navBtnHover: navSolid ? t.ctaHoverBg : t.glassHover,
      navBtnBlur: navSolid ? 'none' : 'blur(20px) saturate(160%)',
      toggleMode: () => {
        const next = !this.isDark();
        try { localStorage.setItem('fd-landing-dark', next ? '1' : '0'); } catch (e) {}
        this.setState({ dark: next });
      },
      videoRef: (el) => { this.videoEl = el; if (el) this._trySetup(); },
      canvasRef: (el) => { this.canvasEl = el; if (el) this._trySetup(); },
    };
  }
  componentDidMount() {
    this._seen = new WeakSet(); // per-instance, so a remount re-observes every node
    this._shown = [];
    this._io = new IntersectionObserver((entries) => {
      entries.forEach((e) => this._reveal(e.target, e.isIntersecting));
    }, { threshold: 0.15 });
    this._observeReveals();
    this._checkReveals();
    // host re-renders can restore the inline opacity:0, so revealed nodes are re-asserted
    this._revT = setInterval(() => { if (this._dead) return; this._checkReveals(); this._reassert(); }, 120);
    this._trySetup();
  }
  _reveal(el, on) {
    if (!el) return;
    if (!this._shown) this._shown = [];
    const i = this._shown.indexOf(el);
    if (on && i < 0) this._shown.push(el);
    if (!on && i >= 0) this._shown.splice(i, 1);
    // attribute, not inline style: host re-renders would restore the CSS default
    if (on) el.setAttribute('data-shown', '1'); else el.removeAttribute('data-shown');
  }
  _reassert() {
    (this._shown || []).forEach((el) => { if (el.getAttribute('data-shown') !== '1') el.setAttribute('data-shown', '1'); });
  }
  _checkReveals() {
    const root = this.rootEl;
    if (!root || root.offsetParent === null && root.style.display === 'none') return;
    const vh = window.innerHeight || 800;
    root.querySelectorAll('[data-reveal]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.height === 0 && r.width === 0) return;
      if (r.top < vh * 0.92 && r.bottom > vh * 0.06) this._reveal(el, true);
    });
  }
  _observeReveals() {
    if (!this._io) return;
    const root = this.rootEl || document;
    root.querySelectorAll('[data-reveal]').forEach((el) => {
      if (!this._seen.has(el)) { this._seen.add(el); this._io.observe(el); }
    });
  }
  _trySetup() {
    if (this._dead) return;
    if (this.videoEl && this.canvasEl) { this.setupVideo(); return; }
    clearTimeout(this._setupT);
    this._setupT = setTimeout(() => this._trySetup(), 200); // refs not attached yet — poll
  }
  componentDidUpdate() {
    if (this._io) this._observeReveals();
    this._reassert();
    this._checkReveals();
    if (this._loadVideo) { const u = this.urlFor(); if (u !== this._activeUrl) this._loadVideo(u); }
  }
  componentWillUnmount() {
    this._dead = true;
    if (this._io) this._io.disconnect();
    clearInterval(this._revT);
    if (this._raf) cancelAnimationFrame(this._raf);
    clearTimeout(this._setupT);
    clearTimeout(this._stallT);
  }
  setupVideo() {
    const video = this.videoEl, canvas = this.canvasEl;
    if (!video || !canvas) return;
    if (this._setupEl === video) return; // already wired to this element
    this._setupEl = video;
    if (this._raf) cancelAnimationFrame(this._raf);
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    };
    resize();
    let smoothed = 0, frames = null, duration = 0, lastSeek = -1;
    const drawCover = (src, sw, sh) => {
      if (!sw || !sh) return;
      const cw = canvas.width, ch = canvas.height;
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, cw, ch);
      // edges: blurred cover-scaled copy of the frame -> soft gradient matching the video
      const cs = Math.max(cw / sw, ch / sh) * 1.15;
      ctx.filter = 'blur(' + Math.round(cw * 0.03) + 'px)';
      ctx.drawImage(src, cw - sw * cs, (ch - sh * cs) / 2, sw * cs, sh * cs); // right-anchored like the sharp frame
      ctx.filter = 'none';
      const s = Math.min(cw / sw, ch / sh); // contain: center
      const dw = Math.round(sw * s), dh = Math.round(sh * s);
      // feather the contained frame's edges so it melts into the blurred backdrop
      if (!this._fc) { this._fc = document.createElement('canvas'); this._fcx = this._fc.getContext('2d'); }
      const fc = this._fc, fx = this._fcx;
      if (fc.width !== dw || fc.height !== dh) { fc.width = dw; fc.height = dh; }
      fx.clearRect(0, 0, dw, dh);
      fx.drawImage(src, 0, 0, dw, dh);
      fx.globalCompositeOperation = 'destination-in';
      if (dw < cw - 2) { // right-anchored: one wide, soft feather on the left edge only
        const fe = Math.min(dw * 0.45, dw - 1);
        const g = fx.createLinearGradient(0, 0, dw, 0);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(fe / dw, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,1)');
        fx.fillStyle = g; fx.fillRect(0, 0, dw, dh);
      }
      if (dh < ch - 2) {
        const fe = Math.round(Math.min(dw, dh) * 0.15);
        const g = fx.createLinearGradient(0, 0, 0, dh);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(fe / dh, 'rgba(0,0,0,1)');
        g.addColorStop(1 - fe / dh, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        fx.fillStyle = g; fx.fillRect(0, 0, dw, dh);
      }
      fx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = this.props.videoOpacity ?? 0.75;
      ctx.drawImage(fc, cw - dw, (ch - dh) / 2);
      ctx.globalAlpha = 1;
    };
    const loop = () => {
      if (this._dead) return; // this instance was unmounted — stop
      this._tick = (this._tick || 0) + 1;
      if (this._tick % 30 === 0) this._observeReveals(); // pick up late-hydrated nodes
      const u = this.urlFor();
      if (this._loadVideo && u !== this._activeUrl) this._loadVideo(u); // theme switched
      resize();
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const target = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      const k = this.props.scrubSmoothing ?? 0.12;
      smoothed += (target - smoothed) * k;
      if (frames && frames.length) {
        const f = frames[Math.min(frames.length - 1, Math.round(smoothed * (frames.length - 1)))];
        drawCover(f, f.width, f.height);
      } else if (duration > 0) {
        const t = smoothed * Math.max(0, duration - 0.05);
        if (Math.abs(t - lastSeek) > 0.04) { try { video.currentTime = t; } catch (e) {} lastSeek = t; }
        if (video.readyState >= 2) drawCover(video, video.videoWidth, video.videoHeight);
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._loadVideo = (url) => {
      this._activeUrl = url;
      frames = null; duration = 0; lastSeek = -1;
      let triedNoCors = false;
      canvas.style.opacity = '0'; video.style.opacity = '1';
      if (this._vh) { video.removeEventListener('loadedmetadata', this._vh[0]); video.removeEventListener('loadeddata', this._vh[1]); video.removeEventListener('error', this._vh[2]); }
      const onMeta = () => { duration = video.duration || 0; };
      const onData = () => {
        canvas.style.opacity = '1';
        video.style.opacity = '0';
        if (this.props.frameCache ?? true) {
          setTimeout(() => {
            this.extractFrames(url, video.duration).then((f) => { if (f && f.length && this._activeUrl === url) frames = f; });
          }, 300);
        }
      };
      const onErr = () => {
        if (!triedNoCors) {
          triedNoCors = true;
          video.removeAttribute('crossorigin');
          video.src = url;
          video.load();
        }
      };
      this._vh = [onMeta, onData, onErr];
      video.addEventListener('loadedmetadata', onMeta);
      video.addEventListener('loadeddata', onData, { once: true });
      video.addEventListener('error', onErr);
      video.crossOrigin = 'anonymous';
      video.src = url;
      video.load();
      clearTimeout(this._stallT);
      this._stallT = setTimeout(() => { // stalled without even metadata: retry without CORS mode
        if (video.readyState === 0 && this._activeUrl === url) onErr();
      }, 8000);
    };
    this._loadVideo(this.urlFor());
    loop();
  }
  async extractFrames(url, durationHint) {
    try {
      const v = document.createElement('video');
      v.crossOrigin = 'anonymous'; v.muted = true; v.preload = 'auto'; v.src = url;
      await new Promise((res, rej) => {
        v.addEventListener('loadeddata', res, { once: true });
        v.addEventListener('error', rej, { once: true });
      });
      const d = v.duration || durationHint || 0;
      if (!d || !v.videoWidth) return null;
      const count = Math.min(90, Math.max(24, Math.round(d * 12)));
      const scale = Math.min(1, 960 / v.videoWidth);
      const w = Math.round(v.videoWidth * scale), h = Math.round(v.videoHeight * scale);
      const off = document.createElement('canvas'); off.width = w; off.height = h;
      const octx = off.getContext('2d');
      const out = [];
      for (let i = 0; i < count; i++) {
        v.currentTime = (i / (count - 1)) * Math.max(0, d - 0.05);
        await new Promise((res) => v.addEventListener('seeked', res, { once: true }));
        octx.drawImage(v, 0, 0, w, h);
        out.push(await createImageBitmap(off));
      }
      return out;
    } catch (e) { return null; }
  }
}
class AppLogic extends Sub {
  state = { screen: null, dark: null, q: '', dq: '', dsExp: {}, aOpen: {}, sel: {}, exp: {}, mOpen: {}, ttl: '1h', prin: { root: true, vibe: false }, leftOpen: true, rightOpen: true, videoOn: null };
  isDark() {
    if (this.state.dark != null) return this.state.dark;
    try { const s = localStorage.getItem('fd-landing-dark'); if (s != null) return s === '1'; } catch (e) {}
    return true;
  }
  componentDidUpdate() {
    if (this._video) this._video.playbackRate = this.props.videoSpeed ?? 1;
    if (this._thread && this._threadKey !== this._nextThreadKey) { this._threadKey = this._nextThreadKey; this._thread.scrollTop = this._thread.scrollHeight; }
  }
  componentDidMount() {
    if (this._thread) this._thread.scrollTop = this._thread.scrollHeight;
    this._esc = (e) => {
      if (e.key !== 'Escape') return;
      if (this.state.termMenu) this.setState({ termMenu: false });
      else if (this.state.termOpen) this.setState({ termOpen: null });
      else if (this.state.busMax) this.setState({ busMax: false });
    };
    window.addEventListener('keydown', this._esc);
  }
  componentWillUnmount() { if (this._esc) window.removeEventListener('keydown', this._esc); if (this._busRO) this._busRO.disconnect(); }
  renderVals() {
    const dark = this.isDark();
    const useColor = this.props.statusColors ?? true;
    const compact = (this.props.density ?? 'comfortable') === 'compact';
    const screen = this.state.screen ?? this.props.screen ?? 'bus';
    const mono = "ui-monospace,'SF Mono',Menlo,monospace";
    const t = dark ? {
      bgAll: '#0a0a0a', overlay: 'rgba(0,0,0,0.4)', videoOpacity: 0.55,
      videoUrl: '/v2/media/hero-dark.mp4',
      side: 'rgba(10,10,10,0.18)', panel: 'rgba(255,255,255,0.08)', panelHead: 'rgba(255,255,255,0.05)',
      line: 'rgba(255,255,255,0.13)', lineSoft: 'rgba(255,255,255,0.07)',
      ink: '#ffffff', ink75: 'rgba(255,255,255,0.75)', ink60: 'rgba(255,255,255,0.6)', ink45: 'rgba(255,255,255,0.45)', ink35: 'rgba(255,255,255,0.35)',
      hoverBg: 'rgba(255,255,255,0.07)', chipBg: 'rgba(255,255,255,0.07)',
      navActBg: 'rgba(255,255,255,0.11)', navActBorder: 'rgba(255,255,255,0.22)',
      ctaBg: '#ffffff', ctaFg: '#0a0a0a', ctaHover: 'rgba(255,255,255,0.85)',
      inputBg: 'rgba(255,255,255,0.05)', codeBg: 'rgba(0,0,0,0.4)', track: 'rgba(255,255,255,0.10)',
      good: 'oklch(0.83 0.15 155)', warn: 'oklch(0.83 0.14 80)', bad: 'oklch(0.73 0.17 25)',
      goodBg: 'oklch(0.83 0.15 155 / 0.10)', warnBg: 'oklch(0.83 0.14 80 / 0.10)', badBg: 'oklch(0.73 0.17 25 / 0.10)',
      panelShadow: 'none',
    } : {
      bgAll: '#f2f1ee', overlay: 'rgba(242,241,238,0.55)', videoOpacity: 0.5,
      videoUrl: '/v2/media/hero-light.mp4',
      side: 'rgba(255,255,255,0.28)', panel: 'rgba(255,255,255,0.55)', panelHead: 'rgba(255,255,255,0.35)',
      line: 'rgba(0,0,0,0.13)', lineSoft: 'rgba(0,0,0,0.07)',
      ink: '#111111', ink75: 'rgba(17,17,17,0.78)', ink60: 'rgba(17,17,17,0.62)', ink45: 'rgba(17,17,17,0.47)', ink35: 'rgba(17,17,17,0.38)',
      hoverBg: 'rgba(0,0,0,0.045)', chipBg: 'rgba(0,0,0,0.045)',
      navActBg: 'rgba(0,0,0,0.07)', navActBorder: 'rgba(0,0,0,0.18)',
      ctaBg: '#111111', ctaFg: '#ffffff', ctaHover: '#333333',
      inputBg: 'rgba(0,0,0,0.03)', codeBg: 'rgba(0,0,0,0.045)', track: 'rgba(0,0,0,0.09)',
      good: 'oklch(0.52 0.14 155)', warn: 'oklch(0.55 0.13 70)', bad: 'oklch(0.53 0.18 25)',
      goodBg: 'oklch(0.52 0.14 155 / 0.09)', warnBg: 'oklch(0.55 0.13 70 / 0.09)', badBg: 'oklch(0.53 0.18 25 / 0.09)',
      panelShadow: '0 1px 2px rgba(0,0,0,0.04)',
    };
    if (!useColor) {
      t.good = t.ink75; t.warn = t.ink60; t.bad = t.ink;
      t.goodBg = t.chipBg; t.warnBg = t.chipBg; t.badBg = t.chipBg;
    }
    const dot = (c) => ({ width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0, background: c });
    const pill = (fg, bg) => ({ display: 'inline-flex', alignItems: 'center', gap: '6px', borderRadius: '9999px', border: '1px solid transparent', background: bg, color: fg, padding: '3px 10px', fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap', fontWeight: 500 });
    const chipTone = (tone) => tone === 'good' ? pill(t.good, t.goodBg) : tone === 'warn' ? pill(t.warn, t.warnBg) : tone === 'bad' ? pill(t.bad, t.badBg) : pill(t.ink75, t.chipBg);
    let videoOn = this.state.videoOn;
    if (videoOn == null) { try { const s = localStorage.getItem('fd-app-video'); videoOn = s == null ? true : s === '1'; } catch (e) { videoOn = true; } }
    const leftOpen = this.state.leftOpen !== false;
    const rightOpen = this.state.rightOpen !== false;
    const navBtn = (act) => ({ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: leftOpen ? 'flex-start' : 'center', gap: leftOpen ? '10px' : '0', width: '100%', textAlign: 'left', borderRadius: '9999px', padding: leftOpen ? '8px 14px' : '9px 0', fontSize: '13px', cursor: 'pointer', border: '1px solid ' + (act ? t.navActBorder : 'transparent'), background: act ? t.navActBg : 'transparent', color: act ? t.ink : t.ink60, transition: 'background .2s', boxSizing: 'border-box', fontWeight: act ? 500 : 400 });
    const check = (on) => ({ width: '16px', height: '16px', borderRadius: '4px', border: '1px solid ' + (on ? 'transparent' : t.line), background: on ? t.ctaBg : 'transparent', color: t.ctaFg, cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', transition: 'background .15s' });
    const barFill = (pct, tone) => ({ display: 'block', height: '100%', width: (pct == null ? 0 : pct) + '%', borderRadius: '2px', background: tone });
    const bar = (label, pct, resets, stale) => {
      const tone = pct == null ? t.ink35 : pct >= 70 ? t.warn : t.good;
      return { label, resets: resets || '', fillStyle: barFill(pct, tone),
        right: stale ? 'stale' : (pct == null ? '—' : pct + '%'),
        rightStyle: { fontSize: '11px', textAlign: 'right', whiteSpace: 'nowrap', color: stale ? t.warn : (pct == null ? t.ink35 : t.ink75) } };
    };
    const spark = (arr) => arr.map((v, i) => ((i / (arr.length - 1)) * 100).toFixed(1) + ',' + (22 - v * 2)).join(' ');
    const goneName = { fontFamily: mono, fontSize: '12.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
    const titles = FD.fixture.titles;
    // Desktop sessions
    const hex = (seed, n) => { let s = seed * 2654435761 % 4294967296; let o = ''; while (o.length < n) { s = (s * 1103515245 + 12345) % 4294967296; o += s.toString(16).padStart(8, '0'); } return o.slice(0, n); };
    const uuid = (seed) => hex(seed, 8) + '-' + hex(seed + 1, 4) + '-4' + hex(seed + 2, 3) + '-' + hex(seed + 3, 4) + '-' + hex(seed + 4, 12);
    const dsData = Array.isArray(FD.fixture.dsData) ? FD.fixture.dsData : [];
    // toLocaleLowerCase on both sides, as today's sessions.js matches (BEHAVIOUR 2).
    const dq = (this.state.dq || '').trim().toLocaleLowerCase();
    const dsExp = this.state.dsExp || {};
    let dsCount = 0, dsLive = 0, dsGroups;
    const liveRows = [];
    const iconBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', flexShrink: 0, borderRadius: '9999px', border: '1px solid ' + t.line, background: 'transparent', color: t.ink75, cursor: 'pointer', padding: 0, transition: 'background .15s' };
    // L10: the screen slice registers rowAction only in live mode, so fixture
    // mode keeps the mock's own handlers untouched and pixel-identical.
    const dsAct = (FD.screens && FD.screens.desktop && FD.screens.desktop.rowAction) || null;
    const dsRow = (g, gi, r, ri, where) => {
      const key = gi + '-' + ri; const open = !!dsExp[key]; const seed = gi * 100 + ri * 7 + 3;
      // The mock invents a CLI/session id for seed rows that lack one. That is right
      // for the mock and wrong for live data: sessions.js:199-202 OMITS a details row
      // whose value is absent rather than showing a plausible invention as fact.
      // dsAct is registered only in live mode, so it is exactly the "is this real" test.
      const cli = r.cli || (dsAct ? '' : uuid(seed));
      const sid = r.sid || (dsAct ? '' : 'local_' + uuid(seed + 40));
      // Live rows can arrive without a cwd; the mock's seed always has one.
      const path = r.path || '';
      const cut = path.lastIndexOf('/') + 1;
      // liveState is 'live' | 'offline' | 'unknown' and only the live feed sets it.
      const st = r.liveState || (r.live ? 'live' : 'offline');
      // The two disabled texts, verbatim from sessions.js:246.
      const offText = st === 'unknown' ? 'Live check unavailable' : 'Not running';
      return {
        title: r.title, dir: path.slice(0, cut), leaf: path.slice(cut), branch: r.branch, model: r.model, when: r.when, turns: r.turns,
        where: where ? g.name + ' · ' + g.machine : '',
        live: !!r.live, notLive: !r.live,
        status: st === 'live' ? 'Live' : st === 'unknown' ? 'Live unknown' : 'Offline',
        pillStyle: chipTone(st === 'live' ? 'good' : 'neutral'), dotStyle: dot(st === 'live' ? t.good : t.ink35),
        open, chevStyle: { transition: 'transform .2s', transform: open ? 'rotate(90deg)' : 'none', color: t.ink45, flexShrink: 0, marginTop: '3px' },
        toggle: () => { const e2 = { ...(this.state.dsExp || {}) }; e2[key] = !e2[key]; this.setState({ dsExp: e2 }); },
        stop: (e) => e.stopPropagation(),
        show: (e) => { e.stopPropagation(); if (dsAct) return dsAct('show', r, e.currentTarget); if (r.live && this._openTerm) this._openTerm(r.title, g.machine); },
        message: (e) => { e.stopPropagation(); if (dsAct) return dsAct('message', r, e.currentTarget); if (r.live) this.setState({ screen: 'bus', busActive: 'desktop' }); },
        // BEHAVIOUR §3: when a row cannot be messaged, today's app shows a text in the
        // action cell — 'Live check unavailable' for liveState 'unknown', else 'Not
        // running' (sessions.js:246). The mock replaced that cell with two icon buttons
        // and a static aria-label, so `title` is the only slot left to carry it, and it
        // carries the string verbatim. Live mode only (dsAct): in fixture mode there is
        // no liveState and the mock's own copy is the mock's look, which also keeps the
        // compiled DOM byte-identical for S2's attribute parity gate.
        showTitle: st === 'live' ? 'Show session' : dsAct ? offText : 'Show — session is not running',
        msgTitle: st === 'live' ? 'Message this session' : dsAct ? offText : 'Message — session is not running',
        liveBtnStyle: st === 'live' ? iconBtn : { ...iconBtn, opacity: 0.3, cursor: 'not-allowed' },
        details: [{ k: 'Created', v: r.created }, { k: 'CLI session', v: cli }, { k: 'Session', v: sid }, { k: 'Full path', v: path }]
          .concat(r.worktree ? [{ k: 'Worktree', v: r.worktree }] : [])
          .filter((d) => d.v),
        copy: (e) => { e.stopPropagation(); if (dsAct) return dsAct('copy', r, e.currentTarget); try { navigator.clipboard.writeText(r.title + '\n' + path + '\n' + r.branch + '\ncli=' + cli + '\nsession=' + sid); } catch (e2) {} },
        copyConv: (e) => { e.stopPropagation(); if (dsAct) return dsAct('copyConv', r, e.currentTarget); try { navigator.clipboard.writeText('# ' + r.title + '\n' + r.model + ' · ' + r.turns + ' · ' + r.branch + '\n\n[conversation transcript for ' + sid + ']'); } catch (e2) {} },
      };
    };
    // S2 oracle audit F2 (2026-09-08, binding instruction 2): a throw anywhere in
    // renderVals makes the runtime render with vals = host.props, which turns every
    // sc-if false and empties every list — one malformed row from one slice blanks
    // all nine screens. So this block cannot throw: every field access on an
    // incoming row is guarded, and if one still does, the screen keeps its last
    // good values instead of taking the whole app down with it.
    try {
      dsGroups = dsData.filter((g) => g && Array.isArray(g.rows)).map((g, gi) => {
        const kept = g.rows.map((r, ri) => [r, ri]).filter(([r]) => r && (!dq
          || [r.title, r.path, r.worktree, r.branch, r.model]
            .filter((v) => typeof v === 'string').join(' ').toLocaleLowerCase().includes(dq)));
        kept.forEach(([r, ri]) => { dsCount++; if (r.live) { dsLive++; liveRows.push(dsRow(g, gi, r, ri, true)); } });
        const rows = kept.sort((a, b) => (b[0].live ? 1 : 0) - (a[0].live ? 1 : 0)).map(([r, ri]) => dsRow(g, gi, r, ri, false));
        return { name: g.name, sub: g.email + ' · ' + g.acct, machine: g.machine, n: rows.length, rows, isLive: false };
      }).filter((g) => g.rows.length > 0);
      if (liveRows.length) dsGroups.unshift({ name: 'Live now', sub: 'can receive a message on the next turn', machine: '', n: liveRows.length, rows: liveRows, isLive: true });
      this._dsLastGood = { dsGroups, dsCount, dsLive };
    } catch (e) {
      console.error('[fd-v2 l10] desktop rows failed to render; keeping the last good view', e);
      const last = this._dsLastGood || { dsGroups: [], dsCount: 0, dsLive: 0 };
      dsGroups = last.dsGroups; dsCount = last.dsCount; dsLive = last.dsLive;
    }
    // Registry data + selection
    const regData = FD.fixture.regData;
    const q = (this.state.q || '').toLowerCase();
    const filtered = regData.filter((r) => !q || (r.s + ' ' + r.g + ' ' + r.tk).toLowerCase().includes(q));
    const sel = this.state.sel || {};
    const selCount = filtered.filter((r) => sel[r.id]).length;
    const stTone = (st) => st === 'active' ? 'good' : st === 'kill-requested' ? 'warn' : 'dim';
    const regRows = filtered.map((r) => {
      const tone = stTone(r.st);
      const dim = r.gone;
      return {
        s: r.s, g: r.g, t: r.tk, st: r.st, active: r.active, msg: r.msg, seen: r.seen, sel: !!sel[r.id],
        toggle: () => { const s2 = { ...(this.state.sel || {}) }; s2[r.id] = !s2[r.id]; this.setState({ sel: s2 }); },
        checkStyle: check(!!sel[r.id]),
        nameStyle: { ...goneName, color: dim ? t.ink45 : t.ink },
        cellStyle: { fontSize: '12.5px', color: dim ? t.ink35 : t.ink60, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
        taskStyle: r.tk === '—' ? { fontSize: '12.5px', color: t.ink35 } : { fontSize: '12.5px', color: dim ? t.ink45 : t.ink, textDecoration: 'underline', textUnderlineOffset: '3px', textDecorationColor: t.ink35, whiteSpace: 'nowrap', cursor: 'pointer' },
        pillStyle: chipTone(tone === 'dim' ? 'neutral' : tone),
        stDotStyle: dot(tone === 'good' ? t.good : tone === 'warn' ? t.warn : t.ink35),
      };
    });
    // Sessions sidebar
    const gbSessions = ['FD-deck11-boardroot', 'FD-deck25-gate', 'FD-deck26-launcher', 'FD-deck27-notifycron', 'FD-desktop-sessions-p…', 'FD-gb-home', 'FD-gk-l1-ledger', 'FD-gk-l2-sessionkind', 'FD-gk-l3-skill', 'FD-gk-l4-sweep', 'FD-gk-l5-hooks', 'FD-gk-l6-goalspage', 'FD-rhoda-machines'];
    // Org cards
    const orgMeta = (epoch, lease, leaseTone, age, exp, expTone) => [
      { k: 'epoch', v: epoch, vs: { fontSize: '11.5px', color: t.ink75, fontFamily: mono, whiteSpace: 'nowrap' } },
      { k: 'lease', v: lease, vs: { fontSize: '11.5px', color: leaseTone, whiteSpace: 'nowrap' } },
      { k: 'age', v: age, vs: { fontSize: '11.5px', color: t.ink75, whiteSpace: 'nowrap' } },
      { k: 'expires', v: exp, vs: { fontSize: '11.5px', color: expTone, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
    ];
    const orgCard = (name, on, role, path, grp, epoch, lease, leaseTone, age, exp, expTone) => ({
      name, role, path, grp, badge: 'idle 15m+',
      dotStyle: dot(on ? t.good : t.warn),
      badgeStyle: { ...chipTone('warn'), marginLeft: 'auto' },
      meta: orgMeta(epoch, lease, leaseTone, age, exp, expTone),
    });
    // Bus: sessions, threads, composer
    const busSessions = FD.fixture.busSessions;
    const busGroups = [{ id: 'b-train84', name: 'train-84', members: ['constantin', 'ermenhild', 'christa', 'dorothea'], pinned: true }, ...(this.state.adhoc || [])];
    const sById = (id) => busSessions.find((s) => s.id === id);
    const short = (id) => { const s = sById(id); if (!s) return id; return /^(LC|FD)-/.test(s.name) ? s.name.slice(3).split('-')[0] : s.name; };
    const seedThreads = FD.fixture.seedThreads;
    const extra = this.state.extraMsgs || {};
    const stOv = this.state.stOv || {};
    const thread = (id) => [...(seedThreads[id] || []), ...(extra[id] || [])];
    const stOf = (m, mid) => mid ? (stOv[m.k + ':' + mid] ?? m.per[mid]) : (stOv[m.k] ?? m.status);
    const stColor = { queued: t.ink45, delivered: t.ink75, acked: t.good, failed: t.bad, offline: t.warn };
    const stLabel = { queued: 'queued', delivered: 'delivered', acked: 'acked', failed: 'failed', offline: 'queued · offline' };
    const receipt = (name, st, err) => ({ t: (name ? name + ' · ' : '') + stLabel[st] + (err && st === 'failed' ? ' · ' + err : ''), dotStyle: dot(stColor[st]), style: { display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: st === 'failed' ? t.bad : st === 'offline' ? t.warn : t.ink45, whiteSpace: 'nowrap', fontFamily: name ? mono : 'inherit' } });
    const setSt = (k, st) => this.setState((s) => ({ stOv: { ...(s.stOv || {}), [k]: st } }));
    const unread = this.state.unread || { dorothea: 1 };
    const active = this.state.busActive || 'ermenhild';
    const busQ = (this.state.busQ || '').toLowerCase();
    const selecting = !!this.state.selecting;
    const busSel = this.state.busSel || {};
    const pins = this.state.pins || {};
    const isPinned = (x) => pins[x.id] != null ? pins[x.id] : !!x.pinned;
    const lastOf = (id) => { const th = thread(id); return th[th.length - 1]; };
    const arrive = (sid, text) => {
      const name = sById(sid).name;
      this.setState((s) => {
        const ex = { ...(s.extraMsgs || {}) };
        ex[sid] = [...(ex[sid] || []), { k: 'r' + Date.now() + sid, dir: 'in', from: name, at: 'just now', m: 0, text }];
        const viewing = (s.screen ?? this.props.screen ?? 'windows') === 'bus' && (s.busActive || 'ermenhild') === sid;
        const un = { ...(s.unread || { dorothea: 1 }) };
        if (!viewing) un[sid] = (un[sid] || 0) + 1;
        return { extraMsgs: ex, unread: un, toast: viewing ? s.toast : { sid, from: name, text } };
      });
      setTimeout(() => this.setState((s) => (s.toast && s.toast.from === name ? { toast: null } : null)), 7000);
    };
    const deliverTo = (sid, key, text, i) => {
      const s = sById(sid);
      if (!s.live) return;
      setTimeout(() => setSt(key, 'delivered'), 900 + i * 250);
      setTimeout(() => setSt(key, 'acked'), 3000 + i * 450);
      setTimeout(() => arrive(sid, 'ACK. Received: "' + text.slice(0, 72) + (text.length > 72 ? '…' : '') + '" — applying on this turn.'), 5200 + i * 800);
    };
    const mkRow = (x, isGroup) => {
      const last = lastOf(x.id); const un = unread[x.id] || 0; const act = active === x.id;
      return {
        id: x.id, name: x.name, when: last ? last.at : '',
        preview: last ? (last.dir === 'out' ? 'You: ' : '') + last.text : (isGroup ? x.members.length + ' sessions' : 'No messages yet'),
        previewStyle: { flex: 1, minWidth: 0, fontSize: '11px', color: un ? t.ink75 : t.ink45, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
        hasUnread: un > 0, unread: un,
        dotStyle: isGroup ? { width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0, border: '1.5px solid ' + t.ink60, boxSizing: 'border-box', marginTop: '5px' } : { ...dot(x.live ? t.good : t.ink35), marginTop: '5px' },
        rowStyle: { display: 'flex', alignItems: 'flex-start', gap: '9px', width: '100%', textAlign: 'left', borderRadius: '10px', border: '1px solid ' + (act ? t.navActBorder : 'transparent'), background: act ? t.navActBg : 'transparent', padding: compact ? '6px 8px' : '8px 8px', cursor: 'pointer', boxSizing: 'border-box', color: t.ink, transition: 'background .15s' },
        nameStyle: { fontFamily: mono, fontSize: '12px', fontWeight: un ? 600 : 500, color: t.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 },
        open: () => { const un2 = { ...unread }; un2[x.id] = 0; this.setState({ busActive: x.id, unread: un2 }); },
        showCheck: selecting && !isGroup, checkStyle: { ...check(!!busSel[x.id]), marginTop: '1px' },
        toggleSel: (e) => { e.stopPropagation(); const b = { ...busSel }; b[x.id] = !b[x.id]; this.setState({ busSel: b }); },
      };
    };
    const match = (x) => !busQ || (x.name + ' ' + (x.host || '')).toLowerCase().includes(busQ);
    const pinnedItems = [...busGroups.filter(isPinned), ...busSessions.filter(isPinned)].filter(match);
    const recentItems = [...busGroups.filter((g) => !isPinned(g)), ...busSessions.filter((s) => !isPinned(s))].filter(match)
      .sort((a, b) => { const la = lastOf(a.id), lb = lastOf(b.id); return (la ? la.m : 1e9) - (lb ? lb.m : 1e9); });
    const railGroups = [{ label: 'Pinned', items: pinnedItems.map((x) => mkRow(x, !!x.members)) }, { label: 'Recent', items: recentItems.map((x) => mkRow(x, !!x.members)) }].filter((g) => g.items.length);
    const actGroup = busGroups.find((g) => g.id === active);
    const actS = sById(active) || busSessions[0];
    const thOffline = !actGroup && !actS.live;
    const reader = !!this.state.busReader;
    const busMax = !!this.state.busMax;
    const bubbleMe = dark ? 'rgba(255,255,255,0.16)' : 'rgba(17,17,17,0.09)';
    const bubbleThem = dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.65)';
    const thMsgs = thread(active).map((m) => {
      const out = m.dir === 'out';
      const st = out && !m.per ? stOf(m) : null;
      const open = !out && reader;
      return {
        from: m.from, at: out ? m.from + ' · ' + m.at : m.at, text: m.text,
        showFrom: !out,
        rowStyle: { display: 'flex', justifyContent: out ? 'flex-end' : 'flex-start', minWidth: 0 },
        wrapStyle: out
          ? { display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '16px 16px 4px 16px', background: bubbleMe, padding: '9px 14px 7px 14px', maxWidth: reader ? '60%' : '72%', minWidth: 0, boxSizing: 'border-box' }
          : open
            ? { display: 'flex', flexDirection: 'column', gap: '6px', padding: '6px 0', width: '100%', maxWidth: '820px', minWidth: 0, boxSizing: 'border-box' }
            : { display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '16px 16px 16px 4px', background: bubbleThem, border: '1px solid ' + t.lineSoft, padding: '9px 14px 7px 14px', maxWidth: '72%', minWidth: 0, boxSizing: 'border-box' },
        fromStyle: { fontFamily: mono, fontSize: open ? '12px' : '11px', color: open ? t.ink60 : t.ink45, fontWeight: 500 },
        textStyle: { margin: 0, fontSize: open ? '15px' : '13px', lineHeight: open ? 1.7 : 1.6, color: t.ink, whiteSpace: 'pre-wrap', textWrap: 'pretty', overflowWrap: 'anywhere' },
        footStyle: { display: 'flex', alignItems: 'center', gap: '6px 12px', flexWrap: 'wrap', justifyContent: out ? 'flex-end' : 'flex-start' },
        receipts: !out ? [] : m.per ? Object.keys(m.per).map((mid) => receipt(short(mid), stOf(m, mid))) : [receipt('', st, m.err)],
        canRetry: st === 'failed',
        retry: () => { setSt(m.k, 'queued'); deliverTo(active, m.k, m.text, 0); },
      };
    });
    this._nextThreadKey = active + ':' + thMsgs.length;
    const drafts = this.state.drafts || {};
    const draft = drafts[active] || '';
    const selIds = busSessions.filter((s) => busSel[s.id]).map((s) => s.id);
    const toRow = selecting && selIds.length > 0;
    const src = this.state.src ?? 'fleetdeck-ui';
    const send = () => {
      const text = draft.trim(); if (!text) return;
      const key = 'x' + Date.now();
      let tid = active, adhoc = this.state.adhoc || [];
      let per = null;
      if (toRow) {
        tid = 'b-' + Date.now();
        adhoc = [...adhoc, { id: tid, name: selIds.map(short).join(', '), members: selIds }];
        per = {}; selIds.forEach((id) => { per[id] = sById(id).live ? 'queued' : 'offline'; });
      } else if (actGroup) {
        per = {}; actGroup.members.forEach((id) => { per[id] = sById(id).live ? 'queued' : 'offline'; });
      }
      const msg = { k: key, dir: 'out', from: src, at: 'just now', m: 0, text, status: per ? undefined : (actS.live ? 'queued' : 'offline'), per };
      const ex = { ...extra }; ex[tid] = [...(ex[tid] || []), msg];
      const d2 = { ...drafts }; d2[active] = '';
      this.setState({ extraMsgs: ex, drafts: d2, adhoc, busActive: tid, selecting: false, busSel: {} });
      if (per) Object.keys(per).forEach((id, i) => deliverTo(id, key + ':' + id, text, i));
      else deliverTo(active, key, text, 0);
    };
    // Full-screen terminal
    const term = this.state.termOpen;
    const termLinesFor = (name) => {
      const leaf = name.replace(/^(LC|FD)-/, '').toLowerCase();
      const L = (kind, txt) => ({ t: txt, style: { color: kind === 'cmd' ? t.ink : kind === 'out' ? t.ink60 : kind === 'note' ? t.ink75 : kind === 'add' ? t.good : kind === 'del' ? t.bad : kind === 'rule' ? t.ink35 : t.ink45, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: kind === 'add' ? t.goodBg : kind === 'del' ? t.badBg : 'transparent', borderRadius: '3px', padding: kind === 'add' || kind === 'del' ? '0 6px' : 0, fontWeight: kind === 'cmd' ? 500 : 400 } });
      return [
        L('cmd', '• Ran git fetch origin && git status --short --branch'),
        L('out', '  └ ## agent-' + leaf + '...origin/main [ahead 2]'),
        L('cmd', '• Started `/root/review_gate`'),
        L('note', '• Reviewer returned one high and two low findings. The high one hinges on whether the route can be served on the plain-http listener; applying the hardening fixes in the same pass.'),
        L('cmd', '• Edited NOTE-' + leaf.toUpperCase() + '.md (+1 −1)'),
        L('out', '     8  Execution paused before implementation: the required issue read is'),
        L('del', '     9 −blocked by an expired app connection. Three consecutive MCP operations'),
        L('add', '     9 +blocked by an app connection requiring reauthentication. Three consecutive MCP operations'),
        L('out', '    10  returned `UNAUTHORIZED`, `oauth_token_invalid_grant`, and'),
        L('cmd', '• Ran git add -- NOTE-' + leaf.toUpperCase() + '.md && git diff --cached --check && git diff --cached --stat'),
        L('out', '  └ NOTE-' + leaf.toUpperCase() + '.md | 35 +++++++++++++++++++++++++++'),
        L('out', '    1 file changed, 35 insertions(+)'),
        L('cmd', '• Waiting for agents'),
        L('cmd', '• Finished waiting'),
        L('out', '  └ No agents completed yet'),
        L('cmd', '• Ran git commit -m "docs(' + leaf + '): record reauthentication gate" && git rev-parse HEAD'),
        L('out', '  └ [agent-' + leaf + ' 41c4965] docs(' + leaf + '): record reauthentication gate'),
        L('out', '    41c4965bc17496d080d3f02d310f406ac71651fa'),
        L('rule', '──────────────────────────────────────────────────────────────'),
        L('note', '• Stopped under the three-failure rule: Linear requires reauthentication (oauth_token_invalid_grant), blocking the mandatory issue read and gate comment.'),
        L('note', '  Reviewed gate record: NOTE-' + leaf.toUpperCase() + '.md, committed locally as 41c4965; unpushed.'),
        L('note', '  No implementation, tests, Linear updates, or live-deck access occurred. Reconnect Linear to resume.'),
        L('rule', '— Worked for 1m 51s ' + '─'.repeat(40)),
      ];
    };
    const openTerm = (name, host, id) => this.setState({ termOpen: { name, host, id: id || null }, termMenu: false });
    const termVals = {
      termOpen: !!term,
      termBg: dark ? 'rgba(10,10,10,0.55)' : 'rgba(242,241,238,0.6)',
      termName: term ? term.name : '', termHost: term ? term.host : '',
      termLines: term ? termLinesFor(term.name) : [],
      termFoot: term ? 'gpt-6-astra xhigh fast · ~/projects/remote-system/.claude/worktrees/' + term.name.replace(/^(LC|FD)-/, '').toLowerCase() + ' · Main [default]' : '',
      termRef: (el) => { if (el) el.scrollTop = el.scrollHeight; },
      closeTerm: () => this.setState({ termOpen: null, termMenu: false }),
      termMessage: () => { const id = term && term.id; this.setState({ termOpen: null, termMenu: false, screen: 'bus', busActive: id || active }); },
      termMenuOpen: !!this.state.termMenu,
      toggleTermMenu: () => this.setState({ termMenu: !this.state.termMenu }),
      termMenuBtnStyle: this.state.termMenu ? { ...iconBtn, background: t.navActBg, borderColor: t.navActBorder, color: t.ink } : iconBtn,
      termSessions: busSessions.filter((s) => s.live && s.id !== 'desktop').map((s) => ({
        name: s.name, host: s.host, dotStyle: dot(t.good),
        style: { display: 'flex', alignItems: 'center', gap: '9px', width: '100%', border: '1px solid ' + (term && term.name === s.name ? t.navActBorder : 'transparent'), background: term && term.name === s.name ? t.navActBg : 'transparent', color: t.ink, borderRadius: '8px', padding: '7px 9px', cursor: 'pointer', boxSizing: 'border-box' },
        open: () => openTerm(s.name, s.host, s.id),
      })),
    };
    this._openTerm = openTerm;
    const busUnread = Object.values(unread).reduce((a, b) => a + b, 0);
    const toast = this.state.toast;
    const narrow = !!this.state.busNarrow && !busMax;
    const busVals = {
      mainStyle: { position: 'relative', zIndex: busMax ? 40 : 1, flex: 1, minWidth: 0, overflowY: 'auto', visibility: this.state.termOpen ? 'hidden' : 'visible' },
      chromeVisible: !busMax && !this.state.termOpen,
      rightChromeVisible: rightOpen && !busMax && !this.state.termOpen,
      pageHeaderStyle: { display: busMax ? 'none' : 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '24px', marginBottom: '22px' },
      busRef: (el) => {
        if (this._busRO) { this._busRO.disconnect(); this._busRO = null; }
        if (el && typeof ResizeObserver !== 'undefined') {
          this._busRO = new ResizeObserver(() => { const n = el.clientWidth < 620; if (n !== !!this.state.busNarrow) this.setState({ busNarrow: n }); });
          this._busRO.observe(el);
        }
      },
      busGridStyle: busMax ? {
        position: 'fixed', inset: '12px', zIndex: 40, display: 'grid', minWidth: 0, overflow: 'hidden',
        gridTemplateColumns: narrow ? 'minmax(0,1fr)' : 'minmax(220px,24%) minmax(0,1fr)',
        gridTemplateRows: narrow ? '160px minmax(0,1fr)' : 'minmax(0,1fr)',
        borderRadius: '14px', border: '1px solid ' + t.line, background: dark ? 'rgba(10,10,10,0.45)' : 'rgba(246,245,242,0.6)', boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
        backdropFilter: 'blur(28px) saturate(150%)', WebkitBackdropFilter: 'blur(28px) saturate(150%)',
      } : {
        display: 'grid', minWidth: 0, overflow: 'hidden',
        minHeight: narrow ? '0' : '520px', height: narrow ? 'auto' : 'calc(100vh - 146px)',
        gridTemplateColumns: narrow ? 'minmax(0,1fr)' : 'minmax(200px,28%) minmax(0,1fr)',
        gridTemplateRows: narrow ? '160px auto' : 'minmax(0,1fr)',
        borderRadius: '12px', border: '1px solid ' + t.line, background: t.panel, boxShadow: t.panelShadow,
        backdropFilter: 'blur(28px) saturate(150%)', WebkitBackdropFilter: 'blur(28px) saturate(150%)',
      },
      busMax, notBusMax: !busMax,
      tipStyle: { position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 5, width: '220px', display: 'flex', flexDirection: 'column', gap: '3px', borderRadius: '10px', border: '1px solid ' + t.line, background: dark ? 'rgba(18,18,18,0.94)' : 'rgba(255,255,255,0.96)', padding: '9px 12px', boxShadow: '0 10px 30px rgba(0,0,0,0.3)', pointerEvents: 'none', textAlign: 'left' },
      thActions: (() => {
        const tip = this.state.tip;
        const onBtn = { ...iconBtn, background: t.navActBg, borderColor: t.navActBorder, color: t.ink };
        const offBtn = { ...iconBtn, opacity: 0.3, cursor: 'not-allowed' };
        const pinned = isPinned(actGroup || actS);
        const canShow = !actGroup && actS.live;
        const list = [
          { id: 'reader', label: reader ? 'Bubbles' : 'Reader view', desc: reader ? 'Show agent replies as chat bubbles again.' : 'Agent replies go full width, no box, larger text — like the desktop app.', style: reader ? onBtn : iconBtn, click: () => this.setState({ busReader: !reader }), isReader: true },
          { id: 'max', label: busMax ? 'Exit full view' : 'Maximize', desc: busMax ? 'Return the message bus to the page. Esc also works.' : 'Expand the whole message bus to fill the window. Esc to exit.', style: busMax ? onBtn : iconBtn, click: () => this.setState({ busMax: !busMax }), isMax: !busMax, isUnmax: busMax },
          { id: 'pin', hide: narrow, label: pinned ? 'Unpin' : 'Pin thread', desc: pinned ? 'Move this thread back into Recent.' : 'Keep this thread at the top of the rail under Pinned.', style: pinned ? onBtn : iconBtn, click: () => { const p = { ...pins }; p[active] = !pinned; this.setState({ pins: p }); }, isPin: true },
          { id: 'show', label: 'Show session', desc: actGroup ? 'Broadcasts have no single terminal. Open a member thread to show it.' : canShow ? 'Open this session\'s live terminal full screen.' : 'Session is not running, so there is no terminal to show.', style: canShow ? iconBtn : offBtn, click: () => { if (canShow) this.setState({ termOpen: { name: actS.name, host: actS.host, id: actS.id }, termMenu: false }); }, isShow: true },
          { id: 'copy', hide: narrow, label: 'Copy thread', desc: 'Copy every message in this thread as plain text.', style: iconBtn, click: () => { try { navigator.clipboard.writeText(thread(active).map((m) => '[' + m.at + '] ' + m.from + ': ' + m.text).join('\n\n')); } catch (e) {} }, isCopy: true },
        ];
        const ordered = list.filter((a) => a.id !== 'max').concat(list.filter((a) => a.id === 'max'));
        return ordered.filter((a) => !a.hide).map((a) => ({ ...a, tipOpen: tip === a.id, enter: () => this.setState({ tip: a.id }), leave: () => this.setState((s) => (s.tip === a.id ? { tip: null } : null)) }));
      })(),
      railStyle: { display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, borderRight: narrow ? 'none' : '1px solid ' + t.lineSoft, borderBottom: narrow ? '1px solid ' + t.lineSoft : 'none' },
      thMetaStyle: { fontSize: '12px', color: t.ink45, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, display: narrow ? 'none' : 'inline' },
      notNarrow: !narrow,
      threadBodyStyle: { flex: 1, minHeight: narrow && !busMax ? '260px' : 0, maxHeight: narrow && !busMax ? '60vh' : 'none', overflowY: 'auto', padding: busMax ? '22px 28px 12px 28px' : '18px 18px 10px 18px', display: 'flex', flexDirection: 'column', gap: reader ? '18px' : '10px' },
      busQ: this.state.busQ || '', setBusQ: (e) => this.setState({ busQ: e.target.value }),
      selecting, toggleSelecting: () => this.setState({ selecting: !selecting, busSel: {} }),
      selectBtnLabel: selecting ? 'Done' : 'Select',
      selectBtnStyle: { borderRadius: '9999px', border: '1px solid ' + (selecting ? t.navActBorder : t.line), background: selecting ? t.navActBg : 'transparent', color: selecting ? t.ink : t.ink60, padding: '6px 11px', fontSize: '11.5px', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background .15s' },
      railGroups,
      unreadStyle: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '18px', height: '18px', borderRadius: '9999px', background: t.ctaBg, color: t.ctaFg, fontSize: '10.5px', fontWeight: 600, padding: '0 5px', flexShrink: 0, boxSizing: 'border-box' },
      thName: actGroup ? actGroup.name : actS.name,
      thMeta: actGroup ? actGroup.members.map(short).join(', ') : actS.host,
      thStatus: actGroup ? 'broadcast' : actS.live ? 'live' : 'offline',
      thPillStyle: chipTone(actGroup ? 'neutral' : actS.live ? 'good' : 'neutral'),
      thDotStyle: actGroup ? { width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0, border: '1.5px solid ' + t.ink60, boxSizing: 'border-box' } : dot(actS.live ? t.good : t.ink35),
      thOffline, thEmpty: thMsgs.length === 0, thMsgs,
      threadRef: (el) => { this._thread = el; },
      thShowTitle: actGroup ? 'Show — pick one session' : actS.live ? 'Show session' : 'Show — session is not running',
      thShowStyle: !actGroup && actS.live ? iconBtn : { ...iconBtn, opacity: 0.3, cursor: 'not-allowed' },
      pinTitle: isPinned(actGroup || actS) ? 'Unpin' : 'Pin',
      pinBtnStyle: isPinned(actGroup || actS) ? { ...iconBtn, background: t.navActBg, borderColor: t.navActBorder, color: t.ink } : iconBtn,
      togglePin: () => { const p = { ...pins }; p[active] = !isPinned(actGroup || actS); this.setState({ pins: p }); },
      copyThread: () => { try { navigator.clipboard.writeText(thread(active).map((m) => '[' + m.at + '] ' + m.from + ': ' + m.text).join('\n\n')); } catch (e) {} },
      toRow, toChips: selIds.map((id) => ({ t: short(id), dotStyle: dot(sById(id).live ? t.good : t.ink35), remove: () => { const b = { ...busSel }; delete b[id]; this.setState({ busSel: b }); } })),
      toChipStyle: { display: 'inline-flex', alignItems: 'center', gap: '6px', borderRadius: '9999px', border: '1px solid ' + t.line, background: t.chipBg, color: t.ink, padding: '3px 6px 3px 10px', fontSize: '11.5px', fontFamily: mono },
      warnDotStyle: dot(t.warn),
      draft, three: 3, zero: 0,
      setDraft: (e) => { const d2 = { ...drafts }; d2[active] = e.target.value; this.setState({ drafts: d2 }); },
      draftKey: (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); } },
      draftPh: toRow ? 'Message ' + selIds.length + ' sessions…' : actGroup ? 'Message all ' + actGroup.members.length + ' sessions…' : 'Message ' + short(active) + ' — lands on its next turn',
      src, srcEditing: !!this.state.srcEditing, notSrcEditing: !this.state.srcEditing,
      setSrc: (e) => this.setState({ src: e.target.value }), startSrcEdit: () => this.setState({ srcEditing: true }), stopSrcEdit: () => this.setState({ srcEditing: false }),
      send, sendLabel: toRow ? 'Send to ' + selIds.length : thOffline ? 'Queue' : 'Send',
      sendStyle: { border: 'none', borderRadius: '9999px', background: draft.trim() ? t.ctaBg : t.chipBg, color: draft.trim() ? t.ctaFg : t.ink45, padding: '7px 18px', fontSize: '12.5px', fontWeight: 500, cursor: draft.trim() ? 'pointer' : 'default', transition: 'background .2s', whiteSpace: 'nowrap' },
      hasBusUnread: busUnread > 0, navBadgeText: leftOpen ? String(busUnread) : '',
      navBadgeStyle: leftOpen
        ? { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '18px', height: '18px', borderRadius: '9999px', background: t.ctaBg, color: t.ctaFg, fontSize: '10.5px', fontWeight: 600, padding: '0 5px', boxSizing: 'border-box' }
        : { position: 'absolute', top: '6px', right: '10px', width: '7px', height: '7px', borderRadius: '50%', background: t.good },
      hasToast: !!toast, toastFrom: toast ? toast.from : '', toastText: toast ? toast.text : '',
      toastBg: dark ? 'rgba(18,18,18,0.82)' : 'rgba(255,255,255,0.9)',
      dismissToast: () => this.setState({ toast: null }),
      openToast: () => { if (!toast) return; const un2 = { ...unread }; un2[toast.sid] = 0; this.setState({ screen: 'bus', busActive: toast.sid, unread: un2, toast: null }); },
    };
    // Keys screen chips
    const ttl = this.state.ttl;
    const prin = this.state.prin;
    const selChip = (on) => ({ borderRadius: '9999px', border: '1px solid ' + (on ? t.navActBorder : t.line), background: on ? t.navActBg : 'transparent', color: on ? t.ink : t.ink60, padding: '8px 16px', fontSize: '13px', cursor: 'pointer', transition: 'background .2s', fontWeight: on ? 500 : 400 });
    // Org chart scope
    const orgSort = this.state.orgSort || 'machine';
    const orgScopeData = FD.fixture.orgScopeData;
    const orgScopeList = Object.keys(orgScopeData[orgSort]);
    const orgScope = this.state.orgScope && orgScopeList.includes(this.state.orgScope) ? this.state.orgScope : (orgSort === 'machine' ? 'german-box' : orgScopeList[0]);
    const orgKidList = orgScopeData[orgSort][orgScope];
    const orgTabStyle = (on) => ({ border: 'none', background: 'transparent', padding: '0 0 3px', margin: 0, font: 'inherit', fontSize: '12.5px', color: on ? t.ink : t.ink60, cursor: 'pointer', borderBottom: '1.5px solid ' + (on ? t.ink : 'transparent'), transition: 'color .2s, border-color .2s' });
    // Machines
    const mSec = (env, name, email, chips, bars, note) => {
      const stale = (bars || []).some((b) => b[2]);
      const withVals = (bars || []).filter((b) => b[1] != null);
      const top = withVals.length ? withVals.reduce((a, b) => (b[1] > a[1] ? b : a)) : null;
      return {
        env: env || '', note: note || '',
        primary: email || name,
        primaryStyle: email
          ? { fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: '12px', fontWeight: 500, color: t.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
          : { fontSize: '12.5px', fontWeight: 500, color: name === '—' ? t.ink35 : t.ink },
        fullSecondary: email ? name : '',
        chips: (chips || []).map(([txt, tone]) => ({ t: txt, style: chipTone(tone) })),
        bars: (bars || []).map((b) => bar(b[0], b[1], '', b[2])),
        collapsedSummary: stale ? 'stale' : top ? top[0] + ' · ' + top[1] + '%' : '',
        summaryStyle: { fontSize: '11px', color: stale ? t.warn : t.ink45 },
      };
    };
    const mOpen = this.state.mOpen || {};
    const mCard = (mach, idx) => {
      const open = !!mOpen[idx];
      const rows = [];
      mach.cols.forEach((c) => c.sections.forEach((s) => {
        if (s.primary === '—') return;
        rows.push({
          env: s.env || c.client, client: s.env ? c.client : '',
          primary: s.primary, primaryStyle: s.primaryStyle,
          summary: open ? '' : s.collapsedSummary, summaryStyle: s.summaryStyle,
          secondary: open ? s.fullSecondary : '',
          chips: s.chips, hasChips: open && s.chips.length > 0,
          bars: s.bars, hasBars: open && s.bars.length > 0,
          note: open ? s.note : '',
        });
      }));
      return {
        name: mach.name, kind: mach.kind, sessions: mach.sessions,
        open, closed: !open,
        gridStyle: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(' + (open ? '300px' : '230px') + ',1fr))', borderTop: '1px solid ' + t.lineSoft, margin: '0 -1px -1px 0' },
        rows: rows.map((r) => ({ ...r, rowStyle: { padding: open ? '14px 16px' : '11px 16px', borderRight: '1px solid ' + t.lineSoft, borderBottom: '1px solid ' + t.lineSoft, display: 'flex', flexDirection: 'column', gap: open ? '7px' : '4px', minWidth: 0 } })),
        toggle: () => { const o = { ...(this.state.mOpen || {}) }; o[idx] = !o[idx]; this.setState({ mOpen: o }); },
        openRegistry: (e) => { e.stopPropagation(); this.setState({ screen: 'registry' }); },
        chevStyle: { transition: 'transform .2s', transform: open ? 'rotate(90deg)' : 'none', color: t.ink45, flexShrink: 0 },
      };
    };
    return {
      dark, notDark: !dark, ...t, four: 4,
      screenTitle: titles[screen][0], screenSub: titles[screen][1],
      rowPadY: compact ? '7px' : '11px', cardPad: compact ? '14px 16px' : '18px 20px',
      isWindows: screen === 'windows', isOrg: screen === 'org', isRegistry: screen === 'registry',
      isBus: screen === 'bus', isKeys: screen === 'keys', isAccounts: screen === 'accounts', isMachines: screen === 'machines', isDesktop: screen === 'desktop',
      goDesktop: () => this.setState({ screen: 'desktop' }), navDesktop: navBtn(screen === 'desktop'),
      dq: this.state.dq, setDq: (e) => this.setState({ dq: e.target.value }), resetDs: () => this.setState({ dq: '', dsExp: {} }),
      dsGroups, dsCount, dsLive,
      goWindows: () => this.setState({ screen: 'windows' }),
      goOrg: () => this.setState({ screen: 'org' }),
      goRegistry: () => this.setState({ screen: 'registry' }),
      goBus: () => this.setState({ screen: 'bus' }),
      goKeys: () => this.setState({ screen: 'keys' }),
      goAccounts: () => this.setState({ screen: 'accounts' }),
      goMachines: () => this.setState({ screen: 'machines' }),
      navWindows: navBtn(screen === 'windows'), navOrg: navBtn(screen === 'org'), navRegistry: navBtn(screen === 'registry'),
      navBus: navBtn(screen === 'bus'), navKeys: navBtn(screen === 'keys'), navAccounts: navBtn(screen === 'accounts'), navMachines: navBtn(screen === 'machines'),
      toggleMode: () => {
        const next = !this.isDark();
        try { localStorage.setItem('fd-landing-dark', next ? '1' : '0'); } catch (e) {}
        this.setState({ dark: next });
      },
      videoRef: (el) => { this._video = el; if (el) el.playbackRate = this.props.videoSpeed ?? 1; },
      videoOn, videoOff: !videoOn,
      videoBtnBg: videoOn ? 'transparent' : t.navActBg,
      toggleVideo: () => {
        const next = !videoOn;
        try { localStorage.setItem('fd-app-video', next ? '1' : '0'); } catch (e) {}
        this.setState({ videoOn: next });
      },
      leftOpen, notLeftOpen: !leftOpen, rightOpen,
      toggleLeft: () => this.setState({ leftOpen: !leftOpen }),
      toggleRight: () => this.setState({ rightOpen: !rightOpen }),
      asideW: leftOpen ? '252px' : '64px',
      sideHeadStyle: leftOpen
        ? { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 12px 14px 18px' }
        : { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '18px 8px 12px 8px' },
      sideBtnRowStyle: leftOpen ? { display: 'flex', alignItems: 'center', gap: '6px' } : { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' },
      navLabel: leftOpen ? { whiteSpace: 'nowrap' } : { display: 'none' },
      rightBtnBg: rightOpen ? t.navActBg : 'transparent',
      liveApiStyle: { ...chipTone('good'), padding: '5px 14px' },
      goodDotStyle: dot(t.good), dimDotStyle: dot(t.ink35),
      goodPillStyle: chipTone('good'), dimPillStyle: { ...chipTone('neutral'), color: t.ink45 }, badPillStyle: chipTone('bad'),
      neutralChipStyle: chipTone('neutral'),
      countChipStyle: { display: 'inline-flex', alignItems: 'center', borderRadius: '9999px', background: t.chipBg, color: t.ink75, padding: '2px 9px', fontSize: '11px', fontWeight: 500 },
      selectStyle: { borderRadius: '9999px', border: '1px solid ' + t.line, background: t.inputBg, color: t.ink75, padding: '7px 12px', fontSize: '12px', cursor: 'pointer' },
      selectWideStyle: { borderRadius: '8px', border: '1px solid ' + t.line, background: t.inputBg, color: t.ink, padding: '9px 12px', fontSize: '13px', cursor: 'pointer', width: '100%', boxSizing: 'border-box' },
      actBtnStyle: { borderRadius: '9999px', border: '1px solid ' + t.line, background: 'transparent', color: t.ink75, padding: '4px 11px', fontSize: '11.5px', cursor: 'pointer', transition: 'background .15s', whiteSpace: 'nowrap' },
      iconBtnStyle: iconBtn,
      bulkBtnStyle: { borderRadius: '9999px', border: '1px solid ' + t.line, background: 'transparent', color: t.ink, padding: '5px 14px', fontSize: '12px', cursor: 'pointer', transition: 'background .15s' },
      chipBtnStyle: selChip(false),
      headCheckStyle: check(selCount > 0 && selCount === filtered.length),
      // sidebar
      groups: [
        { box: 'onboarding-box', n: 1, items: [{ n: 'ops', dotStyle: dot(t.good) }] },
        { box: 'german-box', n: gbSessions.length, items: gbSessions.map((n) => ({ n, dotStyle: dot(t.good) })) },
      ],
      miniAccounts: [
        { prov: 'gpt', name: 'admin@deus.finance', pct: 80 }, { prov: 'claude', name: 'admin@deus.finance', pct: 71 }, { prov: 'claude', name: 'neelo@vibe.trading', pct: null }, { prov: 'claude', name: 'lafayette@infinite-holdings.llc', pct: null }, { prov: 'claude', name: 'aylianator@gmail.com', pct: null },
      ].map((a) => {
        const has = a.pct != null;
        return {
          name: a.name, txt: has ? a.pct + '%' : 'no data',
          isGpt: a.prov === 'gpt', isClaude: a.prov === 'claude', provTitle: a.prov === 'gpt' ? 'ChatGPT' : 'Claude',
          provStyle: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '14px', height: '14px', color: has ? t.ink75 : t.ink35 },
          nameStyle: { fontFamily: mono, fontSize: '11px', color: has ? t.ink75 : t.ink45, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
          txtStyle: { fontSize: '11px', color: has ? (a.pct >= 70 ? t.warn : t.ink75) : t.ink35, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
          fillStyle: barFill(a.pct, has && a.pct >= 70 ? t.warn : t.good),
        };
      }),
      gptLogoStyle: { width: '12px', height: '12px', objectFit: 'contain', display: 'block', filter: dark ? 'invert(1)' : 'none', opacity: 0.85 },
      claudeLogoStyle: { width: '12px', height: '12px', objectFit: 'contain', display: 'block' },
      boxRows: [
        { name: 'german-box', st: 'holder OK', tone: 'good' },
        { name: 'onboarding-box', st: 'reachable', tone: 'good' },
      ].map((b) => ({ name: b.name, st: b.st, dotStyle: dot(b.tone === 'good' ? t.good : t.warn), stStyle: { fontSize: '11px', color: t.ink45, whiteSpace: 'nowrap' } })),
      // windows
      tiles: [
        { name: 'LC-cdx-readpath', box: 'german-box', foot1: 'gpt-5.6-sol xhigh · ~/projects/lowcap-connecto…', foot2: 'Pursuing goal (11m)', lines: [
          { t: 'Interacted with /root/xyz_1630_review', style: { color: t.ink75 } },
          { t: 'Ran cargo clippy -p lowcap-pools-management --tests --no-deps', style: { color: t.ink60 } },
          { t: '… +85 lines · Finished dev profile in 9.80s', style: { color: t.ink60 } },
          { t: 'Working (16s · esc to interrupt)', style: { color: t.ink } },
          { t: '› Ask Codex to do anything', style: { color: t.ink35 } },
        ]},
        { name: 'LC-census-classifier', box: 'german-box', foot1: 'LC-census0:claude* · bypass permissions on', foot2: 'Gisberta census cla', lines: [
          { t: 'CONTRACT.md untouched.', style: { color: t.ink75 } },
          { t: 'Lane complete: XYZ-1570, XYZ-1571 d1, XYZ-1572 all delivered, reviewed, post-audited, pushed.', style: { color: t.ink60 } },
          { t: 'Still needs you: mirror docs/reports/gisberta/ into Linear — the MCP has been down.', style: { color: t.ink75 } },
          { t: '✳ Churned for 18m 20s', style: { color: t.ink } },
          { t: '› Ask Codex to do anything', style: { color: t.ink35 } },
        ]},
        { name: 'LC-chiliz-factories', box: 'german-box', foot1: 'gpt-5.6-sol xhigh · ~/projects/lowcap-connec…', foot2: 'Goal achieved (1h 9m)', lines: [
          { t: '- Signed completion and operator-gated rerun: docs/reports/frieda-chiliz-factories/LINEAR-NOTE-DONE.md', style: { color: t.ink60 } },
          { t: '- No drain or production mutation performed.', style: { color: t.ink60 } },
          { t: 'Elapsed goal time: about 1 hour 10 minutes.', style: { color: t.ink75 } },
          { t: '— Worked for 5m 18s ————————', style: { color: t.ink45 } },
          { t: '› Ask Codex to do anything', style: { color: t.ink35 } },
        ]},
        { name: 'LC-comparator-smalls', box: 'german-box', foot1: 'gpt-5.6-sol high · ~/projects/lowcap-connector…', foot2: 'Goal achieved (29m)', lines: [
          { t: '- Targeted API tests passed. Reviewer and hard-crux audit: green.', style: { color: t.ink60 } },
          { t: 'Commits: de431951, ee4c8218, 5bfffdd6.', style: { color: t.ink75 } },
          { t: 'Goal accounting: 500,363 tokens over 29m 48s.', style: { color: t.ink60 } },
          { t: '— Worked for 30m 21s ———————', style: { color: t.ink45 } },
          { t: '› Ask Codex to do anything', style: { color: t.ink35 } },
        ]},
      ].map((tl) => ({ ...tl, openTerm: () => openTerm(tl.name, tl.box) })),
      // org
      orgSort, orgScope,
      orgSortLabel: 'Sorted by ' + orgSort,
      toggleOrgSort: () => this.setState({ orgSort: orgSort === 'machine' ? 'project' : 'machine', orgScope: null }),
      setOrgScope: (e) => this.setState({ orgScope: e.target.value }),
      orgScopes: orgScopeList.map((k) => ({ label: k })),
      orgSortBtnStyle: { borderRadius: '9999px', border: '1px solid ' + t.line, background: t.inputBg, color: t.ink75, padding: '7px 12px', fontSize: '12px', cursor: 'pointer', width: '150px', textAlign: 'center', transition: 'background .2s' },
      orgScopeSelectStyle: { borderRadius: '9999px', border: '1px solid ' + t.line, background: t.inputBg, color: t.ink75, padding: '7px 12px', fontSize: '12px', cursor: 'pointer', fontFamily: mono, width: '230px', appearance: 'none', WebkitAppearance: 'none', paddingRight: '30px', backgroundImage: 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="' + t.ink45 + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>') + '")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' },
      orgSpine: [
        { name: orgScope, tag: orgKidList.length + ' sessions', sub: orgSort === 'machine' ? 'fleet workers · machine' : 'fleet workers · project', dotStyle: dot(t.ink) },
        { name: 'coordinator', tag: 'seat', sub: 'long-lease · weekly', path: 'mac / coordinator', lease: 'lease active', exp: '6d left', expStyle: { color: t.ink, whiteSpace: 'nowrap' }, dotStyle: dot(t.ink) },
        { name: 'orchestrator', tag: 'epoch #10', sub: 'seat · fenced · high churn', path: 'mac / orchestrator', lease: 'lease suspect · 3m', exp: 'expired 2m ago', expStyle: { color: t.bad, whiteSpace: 'nowrap' }, dotStyle: { ...dot('transparent'), border: '1.5px solid ' + t.ink60, boxSizing: 'border-box' }, canMsg: true, message: () => this.setState({ screen: 'bus', busActive: 'desktop' }) },
      ],
      orgKids: orgKidList.map(([name, role, path, live]) => ({ name, role, path, epoch: '#1', lease: live === false ? 'lease suspect' : 'lease active', exp: live === false ? 'expired 4m ago' : '1m left', expStyle: { color: live === false ? t.bad : t.good, whiteSpace: 'nowrap' }, dotStyle: dot(live === false ? t.warn : t.good), message: () => this.setState({ screen: 'bus', busActive: 'desktop' }) })),
      orgKidCols: orgKidList.length,
      orgHLineStyle: { position: 'absolute', top: 0, height: '1px', background: t.line, left: 'calc(' + (50 / orgKidList.length) + '% - ' + ((orgKidList.length - 1) * 20 / (2 * orgKidList.length)) + 'px)', right: 'calc(' + (50 / orgKidList.length) + '% - ' + ((orgKidList.length - 1) * 20 / (2 * orgKidList.length)) + 'px)' },
      orgMsgBtnStyle: { marginTop: '4px', width: '100%', borderRadius: '9999px', border: '1px solid ' + t.line, background: t.inputBg, color: t.ink, padding: '8px 14px', fontSize: '13px', cursor: 'pointer', transition: 'background .2s' },
      orgAttached: !this.state.orgTab || this.state.orgTab === 'attached',
      orgUnattached: this.state.orgTab === 'unattached',
      showAttached: () => this.setState({ orgTab: 'attached' }),
      showUnattached: () => this.setState({ orgTab: 'unattached' }),
      tabAttachedStyle: orgTabStyle(!this.state.orgTab || this.state.orgTab === 'attached'),
      tabUnattachedStyle: orgTabStyle(this.state.orgTab === 'unattached'),
      orgCards: [
        orgCard('Bettina', true, 'backend-developer', 'german-box / ST-bettina', 'st-lanes-0831 / VIB-344', 'legacy', 'tmux live', t.ink75, '3s', 'expired 1d 15h ago', t.bad),
        orgCard('Margery', true, 'backend-developer', 'german-box / ST-margery', 'st-lanes-0831 / VIB-345', 'legacy', 'tmux live', t.ink75, '3s', 'expired 1d 15h ago', t.bad),
        orgCard('ops', true, 'unassigned role', 'onboarding-box / ops', 'no group / no task', 'legacy', 'tmux live', t.ink75, '3s', 'expired 1d 15h ago', t.bad),
        orgCard('Adelgund', false, 'unassigned role', 'german-box / LC-adelgund-xyz…', 'no group / no task', '#1', 'suspect', t.warn, '16h 30m', 'expired 22h ago', t.bad),
        orgCard('Adelmar', true, 'devops-engineer', 'german-box / FD-gb-home', 'xyz-1890 / XYZ-1890', '#1', 'active', t.good, '3s', '1m left', t.good),
        orgCard('Albrecht', true, 'unassigned role', 'german-box / LC-albrecht-xyz…', 'no group / no task', '#1', 'active', t.good, '3s', '1m left', t.good),
        orgCard('Alwin', false, 'unassigned role', 'german-box / LC-alwin-xyz-19…', 'no group / no task', '#1', 'suspect', t.warn, '1d 15h', 'expired 1d 15h ago', t.bad),
        orgCard('Amalberga', false, 'unassigned role', 'german-box / LC-amalberga-xy…', 'no group / no task', '#1', 'suspect', t.warn, '23h 52m', 'expired 23h 51m ago', t.bad),
        orgCard('Amalia', false, 'unassigned role', 'german-box / LC-amalia-xyz…', 'no group / no task', '#1', 'suspect', t.warn, '1d 16h', 'expired 1d 16h ago', t.bad),
      ],
      // registry
      q: this.state.q, rowCount: filtered.length, regRows,
      setQ: (e) => this.setState({ q: e.target.value }),
      resetFilters: () => this.setState({ q: '', sel: {} }),
      hasSel: selCount > 0, selCount,
      allSel: selCount > 0 && selCount === filtered.length,
      toggleAll: () => {
        const all = selCount === filtered.length;
        const s2 = {};
        if (!all) filtered.forEach((r) => { s2[r.id] = true; });
        this.setState({ sel: s2 });
      },
      clearSel: () => this.setState({ sel: {} }),
      // bus
      ...busVals, ...termVals,
      // keys
      ttlChips: ['1h', '4h', '8h'].map((v) => ({ t: v, style: selChip(ttl === v), set: () => this.setState({ ttl: v }) })),
      prinChips: ['root', 'vibe'].map((v) => ({ t: v, style: selChip(!!prin[v]), set: () => this.setState({ prin: { ...prin, [v]: !prin[v] } }) })),
      copyCmd: () => { try { navigator.clipboard.writeText('-o IdentitiesOnly=yes -o IdentityAgent=none -i /Users/misterislez/.ssh/deploy-certs/20260906-153509/deployer'); } catch (e) {} },
      keyRows: FD.fixture.keyRows,
      // accounts
      accounts: [
        { prov: 'codex', name: 'Daniel Tabor (personal · ChatGPT)', email: 'admin@deus.finance', id: '', plan: 'pro', live: 'live', right: 'just now · DESKTOP-LJMEJQN',
          provStyle: chipTone('neutral'), provDotStyle: dot(t.good), planStyle: chipTone('neutral'),
          bars: [bar('weekly', 80, 'resets in 129h 2m')], trendPts: '', seen: 'rfc1918-internal · live, DESKTOP-LJMEJQN · live, ubuntu-8gb-nbg1-1 · live' },
        { prov: 'claude', name: 'Daniel Tabor', email: 'admin@deus.finance', id: '8323fe6e', plan: 'Max 20×', live: 'live', right: 'just now · DESKTOP-LJMEJQN',
          provStyle: chipTone('neutral'), provDotStyle: dot(t.good), planStyle: chipTone('neutral'),
          bars: [bar('5 hour', 12, 'resets in 4h 26m'), bar('7 day', 71, 'resets in 120h 6m'), bar('7 day Fable', 8, 'resets in 120h 6m')],
          trendPts: spark([1,3,4,4,1,3,3.5,3.5,3.5,5,4,3,4.5,4,3,2,3.5,3,2.5,3]), trendColor: t.good, trendPct: '0%',
          seen: 'rfc1918-internal · desktop snapshot, DESKTOP-LJMEJQN · live' },
        { prov: 'claude', name: 'Reiner Garrecht', email: 'neelo@vibe.trading', id: 'c578669c', plan: 'Max 20×', live: 'live · usage from desktop snapshot', right: 'just now · rfc1918-internal',
          provStyle: chipTone('neutral'), provDotStyle: dot(t.good), planStyle: chipTone('neutral'),
          staleNote: 'sampled 8d ago — older than the window it measured, so these have reset since',
          bars: [bar('5 hour', null), bar('7 day', null)],
          trendPts: spark([1,1.5,2,2.5,2.5,3,3.5,3.5,4,5,2,2.5,3,3.5,4,4.5,5,5.5,6,6.5]), trendColor: t.warn, trendPct: '77%',
          seen: 'rfc1918-internal · live, rfc1918-internal · desktop snapshot' },
        { prov: 'claude', name: 'Lafayette Tabor', email: 'lafayette@infinite-holdings.llc', id: 'b14f597c', plan: 'desktop snapshot', live: '', right: 'just now · DESKTOP-LJMEJQN',
          provStyle: chipTone('neutral'), provDotStyle: dot(t.good), planStyle: chipTone('neutral'),
          staleNote: 'sampled 9d ago — older than the window it measured, so these have reset since',
          bars: [bar('5 hour', null), bar('7 day', null), bar('extra usage', null)],
          trendPts: spark([2,4,5,5.5,5,4.5,4,3.5,3,3,4,3,5,5.5,5.5,2,3,2.5,3,3.5]), trendColor: t.good, trendPct: '42%',
          seen: 'rfc1918-internal · desktop snapshot, DESKTOP-LJMEJQN · desktop snapshot' },
        { prov: 'claude', name: 'Aylin Yeter', email: 'aylianator@gmail.com', id: 'd24c4827', plan: 'Max 20×', live: 'live · usage from desktop snapshot', right: '3h ago · rfc1918-internal',
          provStyle: chipTone('neutral'), provDotStyle: dot(t.good), planStyle: chipTone('neutral'),
          banner: 'could not read usage on rfc1918-internal',
          bannerStyle: { borderRadius: '8px', border: '1px solid ' + t.warn, background: t.warnBg, color: t.warn, padding: '9px 14px', fontSize: '12.5px' },
          staleNote: 'sampled 14d ago — older than the window it measured, so these have reset since',
          bars: [bar('5 hour', null), bar('7 day', null)],
          trendPts: spark([1,2,3,3.5,3,4,4.5,4,3.5,4,3,4.5,5,4.5,2,4,4.5,5,4.5,7]), trendColor: t.warn, trendPct: '88%',
          seen: 'rfc1918-internal · live, rfc1918-internal · desktop snapshot, DESKTOP-LJMEJQN' },
      ].map((a, i) => {
        const open = !!(this.state.aOpen || {})[i];
        const primary = a.bars.find((b) => b.label === '5 hour') || a.bars[0];
        return {
          ...a, open,
          visBars: open ? a.bars : (primary ? [primary] : []),
          showBanner: open && !!a.banner, showStale: open && !!a.staleNote, showTrend: open && !!a.trendPts,
          chevStyle: { transition: 'transform .2s', transform: open ? 'rotate(90deg)' : 'none', color: t.ink45, flexShrink: 0 },
          toggle: () => { const o = { ...(this.state.aOpen || {}) }; o[i] = !o[i]; this.setState({ aOpen: o }); },
        };
      }),
      // machines
      machines: [
        { name: 'MacBook Pro', kind: 'macos · local', sessions: '', cols: [
          { client: 'Claude CLI', sections: [mSec('', 'Reiner Garrecht', 'neelo@vibe.trading', [['claude_max', 'neutral'], ['Max 20×', 'neutral'], ['token-proved', 'good']], [['5 hour', null, true], ['7 day', null, true]], 'token valid in 4 h · sampled 8d ago — window has reset since')] },
          { client: 'Codex CLI', sections: [mSec('', 'Daniel Tabor (personal · ChatGPT)', 'admin@deus.finance', [['pro', 'neutral'], ['token-proved', 'good']], [['weekly', 80]], 'refreshed 1d ago · resets in 129h 2m · sampled just now')] },
          { client: 'Claude Desktop', sections: [mSec('', 'Lafayette Tabor', '', [['last active 13m ago', 'neutral']], [['5 hour', null, true], ['7 day', null, true], ['extra usage', null, true]], 'sampled 9d ago — window has reset since')] },
          { client: 'Codex Desktop', sections: [mSec('', 'signed in, account unknown', '', [], [], 'Codex desktop keeps the account under safeStorage/IndexedDB, which this reader cannot read · no usage data')] },
        ]},
        { name: 'german-box', kind: 'windows+wsl · ssh gb-deploy', sessions: '65 sessions', cols: [
          { client: 'Claude CLI', sections: [
            mSec('WSL', 'Daniel Tabor', 'admin@deus.finance', [['claude_max', 'neutral'], ['Max 20×', 'neutral'], ['token-proved', 'good']], [['5 hour', 12], ['7 day', 71], ['7d fable', 8]], 'token valid in 6 h · 65 sessions run as Daniel Tabor'),
            mSec('Windows', 'Daniel Tabor', 'admin@deus.finance', [['config only', 'warn']], [['5 hour', 12], ['7 day', 71]], ''),
          ]},
          { client: 'Codex CLI', sections: [
            mSec('WSL', 'Daniel Tabor (personal · ChatGPT)', 'admin@deus.finance', [['pro', 'neutral'], ['token-proved', 'good']], [['weekly', 80]], 'refreshed 9d ago · resets in 129h 2m'),
            mSec('Windows', 'Daniel Tabor (personal · ChatGPT)', 'admin@deus.finance', [['plus', 'neutral'], ['token-proved', 'good']], [['weekly', 80]], 'refreshed 101d ago'),
          ]},
          { client: 'Claude Desktop', sections: [
            mSec('WSL', '—', '', [], [], ''),
            mSec('Windows', 'Daniel Tabor', '', [['last active 1d ago', 'neutral']], [['5 hour', 12], ['7 day', 71], ['7d fable', 8]], 'sampled just now'),
          ]},
          { client: 'Codex Desktop', sections: [
            mSec('WSL', '—', '', [], [], ''),
            mSec('Windows', '—', '', [], [], ''),
          ]},
        ]},
      ].map(mCard),
    };
  }
}
class DeckLogic extends Sub {
  active = 0;
  renderVals() {
    return {
      rootRef: (el) => { this.rootEl = el; },
      vid: (el) => this.attachVideo(el),
      go0: () => this.goTo(0), go1: () => this.goTo(1), go2: () => this.goTo(2), go3: () => this.goTo(3), go4: () => this.goTo(4),
    };
  }
  attachVideo(el) {
    if (!el || el._fdInit) return;
    el._fdInit = true;
    el.muted = true;
    el.src = el.getAttribute('data-src');
    el.addEventListener('loadedmetadata', () => { el.play().catch(() => {}); });
  }
  componentDidMount() {
    const root = this.rootEl;
    if (!root) return;
    root.querySelectorAll('[data-words]').forEach((el) => this.splitWords(el));
    root.querySelectorAll('[data-anim]').forEach((el) => { el.dataset.fdAnim = el.style.animation; });
    this.onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); this.goTo(this.active + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); this.goTo(this.active - 1); }
    };
    window.addEventListener('keydown', this.onKey);
    this.applyProps();
  }
  componentDidUpdate() { this.applyProps(); }
  componentWillUnmount() {
    window.removeEventListener('keydown', this.onKey);
    clearInterval(this.autoT);
    if (this.rootEl) this.rootEl.querySelectorAll('video').forEach((v) => { if (v._fdHls) v._fdHls.destroy(); });
  }
  applyProps() {
    const dim = this.props.videoDim ?? 0;
    const shift = this.props.videoShift ?? 15;
    const blur = this.props.videoBlur ?? 0;
    if (this.rootEl) {
      const slideIdx = (el) => { const s = el.closest('[data-fd-slide]'); return s ? +s.dataset.fdSlide : -1; };
      const isPlain = (i) => i === 0 || i === 4; // first + last slide: no dim, no blur
      this.rootEl.querySelectorAll('[data-dim]').forEach((el) => { el.style.background = 'rgba(0,0,0,' + (isPlain(slideIdx(el)) ? 0 : dim) + ')'; });
      this.rootEl.querySelectorAll('video[data-src]').forEach((v) => {
        const i = slideIdx(v);
        const base = v.dataset.baseLeft || '0px';
        const sh = i === 0 ? 34 : i === 4 ? 0 : shift;
        v.style.left = 'calc(' + base + ' + ' + sh + '%)';
        v.style.right = 'calc(0px - ' + sh + '%)';
        v.style.filter = !isPlain(i) && blur > 0 ? 'blur(' + blur + 'px)' : '';
      });
    }
    clearInterval(this.autoT);
    const s = this.props.autoAdvance ?? 0;
    if (s > 0) this.autoT = setInterval(() => this.goTo((this.active + 1) % 5), s * 1000);
  }
  splitWords(el) {
    if (el.querySelector('span')) return;
    const base = parseFloat(el.dataset.baseDelay || '0.25');
    const words = (el.textContent || '').trim().split(/\s+/);
    el.textContent = '';
    words.forEach((w, i) => {
      const outer = document.createElement('span');
      outer.style.cssText = 'display:inline-block;overflow:hidden;margin-right:0.27em;vertical-align:top;padding-bottom:0.08em;margin-bottom:-0.08em;';
      const inner = document.createElement('span');
      inner.textContent = w;
      inner.setAttribute('data-anim', '1');
      inner.style.cssText = 'display:inline-block;animation:fdSlideUp 0.55s cubic-bezier(0.25,0.1,0.25,1) ' + (base + i * 0.035).toFixed(3) + 's both;';
      outer.appendChild(inner);
      el.appendChild(outer);
    });
  }
  goTo(n) {
    n = Math.max(0, Math.min(4, n));
    if (n === this.active) return;
    this.active = n;
    this.applyActive();
  }
  applyActive() {
    const root = this.rootEl;
    root.querySelectorAll('[data-fd-slide]').forEach((s) => {
      const on = parseInt(s.dataset.fdSlide, 10) === this.active;
      s.style.opacity = on ? '1' : '0';
      s.style.zIndex = on ? '10' : '0';
      s.style.pointerEvents = on ? 'auto' : 'none';
      if (on) this.replay(s);
    });
    root.querySelectorAll('[data-dot]').forEach((d) => {
      const on = parseInt(d.dataset.dot, 10) === this.active;
      d.style.width = on ? '24px' : '8px';
      d.style.background = on ? '#fff' : 'rgba(255,255,255,0.4)';
    });
  }
  replay(slide) {
    const els = slide.querySelectorAll('[data-anim]');
    els.forEach((el) => { el.style.animation = 'none'; });
    void slide.offsetWidth;
    els.forEach((el) => { el.style.animation = el.dataset.fdAnim; });
  }
}
class Component extends DCLogic {
  state = { view: this.props.startView === 'app' ? 'app' : this.props.startView === 'deck' ? 'deck' : 'land' };
  _sub(k) {
    if (!this._subs) this._subs = { land: new LandLogic(this, 'land'), app: new AppLogic(this, 'app'), deck: new DeckLogic(this, 'deck') };
    return this._subs[k];
  }
  _pref(o, p) { const r = {}; for (const k in o) r[p + k] = o[k]; return r; }
  renderVals() {
    const go = (v) => (e) => { if (e && e.preventDefault) e.preventDefault(); if (v !== this.state.view) this.setState({ view: v }); };
    return Object.assign({},
      this._pref(this._sub('land').renderVals(), 'L_'),
      this._pref(this._sub('app').renderVals(), 'A_'),
      this._pref(this._sub('deck').renderVals(), 'D_'),
      {
        rootRef: (el) => { this._rootEl = el; },
        view: this.state.view,
        goLanding: go('land'), goApp: go('app'), goDeck: go('deck'),
      });
  }
  applyView() {
    const r = this._rootEl;
    if (!r) return;
    ['land', 'app', 'deck'].forEach((k) => {
      const el = r.querySelector('[data-fd-view="' + k + '"]');
      if (el) el.style.display = k === this.state.view ? 'block' : 'none';
    });
    const b = r.querySelector('[data-fd-back]');
    if (b) b.style.display = this.state.view === 'land' ? 'none' : 'inline-flex';
  }
  _mount(v) {
    if (!this._m) this._m = {};
    if (this._m[v]) return;
    this._m[v] = true;
    const s = this._sub(v);
    if (s.componentDidMount) s.componentDidMount();
  }
  componentDidMount() {
    this._last = this.state.view;
    this.applyView();
    this._mount(this.state.view);
  }
  componentDidUpdate(...a) {
    this.applyView();
    const v = this.state.view;
    if (this._last !== v) {
      // deck binds window keys, so it is torn down when you leave it
      if (this._last === 'deck' && this._m && this._m.deck) {
        const d = this._sub('deck');
        if (d.componentWillUnmount) d.componentWillUnmount();
        this._m.deck = false;
      }
      this._last = v;
      if (v === 'land') window.scrollTo(0, window.scrollY);
    }
    this._mount(v);
    Object.keys(this._m || {}).forEach((k) => {
      if (!this._m[k]) return;
      const s = this._sub(k);
      if (s.componentDidUpdate) s.componentDidUpdate(...a);
    });
  }
  componentWillUnmount() {
    Object.keys(this._m || {}).forEach((k) => {
      if (!this._m[k]) return;
      const s = this._sub(k);
      if (s.componentWillUnmount) s.componentWillUnmount();
    });
  }
}
