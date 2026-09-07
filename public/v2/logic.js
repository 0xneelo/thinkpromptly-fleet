
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
    this._fdAfterRender();
  }
  // L9: the compiled template hard-codes the machine card's "reported just now" and leaves the
  // header Refresh button unbound, so the Machines slice finishes its own render here. No-op in
  // fixture mode and whenever the slice is absent. See improvised.md I-L9-01 / I-L9-02.
  _fdAfterRender() {
    const m = FD.screens && FD.screens.machines;
    if (m && typeof m.afterRender === 'function') m.afterRender();
  }
  componentDidMount() {
    this._fdAfterRender();
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
  // ---- L5 · Org chart (Dietlind, agent-v2-l5) ------------------------------
  // "Send a message" deep-links into the bus thread (ruling O8). L6 owns the bus,
  // so the hook is guarded; until L6 lands we keep the mock's own behaviour.
  _orgMessage(target) {
    const org = FD.screens && FD.screens.org;
    if (target && org && org.openBus(target)) return;
    this.setState({ screen: 'bus', busActive: 'desktop' });
  }
  // DESIGN-35 binding (2): one throw in any slice's renderVals section blanks
  // EVERY screen, because the shim falls back to bare props. So this section is
  // throw-proof: on a bad row it keeps the last good values and logs.
  _orgLive(c) {
    try {
      const out = this._orgVals(c);
      this._orgGood = out;
      return out;
    } catch (e) {
      console.error('[org] renderVals section failed; keeping the last good values', e);
      if (this._orgGood) return this._orgGood;
      // Nothing good yet: fall back to the mock's own literals, which cannot throw.
      const live = FD.fixture.orgLive;
      delete FD.fixture.orgLive;
      try { return this._orgVals(c); } finally { if (live) FD.fixture.orgLive = live; }
    }
  }
  // FD.fixture.orgLive is published by public/v2/screens/org.js in live mode
  // ONLY. When it is absent every value below is the mock's own literal, so
  // fixture mode — and the pixel gate — render byte-for-byte as before.
  _orgVals(c) {
    const { t, dot, chipTone, mono, orgSort, orgScope, orgKidList, orgCard } = c;
    const hLine = (n) => ({ position: 'absolute', top: 0, height: '1px', background: t.line, left: 'calc(' + (50 / n) + '% - ' + ((n - 1) * 20 / (2 * n)) + 'px)', right: 'calc(' + (50 / n) + '% - ' + ((n - 1) * 20 / (2 * n)) + 'px)' });
    const live = FD.fixture.orgLive || null;

    if (!live) return {
      orgSpine: [
        { name: orgScope, tag: orgKidList.length + ' sessions', sub: orgSort === 'machine' ? 'fleet workers · machine' : 'fleet workers · project', dotStyle: dot(t.ink) },
        { name: 'coordinator', tag: 'seat', sub: 'long-lease · weekly', path: 'mac / coordinator', lease: 'lease active', exp: '6d left', expStyle: { color: t.ink, whiteSpace: 'nowrap' }, dotStyle: dot(t.ink) },
        { name: 'orchestrator', tag: 'epoch #10', sub: 'seat · fenced · high churn', path: 'mac / orchestrator', lease: 'lease suspect · 3m', exp: 'expired 2m ago', expStyle: { color: t.bad, whiteSpace: 'nowrap' }, dotStyle: { ...dot('transparent'), border: '1.5px solid ' + t.ink60, boxSizing: 'border-box' }, canMsg: true, message: () => this.setState({ screen: 'bus', busActive: 'desktop' }) },
      ],
      orgKids: orgKidList.map(([name, role, path, on]) => ({ name, role, path, epoch: '#1', lease: on === false ? 'lease suspect' : 'lease active', exp: on === false ? 'expired 4m ago' : '1m left', expStyle: { color: on === false ? t.bad : t.good, whiteSpace: 'nowrap' }, dotStyle: dot(on === false ? t.warn : t.good), message: () => this.setState({ screen: 'bus', busActive: 'desktop' }) })),
      orgKidCols: orgKidList.length,
      orgHLineStyle: hLine(orgKidList.length),
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
    };

    // Live. org.js emits tone NAMES; the theme tokens resolve here so both themes
    // stay correct — the layer split L1 recorded as I-L1-01.
    const tone = (n) => n === 'good' ? t.good : n === 'warn' ? t.warn : n === 'bad' ? t.bad
      : n === 'ink' ? t.ink : n === 'ink75' ? t.ink75 : n === 'ink60' ? t.ink60 : t.ink35;
    const dotFor = (n) => n === 'hollow'
      ? { ...dot('transparent'), border: '1.5px solid ' + t.ink60, boxSizing: 'border-box' }
      : dot(tone(n));
    const inScope = (r) => !orgScope || (orgSort === 'machine' ? r.mach : r.proj) === orgScope;
    const kids = (live.kids || []).filter(inScope);
    // The unattached grid is NOT scope-filtered: the mock puts the sort/scope
    // control inside the attached tab only, and the "N unattached" count beside
    // it is fleet-wide, so a filtered grid would contradict its own tab count.
    // That also matches today's <details> strip, which lists every orphan.
    const cards = live.cards || [];
    const cols = Math.max(1, kids.length);

    const toSpine = (n) => ({
      name: n.name, tag: n.tag || '', sub: n.sub || '', path: n.path || '',
      lease: n.lease || '', exp: n.exp || '',
      expStyle: { color: tone(n.expTone), whiteSpace: 'nowrap' },
      dotStyle: dotFor(n.dotTone),
      canMsg: !!n.canMsg,
      message: () => this._orgMessage(n.target),
    });

    // The head card is the scope node; the seat roots behind it are fleet-wide.
    const head = { name: orgScope || 'fleet', tag: kids.length + ' sessions', sub: orgSort === 'machine' ? 'fleet workers · machine' : 'fleet workers · project', dotStyle: dot(t.ink) };
    const spine = live.mode !== 'ok' ? (live.spine || []).map(toSpine)
      : live.empty ? [head, toSpine({ name: live.empty, dotTone: 'hollow' })]
      : [head, ...(live.spine || []).map(toSpine)];

    return {
      orgSpine: spine,
      orgKids: kids.map((k) => ({
        name: k.name, role: k.role, path: k.path, epoch: k.epoch, lease: k.lease, exp: k.exp,
        expStyle: { color: tone(k.expTone), whiteSpace: 'nowrap' },
        dotStyle: dotFor(k.dotTone),
        message: () => this._orgMessage(k.target),
      })),
      orgKidCols: cols,
      orgHLineStyle: hLine(cols),
      orgCards: cards.map((x) => {
        const m = x.meta || [];
        const base = orgCard(x.name, true, x.role, x.path, x.grp,
          m[0] && m[0].v, m[1] && m[1].v, tone(m[1] && m[1].tone), m[2] && m[2].v, m[3] && m[3].v, tone(m[3] && m[3].tone));
        // The mock's card has one badge slot and always fills it; a row with no
        // badge hides the pill rather than showing an empty one (I-L5-03).
        return { ...base, badge: x.badge || '',
          dotStyle: dotFor(x.dotTone),
          badgeStyle: x.badge ? { ...chipTone(x.badgeTone === 'warn' ? 'warn' : 'neutral'), marginLeft: 'auto' } : { display: 'none' } };
      }),
    };
  }
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
        showTitle: r.live ? 'Show session' : 'Show — session is not running',
        msgTitle: r.live ? 'Message this session' : 'Message — session is not running',
        liveBtnStyle: r.live ? iconBtn : { ...iconBtn, opacity: 0.3, cursor: 'not-allowed' },
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
    // L4 (DECK-43): fixture mode renders the mock's rows untouched — FD.setData is
    // never called there, so the pixel gate stays byte-for-byte the mock (DESIGN-35,
    // 2026-09-07). In live mode FD.screens.registry publishes FD.fixture.l4, whose
    // rows are already filtered and sorted, and owns filter, sort and selection.
    const regScreen = (FD.screens && FD.screens.registry) || null;
    if (regScreen && regScreen.setTokens) regScreen.setTokens(t, this);
    if (screen === 'registry' && regScreen && regScreen.start) regScreen.start();
    // One throw anywhere in renderVals blanks every screen, so this block never
    // leaves one: it keeps the last values it rendered and logs once (oracle
    // audit of the shim, 2026-09-08).
    const sel = this.state.sel || {};
    let l4 = null, filtered = [], selCount = 0, regRows = [];
    try {
      // Rows always come from regData — the live screen publishes into that same
      // key, so FD.setData('regData', …) reaches the table whoever calls it. l4
      // carries only what a row cannot: the counts and the search text.
      l4 = FD.fixture.l4 || null;
      const regData = FD.fixture.regData || [];
      const q = l4 ? String(l4.q || '').toLowerCase() : (this.state.q || '').toLowerCase();
      filtered = l4 ? regData : regData.filter((r) => !q || (r.s + ' ' + r.g + ' ' + r.tk).toLowerCase().includes(q));
      const regSel = (r) => (l4 ? !!r.sel : !!sel[r.id]);
      selCount = l4 ? l4.selLive + l4.selGone : filtered.filter((r) => sel[r.id]).length;
      const stTone = (st) => st === 'active' ? 'good' : st === 'kill-requested' ? 'warn' : 'dim';
      regRows = filtered.map((r) => {
        const tone = stTone(r.st);
        const dim = r.gone;
        return {
          s: r.s, g: r.g, t: r.tk, st: r.st, active: r.active, msg: r.msg, seen: r.seen, sel: regSel(r),
          toggle: () => {
            if (l4) return regScreen.toggleRow(r.id);
            const s2 = { ...(this.state.sel || {}) }; s2[r.id] = !s2[r.id]; this.setState({ sel: s2 });
          },
          checkStyle: check(regSel(r)),
          nameStyle: { ...goneName, color: dim ? t.ink45 : t.ink },
          cellStyle: { fontSize: '12.5px', color: dim ? t.ink35 : t.ink60, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
          taskStyle: r.tk === '—' ? { fontSize: '12.5px', color: t.ink35 } : { fontSize: '12.5px', color: dim ? t.ink45 : t.ink, textDecoration: 'underline', textUnderlineOffset: '3px', textDecorationColor: t.ink35, whiteSpace: 'nowrap', cursor: 'pointer' },
          pillStyle: chipTone(tone === 'dim' ? 'neutral' : tone),
          stDotStyle: dot(tone === 'good' ? t.good : tone === 'warn' ? t.warn : t.ink35),
        };
      });
      this.__l4Last = { l4, filtered, selCount, regRows };
    } catch (err) {
      if (!this.__l4Failed) { this.__l4Failed = true; console.error('registry render failed', err); }
      const last = this.__l4Last;
      if (last) { l4 = last.l4; filtered = last.filtered; selCount = last.selCount; regRows = last.regRows; }
    }
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
    /* fd-v2 L3 (windows tiles + session full screen) — owned by that slice.
     * The screen file paints the nodes the mock leaves out (stall line, dead
     * overlay, empty state) and it must do so in the mock's own tokens, so the
     * palette is republished on every render and a theme switch repaints them.
     * l3Live is set by public/v2/screens/windows.js in live mode only; in
     * fixture mode it is absent and every branch below stays on the seed. */
    const l3 = (FD.l3 = FD.l3 || {});
    /* Throw-proofing (oracle audit item 2): one exception raised inside any
     * slice's renderVals blanks every screen, not just that slice's. Each L3
     * value is produced through l3Try, which keeps the last good result and
     * falls back to it rather than letting the render die. */
    const l3Last = (l3.lastGood = l3.lastGood || { tiles: [], termSessions: [], termFoot: '' });
    const l3Try = (k, fn) => {
      try { const v = fn(); l3Last[k] = v; return v; }
      catch (e) { console.error('fd-v2 L3:', e); return l3Last[k]; }
    };
    l3.tokens = {
      ink: t.ink, ink75: t.ink75, ink60: t.ink60, ink45: t.ink45, ink35: t.ink35,
      line: t.line, lineSoft: t.lineSoft, panel: t.panel, panelHead: t.panelHead,
      panelShadow: t.panelShadow, hoverBg: t.hoverBg, good: t.good, warn: t.warn, bad: t.bad,
      ctaBg: t.ctaBg, ctaFg: t.ctaFg,
      termBg: dark ? 'rgba(10,10,10,0.55)' : 'rgba(242,241,238,0.6)', mono, dark,
    };
    l3.term = term;
    l3.termMenu = !!this.state.termMenu;
    /* One render-tick signal for the screen file: the tile boxes it parks its
     * terminals in are rebuilt by screen switches and theme flips, and this is
     * the only moment that can have happened. */
    if (l3.onRender) l3.onRender();
    l3.openTerm = openTerm;
    l3.closeTerm = () => this.setState({ termOpen: null, termMenu: false });
    const l3Live = !!FD.fixture.l3Live;
    const termVals = {
      termOpen: !!term,
      termBg: dark ? 'rgba(10,10,10,0.55)' : 'rgba(242,241,238,0.6)',
      termName: term ? term.name : '', termHost: term ? term.host : '',
      /* Live, the body is an xterm mount, so the template renders no lines and
       * termRef hands the box to the screen file to park the terminal in. */
      termLines: term ? (l3Live ? [] : termLinesFor(term.name)) : [],
      termFoot: term ? (l3Live ? l3Try('termFoot', () => (l3.footFull ? l3.footFull(term.host, term.name) : '')) : 'gpt-6-astra xhigh fast · ~/projects/remote-system/.claude/worktrees/' + term.name.replace(/^(LC|FD)-/, '').toLowerCase() + ' · Main [default]') : '',
      termRef: (el) => {
        if (l3Live) { l3.termBody = el; if (FD.screens.windows) FD.screens.windows._sync(); return; }
        if (el) el.scrollTop = el.scrollHeight;
      },
      closeTerm: () => this.setState({ termOpen: null, termMenu: false }),
      termMessage: () => {
        /* Live, Message hands the session to the bus slice (L6) rather than
         * jumping the local view; the guard keeps it a no-op until L6 lands. */
        if (l3Live) { if (FD.screens.windows) FD.screens.windows._message(); return; }
        const id = term && term.id; this.setState({ termOpen: null, termMenu: false, screen: 'bus', busActive: id || active });
      },
      termMenuOpen: !!this.state.termMenu,
      toggleTermMenu: () => this.setState({ termMenu: !this.state.termMenu }),
      termMenuBtnStyle: this.state.termMenu ? { ...iconBtn, background: t.navActBg, borderColor: t.navActBorder, color: t.ink } : iconBtn,
      /* The ≡ menu is the old sidebar drawer switcher: live sessions only. */
      termSessions: l3Try('termSessions', () => (l3Live ? (FD.fixture.l3TermSessions || []) : busSessions).filter((s) => s && s.live && s.id !== 'desktop').map((s) => ({
        name: s.name, host: s.host, dotStyle: dot(t.good),
        style: { display: 'flex', alignItems: 'center', gap: '9px', width: '100%', border: '1px solid ' + (term && term.name === s.name ? t.navActBorder : 'transparent'), background: term && term.name === s.name ? t.navActBg : 'transparent', color: t.ink, borderRadius: '8px', padding: '7px 9px', cursor: 'pointer', boxSizing: 'border-box' },
        /* Live, switching sessions must attach the tile first, not just swap
         * the header — openMax opens it (deduped) and maximizes it. */
        open: () => (l3Live && FD.screens.windows ? FD.screens.windows.openMax(s.host, s.name) : openTerm(s.name, s.host, s.id)),
      }))),
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
    // L7: the GitHub-train and Certificates cards carry no bindings in the mock,
    // so screens/keys.js paints them from the mock's own nodes after each flush.
    // It needs this render's theme tokens. Guarded: undefined in fixture mode,
    // where that file returns before registering and the mock renders verbatim.
    // Every style handed over is built by the mock's own pill()/dot()/selChip()
    // helpers, so the painted cards carry the mock's tokens and nothing new.
    //
    // Wrapped because renderVals() is shared: one throw anywhere in it blanks
    // EVERY screen, not just this one (DESIGN-35 oracle audit, rule 2). The keys
    // screen degrading to the mock's static cards is a bad day; taking the whole
    // app down with it is not acceptable.
    try {
      if (FD.screens.keys && FD.screens.keys.sync) FD.screens.keys.sync({
        t, dark, isKeys: screen === 'keys', ttl, prin, logic: this,
        pills: {
          good: chipTone('good'), goodDot: dot(t.good),
          dim: { ...chipTone('neutral'), color: t.ink45 }, dimDot: dot(t.ink35),
          warn: chipTone('warn'), warnDot: dot(t.warn),
        },
        chipBtn: selChip(false), chipBtnSel: selChip(true),
      });
    } catch (e) { console.error('L7 keys sync failed', e); }
    // Org chart scope
    const orgSort = this.state.orgSort || 'machine';
    const orgScopeData = FD.fixture.orgScopeData;
    // L5: live scope data need not contain the mock's own default scope.
    const orgScopeList = Object.keys(orgScopeData[orgSort] || {});
    const orgScope = this.state.orgScope && orgScopeList.includes(this.state.orgScope) ? this.state.orgScope : (orgSort === 'machine' && orgScopeList.includes('german-box') ? 'german-box' : orgScopeList[0]);
    const orgKidList = (orgScopeData[orgSort] || {})[orgScope] || [];
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
        bars: (bars || []).map((b) => bar(b[0], b[1], b[3] || '', b[2])),
        collapsedSummary: stale ? 'stale' : top ? top[0] + ' · ' + top[1] + '%' : '',
        summaryStyle: { fontSize: '11px', color: stale ? t.warn : t.ink45 },
      };
    };
    const mOpen = this.state.mOpen || {};
    // L9: live cards default to expanded (today's table is always visible, improvised.md
    // I-L9-03); the fixture's seed keeps the mock's collapsed cards, so the gate is unmoved.
    const mLive = FD.fixture.machinesLive;
    const mCard = (mach, idx) => {
      // DESIGN-35 binding instruction 1 (S2 shim audit F1, 2026-09-08): sc-for rows are
      // positional, so per-card state is keyed by the machine's name, not its index —
      // a machine dropping out of /api/machines must not hand its open state to its
      // neighbour. Names are unique per fleet; the index is only the last resort.
      const mKey = mach.name || String(idx);
      const open = mOpen[mKey] === undefined ? !!mLive : !!mOpen[mKey];
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
      // L9 improvisation I-L9-04: the mock's card body has no slot for a machine-level error
      // or the push "no report yet" line, so they lead the grid as one status cell.
      if (mach.status) rows.unshift({
        env: mach.status.label, client: '',
        primary: mach.status.text,
        primaryStyle: { fontSize: '12.5px', fontWeight: 500, color: mach.status.tone === 'bad' ? t.bad : t.ink },
        summary: '', summaryStyle: {}, secondary: '',
        chips: [], hasChips: false, bars: [], hasBars: false,
        note: mach.status.copy || '',
      });
      return {
        name: mach.name, kind: mach.kind, sessions: mach.sessions,
        open, closed: !open,
        gridStyle: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(' + (open ? '300px' : '230px') + ',1fr))', borderTop: '1px solid ' + t.lineSoft, margin: '0 -1px -1px 0' },
        rows: rows.map((r) => ({ ...r, rowStyle: { padding: open ? '14px 16px' : '11px 16px', borderRight: '1px solid ' + t.lineSoft, borderBottom: '1px solid ' + t.lineSoft, display: 'flex', flexDirection: 'column', gap: open ? '7px' : '4px', minWidth: 0 } })),
        toggle: () => { const o = { ...(this.state.mOpen || {}) }; o[mKey] = !open; this.setState({ mOpen: o }); },
        // L9: hook used — FD.screens.registry.open (L4), guarded; the mock's own screen
        // switch stays the fallback until L4 defines it (improvised.md I-L9-02).
        openRegistry: (e) => {
          e.stopPropagation();
          const q = mach.host || mach.name;
          if (FD.screens && FD.screens.registry && typeof FD.screens.registry.open === 'function') { FD.screens.registry.open({ q }); return; }
          this.setState({ screen: 'registry' });
        },
        chevStyle: { transition: 'transform .2s', transform: open ? 'rotate(90deg)' : 'none', color: t.ink45, flexShrink: 0 },
      };
    };
    // L9: the mock's seed, moved out of the returned object unchanged — fixture mode
    // renders exactly this, so the pixel gate is untouched.
    const mSeed = [
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
    ];
    // L9: live data arrives as FD.setData('machinesLive', cards) from screens/machines.js.
    // S2 could not byte-safely substitute the `machines` literal, so this slice reads its own
    // key (DESIGN-35 broadcast, 2026-09-07). Sections come back as plain layer-1 data and go
    // through the mock's own mSec() here, per improvised.md I-L1-01.
    // DESIGN-35 binding instruction 2 (S2 shim audit F2): a throw anywhere in renderVals
    // renders every screen from host.props alone — one malformed machine row would blank
    // all nine. This block keeps its last good cards instead of propagating.
    let mCards;
    try {
      const mList = mLive ? mLive.map((m) => Object.assign({}, m, {
        cols: (m && m.cols ? m.cols : []).map((c) => ({
          client: c && c.client,
          sections: (c && c.sections ? c.sections : []).map((sc) => mSec(sc && sc.env, sc && sc.name, sc && sc.email, sc && sc.chips, sc && sc.bars, sc && sc.note)),
        })),
      })) : mSeed;
      mCards = mList.map(mCard);
      this._mLastCards = mCards;
    } catch (e) {
      console.error(e);
      mCards = this._mLastCards || [];
    }
    // ---- accounts (fd-v2 L8) -------------------------------------------------
    // This screen builds its own bars rather than calling the shared bar(): today's
    // Accounts page turns a bar red over 90 %, a step the mock's bar() does not have
    // (BEHAVIOUR.md 3), and bar() is also the Machines screen's helper.
    // The improvised chrome in screens/accounts.js paints in the mock's tokens, so the
    // ones it uses are published here and follow the theme toggle.
    FD.screens = FD.screens || {};
    FD.screens.accounts = FD.screens.accounts || {};
    FD.screens.accounts.tokens = {
      ink: t.ink, ink75: t.ink75, ink60: t.ink60, ink45: t.ink45, ink35: t.ink35,
      warn: t.warn, warnBg: t.warnBg, bad: t.bad, good: t.good, line: t.line,
      panel: t.panel, panelShadow: t.panelShadow, track: t.track, hoverBg: t.hoverBg,
      cardPad: compact ? '14px 16px' : '18px 20px',
    };
    const accTone = (lvl) => (lvl === 'red' ? t.bad : lvl === 'amber' ? t.warn : t.good);
    const accBar = (b) => ({
      label: b.label,
      resets: b.resets || '',
      fillStyle: { display: 'block', height: '100%', width: (b.pct == null ? 0 : Math.max(0, Math.min(100, b.pct))) + '%', borderRadius: '2px', background: b.pct == null ? t.ink35 : accTone(b.level) },
      right: b.right,
      // Only the fill carries the level colour: the mock's bar() and today's .pct rule
      // both render the percentage itself in neutral ink.
      rightStyle: { fontSize: '11px', textAlign: 'right', whiteSpace: 'nowrap', color: b.pct == null ? t.ink35 : t.ink75 },
    });
    // A rate limit says nothing about the account, so it must not read like a fault —
    // today's page renders it as plain muted text, not as the boxed notice that an
    // expired token or a failed read gets.
    const accBannerStyle = (tone) => tone === 'notice'
      ? { borderRadius: '8px', border: '1px solid ' + t.warn, background: t.warnBg, color: t.warn, padding: '9px 14px', fontSize: '12.5px' }
      : { fontSize: '12.5px', color: t.ink60 };
    const accView = (a) => ({
      prov: a.prov, name: a.name, email: a.email, id: a.id, plan: a.plan, live: a.live,
      right: a.right, seen: a.seen, atLimit: a.atLimit, noData: a.noData, noWindows: a.noWindows,
      // The mock's pill is a neutral chip with a coloured dot: green when a source
      // reported and the read was clean, amber when it reported anything else.
      provStyle: chipTone('neutral'),
      provDotStyle: dot(a.pillTone === 'green' ? t.good : a.pillTone === 'amber' ? t.warn : t.ink35),
      planStyle: chipTone('neutral'),
      banner: a.banner, bannerStyle: accBannerStyle(a.bannerTone),
      // The mock's one free text line per card. screens/accounts.js joins every note
      // today's page shows into it and recolours the <p> to match the strongest tone.
      staleNote: a.note,
      bars: (a.bars || []).map(accBar),
      trendPts: a.trendPts, trendColor: accTone(a.trendLevel), trendPct: a.trendPct,
    });
    // One throw anywhere in renderVals blanks every screen, so this block is fenced:
    // a row the API shapes unexpectedly costs the Accounts screen its last update, not
    // the whole app (DESIGN-35 binding, 2026-09-08, point 2).
    const accStore = FD.screens.accounts;
    let accRows = null;
    try {
      const live = FD.fixture.accountsLive;
      if (live) accStore.lastGood = accRows = live.map(accView);
    } catch (e) {
      console.error(e);
      accRows = accStore.lastGood || null;
    }
    const accLive = !!accRows;
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
      /* L2 (D03): live rows arrive as FD.setData('l2Groups', …). The seed below is
       * the mock's, so fixture mode renders exactly as before. A live item may carry
       * `tone` — 'muted' idle, 'good' tile open, 'warn' kill-requested (BEHAVIOUR §1). */
      groups: (Array.isArray(FD.fixture.l2Groups) ? FD.fixture.l2Groups : [
        { box: 'onboarding-box', n: 1, items: [{ n: 'ops' }] },
        { box: 'german-box', n: gbSessions.length, items: gbSessions.map((n) => ({ n })) },
      ]).map((g) => ({
        box: g && g.box, n: g && g.n,
        items: (g && Array.isArray(g.items) ? g.items : []).map((s) => ({ n: s && s.n, dotStyle: dot(s && s.tone === 'warn' ? t.warn : s && s.tone === 'muted' ? t.ink35 : t.good) })),
      })),
      /* L2 (D05): live bars arrive as FD.setData('l2Accounts', …); an item may carry
       * a ready-made `txt` (BEHAVIOUR §3 prints '—' where the mock prints 'no data'). */
      miniAccounts: (Array.isArray(FD.fixture.l2Accounts) ? FD.fixture.l2Accounts : [
        { prov: 'gpt', name: 'admin@deus.finance', pct: 80 }, { prov: 'claude', name: 'admin@deus.finance', pct: 71 }, { prov: 'claude', name: 'neelo@vibe.trading', pct: null }, { prov: 'claude', name: 'lafayette@infinite-holdings.llc', pct: null }, { prov: 'claude', name: 'aylianator@gmail.com', pct: null },
      ]).map((a0) => {
        const a = a0 || {};
        const has = a.pct != null;
        return {
          name: a.name, txt: a.txt != null ? a.txt : (has ? a.pct + '%' : 'no data'),
          isGpt: a.prov === 'gpt', isClaude: a.prov === 'claude', provTitle: a.prov === 'gpt' ? 'ChatGPT' : 'Claude',
          provStyle: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '14px', height: '14px', color: has ? t.ink75 : t.ink35 },
          nameStyle: { fontFamily: mono, fontSize: '11px', color: has ? t.ink75 : t.ink45, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
          txtStyle: { fontSize: '11px', color: has ? (a.pct >= 70 ? t.warn : t.ink75) : t.ink35, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
          fillStyle: barFill(a.pct, has ? (a.pct > 90 ? t.bad : a.pct >= 70 ? t.warn : t.good) : t.good),
        };
      }),
      gptLogoStyle: { width: '12px', height: '12px', objectFit: 'contain', display: 'block', filter: dark ? 'invert(1)' : 'none', opacity: 0.85 },
      claudeLogoStyle: { width: '12px', height: '12px', objectFit: 'contain', display: 'block' },
      /* L2 (D05): live health arrives as FD.setData('l2Boxes', …); tone 'bad' is the
       * red pill of BEHAVIOUR §2, which the mock's two seed rows never reach. */
      boxRows: (Array.isArray(FD.fixture.l2Boxes) ? FD.fixture.l2Boxes : [
        { name: 'german-box', st: 'holder OK', tone: 'good' },
        { name: 'onboarding-box', st: 'reachable', tone: 'good' },
      ]).map((b0) => (b0 || {})).map((b) => ({ name: b.name, st: b.st, dotStyle: dot(b.tone === 'good' ? t.good : b.tone === 'bad' ? t.bad : t.warn), stStyle: { fontSize: '11px', color: t.ink45, whiteSpace: 'nowrap' } })),
      // windows — live tiles come from the screen file via FD.setData('l3Tiles')
      tiles: l3Try('tiles', () => (l3Live ? (FD.fixture.l3Tiles || []) : [
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
      ]).map((tl) => ({ ...tl, openTerm: () => (l3Live && FD.screens.windows ? FD.screens.windows.openMax(tl.box, tl.name) : openTerm(tl.name, tl.box)) }))),
      // org
      orgSort, orgScope,
      orgSortLabel: 'Sorted by ' + orgSort,
      toggleOrgSort: () => this.setState({ orgSort: orgSort === 'machine' ? 'project' : 'machine', orgScope: null }),
      setOrgScope: (e) => this.setState({ orgScope: e.target.value }),
      orgScopes: orgScopeList.map((k) => ({ label: k })),
      orgSortBtnStyle: { borderRadius: '9999px', border: '1px solid ' + t.line, background: t.inputBg, color: t.ink75, padding: '7px 12px', fontSize: '12px', cursor: 'pointer', width: '150px', textAlign: 'center', transition: 'background .2s' },
      orgScopeSelectStyle: { borderRadius: '9999px', border: '1px solid ' + t.line, background: t.inputBg, color: t.ink75, padding: '7px 12px', fontSize: '12px', cursor: 'pointer', fontFamily: mono, width: '230px', appearance: 'none', WebkitAppearance: 'none', paddingRight: '30px', backgroundImage: 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="' + t.ink45 + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>') + '")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' },
      orgMsgBtnStyle: { marginTop: '4px', width: '100%', borderRadius: '9999px', border: '1px solid ' + t.line, background: t.inputBg, color: t.ink, padding: '8px 14px', fontSize: '13px', cursor: 'pointer', transition: 'background .2s' },
      orgAttached: !this.state.orgTab || this.state.orgTab === 'attached',
      orgUnattached: this.state.orgTab === 'unattached',
      showAttached: () => this.setState({ orgTab: 'attached' }),
      showUnattached: () => this.setState({ orgTab: 'unattached' }),
      tabAttachedStyle: orgTabStyle(!this.state.orgTab || this.state.orgTab === 'attached'),
      tabUnattachedStyle: orgTabStyle(this.state.orgTab === 'unattached'),
      ...this._orgLive({ t, dot, chipTone, mono, orgSort, orgScope, orgKidList, orgCard }),
      // registry
      // BEHAVIOUR §2: the count reads "<n> rows" or "<k> of <n> rows"; the
      // template supplies the " rows" suffix, so live mode hands over the
      // "<k> of <n>" string and fixture mode the plain number, as the mock does.
      q: l4 ? l4.q : this.state.q,
      rowCount: l4 ? l4.count : filtered.length,
      regRows,
      setQ: (e) => (l4 ? regScreen.setFilter('q', e.target.value) : this.setState({ q: e.target.value })),
      resetFilters: () => (l4 ? regScreen.reset() : this.setState({ q: '', sel: {} })),
      hasSel: selCount > 0, selCount,
      allSel: selCount > 0 && selCount === filtered.length,
      toggleAll: () => {
        if (l4) return regScreen.toggleAll();
        const all = selCount === filtered.length;
        const s2 = {};
        if (!all) filtered.forEach((r) => { s2[r.id] = true; });
        this.setState({ sel: s2 });
      },
      clearSel: () => (l4 ? regScreen.clearSel() : this.setState({ sel: {} })),
      // bus
      ...busVals, ...termVals,
      /* L2 (D03): the sidebar nav badge is shell chrome. L6 owns the count and
       * reports it through FD.shell.setBadge(n); until it does, busVals wins. */
      ...(typeof FD.fixture.l2Badge !== 'number' ? {} : {
        hasBusUnread: FD.fixture.l2Badge > 0,
        navBadgeText: leftOpen ? String(FD.fixture.l2Badge) : '',
      }),
      // keys
      ttlChips: ['1h', '4h', '8h'].map((v) => ({ t: v, style: selChip(ttl === v), set: () => this.setState({ ttl: v }) })),
      prinChips: ['root', 'vibe'].map((v) => ({ t: v, style: selChip(!!prin[v]), set: () => this.setState({ prin: { ...prin, [v]: !prin[v] } }) })),
      copyCmd: () => { try { navigator.clipboard.writeText('-o IdentitiesOnly=yes -o IdentityAgent=none -i /Users/misterislez/.ssh/deploy-certs/20260906-153509/deployer'); } catch (e) {} },
      keyRows: FD.fixture.keyRows,
      // accounts (fd-v2 L8) — the mock's seed, or the live rows that
      // screens/accounts.js feeds in through FD.setData('accountsLive', ...).
      // S2 could not substitute this seed into fixture.js (the mock literal calls
      // bar()/spark()/chipTone() on it), so L8 reads its own key here instead.
      accounts: (accRows || [
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
      ]).map((a, i) => {
        // Untouched rows keep the mock's default (collapsed). On live data a row at or
        // over a limit — or one carrying a banner — opens by itself, so a wall and a
        // fault are never hidden behind a chevron. improvised.md I-L8-02.
        const aOpen = this.state.aOpen || {};
        const open = i in aOpen ? !!aOpen[i] : (accLive ? !!(a.atLimit || a.banner || a.noData || a.noWindows) : false);
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
      machines: mCards,
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
