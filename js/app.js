/* =====================================================================
   The Captain's Chronometer — app.js
   Plain vanilla JavaScript, no dependencies, no network requests.

   Sections
     0. Utilities
     1. Hybrid clock (timestamp source)
     2. Decorations: rivets, cracked glass, dials, helm
     3. Sound (Web Audio synthesis)
     4. Master timer (Start / Pause / Reset)
     5. Seconds clock
     6. Helm rotation
     7. Tally meter
     8. Microsecond counter
     9. Hourglass countdown
    10. Ship's bell
    11. Main loop and background checker
    12. Controls and keyboard
    13. Service worker
   ===================================================================== */
'use strict';

(function () {
  /* ================================================================
     0. Utilities
     ================================================================ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const motionQuery = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };
  const reducedMotion = () => motionQuery.matches;

  /** localStorage wrapper that never throws (private mode, blocked storage). */
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('chronometer.' + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('chronometer.' + key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }
  };

  /** Format whole seconds as HH:MM:SS (hours may grow past 99). */
  function formatHMS(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  /**
   * Renders a string as one fixed-width span per character so that
   * proportional numerals do not make the readout jitter.
   * Only characters that changed are touched each frame.
   */
  class DigitDisplay {
    constructor(el, interpTail = 0) {
      this.el = el;
      this.interpTail = interpTail; // last N digits are styled as interpolated
      this.spans = [];
      this.text = null;
    }
    setInterpTail(n) { this.interpTail = n; this.text = null; this.spans = []; }
    set(text) {
      if (text === this.text) return;
      if (!this.spans.length || this.spans.length !== text.length) this.build(text);
      for (let i = 0; i < text.length; i++) {
        if (this.spans[i].textContent !== text[i]) this.spans[i].textContent = text[i];
      }
      this.text = text;
    }
    build(text) {
      this.el.textContent = '';
      this.spans = [];
      const totalDigits = text.replace(/\D/g, '').length;
      let seen = 0;
      for (const ch of text) {
        const s = document.createElement('span');
        const isDigit = /\d/.test(ch);
        s.className = isDigit ? 'd' : 'sep';
        if (isDigit) {
          seen++;
          if (seen > totalDigits - this.interpTail) s.classList.add('interp');
        }
        s.setAttribute('aria-hidden', 'true');
        this.el.appendChild(s);
        this.spans.push(s);
      }
    }
  }

  /* ================================================================
     1. Hybrid clock
     performance.now() gives sub-millisecond, monotonic time, but on some
     platforms it stops while the device sleeps. Date.now() keeps counting
     through sleep. We read performance.now() and, if the wall clock shows
     a forward gap of more than one second, we add that gap as an offset.
     Every instrument reads time from here, never from counted ticks.
     ================================================================ */
  const Clock = {
    basePerf: performance.now(),
    baseWall: Date.now(),
    offset: 0,
    now() {
      const perfElapsed = performance.now() - this.basePerf + this.offset;
      const wallElapsed = Date.now() - this.baseWall;
      if (wallElapsed - perfElapsed > 1000) this.offset += wallElapsed - perfElapsed;
      return performance.now() - this.basePerf + this.offset;
    }
  };

  /* ================================================================
     2. Decorations: rivets, cracked glass, dials, helm (all inline SVG)
     ================================================================ */

  /** Small seeded PRNG (mulberry32) so each pane of glass cracks the same way every load. */
  function seededRandom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Ring of brass rivets around a porthole rim. */
  function rivetsSVG(count) {
    let c = '';
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.PI / count;
      const x = 50 + 46.3 * Math.cos(a);
      const y = 50 + 46.3 * Math.sin(a);
      c += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.7" fill="url(#rivetGrad)" stroke="#3a2305" stroke-width=".25"/>`;
    }
    return `<svg class="rim" viewBox="0 0 100 100" aria-hidden="true" focusable="false">${c}</svg>`;
  }

  /**
   * "Old broken glass": crack lines radiating from an impact point with a
   * partial spider-web ring, scratches, dust, reflections and a faint
   * green tint. Kept faint so the readings beneath stay legible.
   */
  function crackedGlassSVG(w, h, seed) {
    const r = seededRandom(seed);
    const id = 'gl' + seed;
    const ix = w * (0.2 + r() * 0.6);
    const iy = h * (0.16 + r() * 0.5);
    const reach = Math.hypot(w, h);
    const rays = 7 + Math.floor(r() * 5);
    const rayPts = [];
    let cracks = '';

    const toPath = pts => 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L');

    for (let k = 0; k < rays; k++) {
      let ang = (k / rays) * Math.PI * 2 + (r() - 0.5) * 0.55;
      let x = ix, y = iy;
      const pts = [[x, y]];
      const segs = 5 + Math.floor(r() * 4);
      const step = (reach * (0.3 + r() * 0.55)) / segs;
      for (let s = 0; s < segs; s++) {
        ang += (r() - 0.5) * 0.38;
        const len = step * (0.7 + r() * 0.6);
        x += Math.cos(ang) * len;
        y += Math.sin(ang) * len;
        pts.push([x, y]);
        // occasional branch
        if (s > 0 && r() < 0.22) {
          let bx = x, by = y, bang = ang + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.5);
          const b = [[bx, by]];
          for (let j = 0; j < 3; j++) {
            bang += (r() - 0.5) * 0.4;
            bx += Math.cos(bang) * step * 0.6;
            by += Math.sin(bang) * step * 0.6;
            b.push([bx, by]);
          }
          cracks += toPath(b) + ' ';
        }
      }
      rayPts.push(pts);
      cracks += toPath(pts) + ' ';
    }

    // Concentric web segments between neighbouring rays
    for (const ring of [1, 2]) {
      for (let k = 0; k < rays; k++) {
        const p = rayPts[k][ring], q = rayPts[(k + 1) % rays][ring];
        if (!p || !q || r() < 0.3) continue;
        const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
        const cx = mx + (ix - mx) * 0.18, cy = my + (iy - my) * 0.18;
        cracks += `M${p[0].toFixed(1)},${p[1].toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${q[0].toFixed(1)},${q[1].toFixed(1)} `;
      }
    }

    // Impact chips
    let chips = '';
    for (let i = 0; i < 6; i++) {
      const a = r() * Math.PI * 2, d = 1.5 + r() * 3.5;
      const x = ix + Math.cos(a) * d, y = iy + Math.sin(a) * d;
      chips += `M${x.toFixed(1)},${y.toFixed(1)} l${(r() * 3 - 1.5).toFixed(1)},${(r() * 3 - 1.5).toFixed(1)} l${(r() * 3 - 1.5).toFixed(1)},${(r() * 3 - 1.5).toFixed(1)} Z `;
    }

    // Scratches
    let scratches = '';
    for (let i = 0; i < 16; i++) {
      const x = r() * w, y = r() * h, a = r() * Math.PI, len = 8 + r() * (w * 0.25);
      const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
      const qx = (x + ex) / 2 + (r() - 0.5) * 6, qy = (y + ey) / 2 + (r() - 0.5) * 6;
      scratches += `M${x.toFixed(1)},${y.toFixed(1)} Q${qx.toFixed(1)},${qy.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)} `;
    }

    // Dust
    let dust = '';
    const dustCount = Math.round((w * h) / 800);
    for (let i = 0; i < dustCount; i++) {
      dust += `<circle cx="${(r() * w).toFixed(1)}" cy="${(r() * h).toFixed(1)}" r="${(0.3 + r() * 0.9).toFixed(2)}" fill="rgba(235,225,195,${(0.12 + r() * 0.2).toFixed(2)})"/>`;
    }

    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="${id}t" cx="50%" cy="45%" r="70%">
          <stop offset="0" stop-color="rgb(120,160,100)" stop-opacity=".05"/>
          <stop offset="1" stop-color="rgb(40,70,40)" stop-opacity=".2"/>
        </radialGradient>
        <linearGradient id="${id}r" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity=".22"/>
          <stop offset=".45" stop-color="#fff" stop-opacity=".04"/>
          <stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#${id}t)"/>
      <ellipse cx="${w * 0.3}" cy="${h * 0.22}" rx="${w * 0.36}" ry="${h * 0.13}" transform="rotate(-28 ${w * 0.3} ${h * 0.22})" fill="url(#${id}r)"/>
      <path d="M${w * 0.62},${h * 0.08} Q${w * 0.86},${h * 0.2} ${w * 0.93},${h * 0.44}" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="${Math.max(1.5, w / 90)}" stroke-linecap="round"/>
      <path d="${scratches}" fill="none" stroke="rgba(255,255,255,.13)" stroke-width=".45"/>
      ${dust}
      <path d="${cracks}" fill="none" stroke="rgba(12,18,10,.4)" stroke-width="1.3" stroke-linejoin="round" transform="translate(.6 .7)"/>
      <path d="${cracks}" fill="none" stroke="rgba(236,250,236,.55)" stroke-width=".65" stroke-linejoin="round"/>
      <path d="${chips}" fill="rgba(255,255,255,.28)" stroke="rgba(255,255,255,.4)" stroke-width=".3"/>
      <circle cx="${ix.toFixed(1)}" cy="${iy.toFixed(1)}" r="2.2" fill="rgba(255,255,255,.35)"/>
    </svg>`;
  }

  function decorateInstruments() {
    document.querySelectorAll('.porthole').forEach((p, i) => {
      const seed = Number(p.dataset.seed) || (i + 1) * 97;
      p.insertAdjacentHTML('afterbegin', rivetsSVG(12));
      const face = p.querySelector('.face');
      face.insertAdjacentHTML('beforeend', `<div class="glass">${crackedGlassSVG(200, 200, seed)}</div>`);
    });
    document.querySelectorAll('.capsule').forEach((c) => {
      const seed = Number(c.dataset.seed) || 1234;
      c.querySelector('.gauge-face').insertAdjacentHTML('beforeend', `<div class="glass">${crackedGlassSVG(640, 120, seed)}</div>`);
    });
  }

  /** Analog seconds dial: 60 ticks, numerals, minute hand, sweeping second hand, hours sub-dial. */
  function buildSecondsDial() {
    const parts = [];
    parts.push('<circle r="98" fill="url(#ivoryFace)"/>');
    parts.push('<circle r="90" fill="none" stroke="#3b2a14" stroke-width="1.1"/><circle r="85" fill="none" stroke="#3b2a14" stroke-width=".5"/>');
    for (let i = 0; i < 60; i++) {
      const a = (i * 6 * Math.PI) / 180;
      const major = i % 5 === 0;
      const r1 = 90, r2 = major ? 78 : 85;
      const sx = Math.sin(a), cy = -Math.cos(a);
      parts.push(`<line x1="${(sx * r1).toFixed(2)}" y1="${(cy * r1).toFixed(2)}" x2="${(sx * r2).toFixed(2)}" y2="${(cy * r2).toFixed(2)}" stroke="#2b1d10" stroke-width="${major ? 1.9 : 0.7}"/>`);
      if (major) {
        parts.push(`<text class="dial-num" x="${(sx * 67).toFixed(2)}" y="${(cy * 67 + 4).toFixed(2)}" text-anchor="middle">${i === 0 ? 60 : i}</text>`);
      }
    }
    parts.push('<text class="dial-label" y="-30" text-anchor="middle">seconds &amp; minutes</text>');
    // hours sub-dial
    let sub = '<circle r="17" fill="rgba(120,80,30,.12)" stroke="#3b2a14" stroke-width=".6"/>';
    for (let i = 0; i < 12; i++) {
      const a = (i * 30 * Math.PI) / 180;
      sub += `<line x1="${(Math.sin(a) * 17).toFixed(2)}" y1="${(-Math.cos(a) * 17).toFixed(2)}" x2="${(Math.sin(a) * 14).toFixed(2)}" y2="${(-Math.cos(a) * 14).toFixed(2)}" stroke="#3b2a14" stroke-width=".6"/>`;
    }
    sub += '<text class="dial-tiny" y="9" text-anchor="middle">HOURS</text>';
    sub += '<g id="hr-hand"><line y1="2" y2="-12.5" stroke="#3b2208" stroke-width="1.6" stroke-linecap="round"/></g><circle r="1.8" fill="#3b2208"/>';
    parts.push(`<g transform="translate(0 36)">${sub}</g>`);
    // minute hand
    parts.push('<g id="min-hand"><path d="M-3.2,9 L-2,-50 L0,-59 L2,-50 L3.2,9 Z" fill="#2e1d0b"/></g>');
    // sweeping second hand
    parts.push('<g id="sec-hand"><line y1="20" y2="-83" stroke="#8b2512" stroke-width="1.3" stroke-linecap="round"/><circle cy="15" r="4.2" fill="#8b2512"/><path d="M0,-72 l3,6 l-3,6 l-3,-6 Z" fill="#8b2512"/></g>');
    parts.push('<circle r="4.6" fill="url(#brassRadial)" stroke="#3d2606" stroke-width=".6"/>');
    $('#secs-dial').innerHTML = parts.join('');
  }

  /** Small millisecond dial inside the microsecond gauge. */
  function buildMsDial() {
    let s = '<circle r="46" fill="#17140c" stroke="url(#brassLinear)" stroke-width="3"/>';
    for (let i = 0; i < 50; i++) {
      const a = (i * 7.2 * Math.PI) / 180;
      const major = i % 5 === 0;
      const r2 = major ? 34 : 38;
      s += `<line x1="${(Math.sin(a) * 42).toFixed(2)}" y1="${(-Math.cos(a) * 42).toFixed(2)}" x2="${(Math.sin(a) * r2).toFixed(2)}" y2="${(-Math.cos(a) * r2).toFixed(2)}" stroke="#e8b85a" stroke-width="${major ? 1.8 : 0.6}"/>`;
    }
    s += '<text x="0" y="22" text-anchor="middle" fill="#ecd9a8" style="font:italic 11px \'IM Fell English\', Georgia, serif">ms</text>';
    s += '<g id="ms-needle"><line y1="8" y2="-38" stroke="#f6c25c" stroke-width="2" stroke-linecap="round"/></g>';
    s += '<circle r="4" fill="url(#brassRadial)"/>';
    $('#ms-dial').innerHTML = s;
  }

  /** The ship's wheel: eight turned spokes with handles, wooden rim, brass straps, rivets and hub. */
  function buildHelm() {
    let wood = '';
    let brass = '';
    for (let i = 0; i < 8; i++) {
      const a = i * 45;
      wood += `<g transform="rotate(${a})">
        <path d="M-6.5,126 L6.5,126 L8,148 C15,156 15,165 9,171 C16,177 13,190 0,195 C-13,190 -16,177 -9,171 C-15,165 -15,156 -8,148 Z" fill="url(#woodSpoke)" stroke="#170b03" stroke-width="1.4"/>
        <path d="M-9,42 L9,42 L6.5,122 L-6.5,122 Z" fill="url(#woodSpoke)" stroke="#170b03" stroke-width="1.2"/>
        <ellipse cx="0" cy="82" rx="10.5" ry="15" fill="url(#woodSpoke)" stroke="#170b03" stroke-width="1.2"/>
        <ellipse cx="0" cy="182" rx="11" ry="3" fill="rgba(255,220,170,.08)"/>
      </g>`;
      brass += `<g transform="rotate(${a})">
        <rect x="-9.5" y="144" width="19" height="6" rx="2" fill="url(#brassLinear)" stroke="#3d2606" stroke-width=".8"/>
        <rect x="-7.5" y="112" width="15" height="32" rx="2.5" fill="url(#brassLinear)" stroke="#3d2606" stroke-width=".8"/>
        <circle cx="0" cy="119" r="2.3" fill="url(#rivetGrad)"/>
        <circle cx="0" cy="137" r="2.3" fill="url(#rivetGrad)"/>
      </g>
      <g transform="rotate(${a + 22.5})"><circle cx="0" cy="128" r="3.8" fill="url(#rivetGrad)" stroke="#3a2305" stroke-width=".6"/></g>`;
    }
    const rim = `
      <circle r="128" fill="none" stroke="#1a0d04" stroke-width="31"/>
      <circle r="128" fill="none" stroke="url(#woodRim)" stroke-width="27"/>
      <circle r="122" fill="none" stroke="rgba(255,220,170,.10)" stroke-width="1"/>
      <circle r="134" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="1"/>`;
    const rings = `
      <circle r="116.5" fill="none" stroke="url(#brassLinear)" stroke-width="2.4"/>
      <circle r="139.5" fill="none" stroke="url(#brassLinear)" stroke-width="2.4"/>`;
    // hub with compass star
    let hubRivets = '';
    for (let i = 0; i < 8; i++) {
      const a = ((i * 45 + 22.5) * Math.PI) / 180;
      hubRivets += `<circle cx="${(Math.sin(a) * 41).toFixed(2)}" cy="${(-Math.cos(a) * 41).toFixed(2)}" r="2.6" fill="url(#rivetGrad)"/>`;
    }
    let star = '';
    for (let i = 0; i < 16; i++) {
      const a = (i * 22.5 * Math.PI) / 180;
      const rr = i % 2 === 0 ? (i % 4 === 0 ? 17 : 11) : 4.5;
      star += `${(Math.sin(a) * rr).toFixed(2)},${(-Math.cos(a) * rr).toFixed(2)} `;
    }
    const hub = `
      <circle r="49" fill="url(#brassRadial)" stroke="#2e1c04" stroke-width="2"/>
      ${hubRivets}
      <circle r="34" fill="url(#woodRim)" stroke="#2e1c04" stroke-width="1.5"/>
      <circle r="21" fill="url(#brassRadial)" stroke="#2e1c04" stroke-width="1.2"/>
      <polygon points="${star.trim()}" fill="rgba(70,40,6,.55)" stroke="rgba(255,240,200,.35)" stroke-width=".5"/>
      <circle r="3" fill="#2e1c04"/>`;

    $('#helm-svg').innerHTML =
      `<g filter="url(#weathered)">${wood}${rim}<circle r="34" fill="url(#woodRim)"/></g>${rings}${brass}${hub}`;
  }

  /* ================================================================
     3. Sound: everything synthesized with the Web Audio API
     ================================================================ */
  const Sound = {
    ctx: null,
    master: null,
    muted: store.get('muted', false),

    /** Create or resume the AudioContext. Must first be called from a user gesture. */
    ensure() {
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return null;
          this.ctx = new AC();
          this.master = this.ctx.createGain();
          this.master.gain.value = 0.55;
          const comp = this.ctx.createDynamicsCompressor();
          this.master.connect(comp);
          comp.connect(this.ctx.destination);
        }
        if (this.ctx.state === 'suspended') {
          const p = this.ctx.resume();
          if (p && p.catch) p.catch(() => {});
        }
        return this.ctx;
      } catch (e) {
        return null;
      }
    },

    /** One bell strike: a sum of inharmonic sine partials with exponential decay. */
    strike(when, f0 = 587, loudness = 1) {
      const ctx = this.ctx;
      const partials = [
        [0.5, 0.35, 3.8], // hum
        [1.0, 1.0, 3.2],  // fundamental
        [1.19, 0.45, 2.4],
        [2.0, 0.5, 2.0],
        [2.76, 0.4, 1.5],
        [5.4, 0.18, 0.9],
        [8.93, 0.08, 0.6]
      ];
      for (const [ratio, amp, decay] of partials) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = f0 * ratio;
        g.gain.setValueAtTime(0.0001, when);
        g.gain.linearRampToValueAtTime(0.22 * amp * loudness, when + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
        osc.connect(g);
        g.connect(this.master);
        osc.start(when);
        osc.stop(when + decay + 0.05);
      }
    },

    /** Ship's-bell pattern: strikes grouped in pairs. Returns true if sound was played. */
    bells(count) {
      if (this.muted) return false;
      const ctx = this.ensure();
      if (!ctx) return false;
      const t0 = ctx.currentTime + 0.05;
      for (let i = 0; i < count; i++) {
        this.strike(t0 + Math.floor(i / 2) * 0.95 + (i % 2) * 0.38);
      }
      return true;
    },

    /** Hourglass alarm: three urgent triplets on a higher bell. */
    alarm() {
      if (this.muted) return false;
      const ctx = this.ensure();
      if (!ctx) return false;
      const t0 = ctx.currentTime + 0.05;
      for (let i = 0; i < 9; i++) {
        this.strike(t0 + i * 0.2 + Math.floor(i / 3) * 0.45, 880, 0.9);
      }
      return true;
    }
  };

  /* ================================================================
     4. Master timer: elapsed = accumulated + (now - startedAt)
     ================================================================ */
  const Timer = {
    running: false,
    startedAt: 0,
    accumulated: 0,
    elapsedMs() {
      return this.accumulated + (this.running ? Clock.now() - this.startedAt : 0);
    },
    start() {
      if (this.running) return;
      this.startedAt = Clock.now();
      this.running = true;
    },
    pause() {
      if (!this.running) return;
      this.accumulated += Clock.now() - this.startedAt;
      this.running = false;
    },
    reset() {
      this.running = false;
      this.accumulated = 0;
      this.startedAt = 0;
    }
  };

  /* ================================================================
     5. Seconds clock (digital HH:MM:SS + analog dial)
     ================================================================ */
  const SecondsClock = {
    digital: null,
    lastSecond: -1,
    init() {
      buildSecondsDial();
      this.digital = new DigitDisplay($('#secs-digital'));
      this.secHand = $('#sec-hand');
      this.minHand = $('#min-hand');
      this.hrHand = $('#hr-hand');
    },
    render(ms) {
      const totalSec = Math.floor(ms / 1000);
      if (totalSec !== this.lastSecond) {
        const text = formatHMS(totalSec);
        this.digital.set(text);
        $('#secs-digital').setAttribute('aria-label', 'Elapsed time ' + text);
        this.lastSecond = totalSec;
      }
      // Smooth sweep: angle comes straight from elapsed milliseconds
      this.secHand.setAttribute('transform', `rotate(${(((ms % 60000) / 60000) * 360).toFixed(2)})`);
      this.minHand.setAttribute('transform', `rotate(${(((ms % 3600000) / 3600000) * 360).toFixed(2)})`);
      this.hrHand.setAttribute('transform', `rotate(${(((ms % 43200000) / 43200000) * 360).toFixed(2)})`);
    }
  };

  /* ================================================================
     6. Helm rotation (slow turn while running; disabled for reduced motion)
     ================================================================ */
  const Helm = {
    el: null,
    DEG_PER_SECOND: 4, // one full turn every 90 seconds
    init() {
      buildHelm();
      this.el = $('#helm');
    },
    render(ms) {
      const angle = reducedMotion() ? 0 : ((ms / 1000) * this.DEG_PER_SECOND) % 360;
      this.el.style.transform = `rotate(${angle.toFixed(2)}deg)`;
    }
  };

  /* ================================================================
     7. Tally meter: mechanical odometer, +1 per elapsed second
     ================================================================ */
  class Odometer {
    constructor(el, places) {
      this.el = el;
      this.places = places;
      this.strips = [];
      this.digits = [];
      this.timers = [];
      this.value = 0;
      for (let i = 0; i < places; i++) {
        const wheel = document.createElement('span');
        wheel.className = 'wheel' + (i === places - 1 ? ' units' : '');
        wheel.setAttribute('aria-hidden', 'true');
        const strip = document.createElement('span');
        strip.className = 'strip';
        // 0-9 plus a trailing 0 so 9 -> 0 can roll forward before snapping back
        for (let d = 0; d <= 10; d++) {
          const s = document.createElement('span');
          s.textContent = String(d % 10);
          strip.appendChild(s);
        }
        strip.style.setProperty('--pos', '0');
        wheel.appendChild(strip);
        el.appendChild(wheel);
        this.strips.push(strip);
        this.digits.push(0);
      }
    }

    /** Jump a wheel to a digit with no animation. */
    snap(strip, pos) {
      strip.classList.add('no-anim');
      strip.style.setProperty('--pos', String(pos));
      void strip.offsetHeight; // flush so the next change animates again
      strip.classList.remove('no-anim');
    }

    set(value) {
      if (value === this.value && this.el.dataset.value === String(value)) return;
      const str = pad(value % Math.pow(10, this.places), this.places);
      const singleStep = value - this.value === 1;
      const animate = singleStep && !reducedMotion() && document.visibilityState === 'visible';
      for (let i = 0; i < this.places; i++) {
        const d = Number(str[i]);
        const prev = this.digits[i];
        if (d === prev) continue;
        const strip = this.strips[i];
        clearTimeout(this.timers[i]);
        if (animate && prev === 9 && d === 0) {
          // roll forward onto the extra 0, then quietly snap back to the first 0
          strip.style.setProperty('--pos', '10');
          this.timers[i] = setTimeout(() => this.snap(strip, 0), 460);
        } else if (animate && d === prev + 1) {
          strip.style.setProperty('--pos', String(d));
        } else {
          this.snap(strip, d);
        }
        this.digits[i] = d;
      }
      this.value = value;
      this.el.dataset.value = String(value);
      this.el.setAttribute('aria-label', `Tally meter: ${value} ${value === 1 ? 'second' : 'seconds'}`);
    }
  }

  const Tally = {
    odo: null,
    init() { this.odo = new Odometer($('#tally'), 6); },
    render(ms) { this.odo.set(Math.floor(ms / 1000)); }
  };

  /* ================================================================
     8. Microsecond counter
     The browser rounds performance.now() (often to 100 µs, 1 ms or more).
     We measure that step once, and the digits finer than it are filled
     in each frame purely for visual liveliness. Higher digits are real.
     ================================================================ */
  const Micro = {
    display: null,
    tailDigits: 3,
    frozenTail: 0,
    lastLabelSec: -1,

    /** Busy-sample performance.now() briefly to estimate its resolution in ms. */
    detectResolution() {
      let min = Infinity;
      let last = performance.now();
      const deadline = last + 40;
      let changes = 0;
      while (changes < 25) {
        const t = performance.now();
        if (t !== last) {
          min = Math.min(min, t - last);
          last = t;
          changes++;
        }
        if (t > deadline) break;
      }
      return Number.isFinite(min) && min > 0 ? min : 1;
    },

    init() {
      const resUs = Math.max(1, Math.round(this.detectResolution() * 1000));
      // number of digits below the timer step, clamped to a sensible range
      this.tailDigits = clamp(Math.ceil(Math.log10(resUs)), 1, 6);
      this.display = new DigitDisplay($('#micro-digits'), this.tailDigits);
      buildMsDial();
      this.needle = $('#ms-needle');
      const stepText = resUs >= 1000 ? `${(resUs / 1000).toFixed(resUs % 1000 ? 1 : 0)} ms` : `${resUs} µs`;
      $('#micro-precision').textContent =
        `This browser's timer moves in steps of about ${stepText}, so the last ${this.tailDigits === 1 ? 'digit (dotted) is' : this.tailDigits + ' digits (dotted) are'}`;
    },

    render(ms, running) {
      const us = Math.floor(ms * 1000);
      const unit = Math.pow(10, this.tailDigits);
      let tail;
      if (us === 0) tail = 0;
      else if (running) tail = Math.floor(Math.random() * unit); // visual interpolation only
      else tail = this.frozenTail;
      this.frozenTail = tail;
      const shown = (Math.floor(us / unit) * unit + tail) % 1e12;
      const raw = pad(shown, 12);
      this.display.set(raw.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
      this.needle.setAttribute('transform', `rotate(${(((ms % 1000) / 1000) * 360).toFixed(1)})`);
      const sec = Math.floor(ms / 1000);
      if (sec !== this.lastLabelSec || !running) {
        $('#micro-digits').setAttribute('aria-label', `Elapsed microseconds: about ${Math.floor(us / unit) * unit}`);
        this.lastLabelSec = sec;
      }
    }
  };

  /* ================================================================
     9. Hourglass countdown (independent of the master timer)
     ================================================================ */
  const Hourglass = {
    durationMs: 0,
    remainingMs: 0,
    endAt: 0,
    running: false,
    alarmCount: 0,
    lastShown: '',

    init() {
      this.card = $('#hourglass-card');
      this.svg = $('#hourglass-svg');
      this.minInput = $('#hg-min');
      this.secInput = $('#hg-sec');
      this.btnStart = $('#hg-start');
      this.btnPause = $('#hg-pause');
      this.btnReset = $('#hg-reset');
      this.status = $('#hg-status');
      this.sandTop = $('#sand-top');
      this.sandBottom = $('#sand-bottom');
      this.stream = $('#sand-stream');
      this.display = new DigitDisplay($('#hg-display'));

      this.minInput.value = store.get('hgMin', 3);
      this.secInput.value = store.get('hgSec', 0);
      this.reset(true);

      this.btnStart.addEventListener('click', () => { Sound.ensure(); this.start(); });
      this.btnPause.addEventListener('click', () => this.pause());
      this.btnReset.addEventListener('click', () => this.reset());
      const onInput = () => {
        store.set('hgMin', this.minInput.value);
        store.set('hgSec', this.secInput.value);
        if (!this.running) this.reset(true);
      };
      this.minInput.addEventListener('change', onInput);
      this.secInput.addEventListener('change', onInput);
      this.minInput.addEventListener('input', onInput);
      this.secInput.addEventListener('input', onInput);
    },

    readInputs() {
      const m = clamp(parseInt(this.minInput.value, 10) || 0, 0, 99);
      const s = clamp(parseInt(this.secInput.value, 10) || 0, 0, 59);
      return (m * 60 + s) * 1000;
    },

    remaining() {
      return this.running ? Math.max(0, this.endAt - Clock.now()) : this.remainingMs;
    },

    start() {
      if (this.running) return;
      if (this.remainingMs <= 0) {
        this.durationMs = this.readInputs();
        this.remainingMs = this.durationMs;
      }
      if (this.durationMs <= 0) {
        this.status.textContent = 'Set at least one second of sand first.';
        return;
      }
      this.card.classList.remove('alarm');
      this.endAt = Clock.now() + this.remainingMs;
      this.running = true;
      if (!reducedMotion()) {
        this.svg.classList.remove('turned');
        void this.svg.getBoundingClientRect();
        this.svg.classList.add('turned');
      }
      this.status.textContent = 'The sand is falling.';
      this.syncUI();
    },

    pause() {
      if (!this.running) return;
      this.remainingMs = this.remaining();
      this.running = false;
      this.status.textContent = 'Hourglass laid on its side (paused).';
      this.syncUI();
    },

    reset(silent) {
      this.running = false;
      this.durationMs = this.readInputs();
      this.remainingMs = this.durationMs;
      this.card.classList.remove('alarm');
      if (!silent) this.status.textContent = 'Set the sand and turn the glass.';
      this.syncUI();
      this.render();
    },

    /** Called from both the animation frame and the background interval. */
    check() {
      if (this.running && this.remaining() <= 0) {
        this.running = false;
        this.remainingMs = 0;
        this.fire();
        this.syncUI();
        this.render();
      }
    },

    fire() {
      this.alarmCount++;
      this.card.dataset.alarmCount = String(this.alarmCount);
      this.card.classList.add('alarm');
      Sound.alarm();
      if (navigator.vibrate) { try { navigator.vibrate([250, 120, 250, 120, 400]); } catch (e) { /* ignore */ } }
      this.status.textContent = "Time's up! The hourglass has run dry.";
    },

    syncUI() {
      this.btnStart.disabled = this.running;
      this.btnPause.disabled = !this.running;
      this.minInput.disabled = this.running;
      this.secInput.disabled = this.running;
      this.svg.classList.toggle('running', this.running);
      const label = this.remainingMs > 0 && this.remainingMs < this.durationMs && !this.running ? 'Resume' : 'Turn';
      this.btnStart.querySelector('.plate-title').textContent = label;
      this.btnStart.setAttribute('aria-label', label === 'Resume' ? 'Resume the hourglass' : 'Turn the hourglass and start the countdown');
    },

    render() {
      const rem = this.remaining();
      const frac = this.durationMs > 0 ? rem / this.durationMs : 0;
      // sand geometry
      const topH = 62 * frac;
      this.sandTop.setAttribute('y', (100 - topH).toFixed(2));
      this.sandTop.setAttribute('height', topH.toFixed(2));
      const pile = this.durationMs > 0 ? 58 * (1 - frac) : 0;
      const top = 180 - pile;
      this.sandBottom.setAttribute('d',
        `M28,180 L28,${(180 - pile * 0.55).toFixed(2)} Q60,${(180 - pile * 1.3).toFixed(2)} 92,${(180 - pile * 0.55).toFixed(2)} L92,180 Z`);
      this.stream.setAttribute('y2', Math.max(100, top - pile * 0.2).toFixed(2));
      this.stream.setAttribute('opacity', this.running && rem > 0 ? '0.95' : '0');
      // readout
      const secs = Math.ceil(rem / 1000);
      const text = `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;
      if (text !== this.lastShown) {
        this.display.set(text);
        $('#hg-display').setAttribute('aria-label', 'Hourglass remaining ' + text);
        this.lastShown = text;
      }
    }
  };

  /* ================================================================
     10. Ship's bell: chimes every 30 minutes of sailing (elapsed) time.
     Traditional count: 1 bell at 0:30, 2 at 1:00 ... 8 at 4:00, then repeat.
     ================================================================ */
  const Bell = {
    HALF_HOUR_MS: 30 * 60 * 1000,
    enabled: store.get('bellEnabled', true),
    lastMark: 0,
    count: 0,
    lastNext: '',

    init() {
      this.card = $('#bell-card');
      this.body = $('#bell-body');
      this.btnToggle = $('#bell-toggle');
      this.btnMute = $('#bell-mute');
      this.btnTest = $('#bell-test');
      this.status = $('#bell-status');
      this.nextDisplay = new DigitDisplay($('#bell-next'));

      this.btnToggle.addEventListener('click', () => {
        this.enabled = !this.enabled;
        store.set('bellEnabled', this.enabled);
        this.status.textContent = this.enabled
          ? 'Half-hour chimes are on.'
          : 'Half-hour chimes are off. The bell stays silent.';
        this.syncUI();
      });
      this.btnMute.addEventListener('click', () => {
        Sound.muted = !Sound.muted;
        store.set('muted', Sound.muted);
        this.status.textContent = Sound.muted ? 'All sounds muted.' : 'Sound restored.';
        this.syncUI();
      });
      this.btnTest.addEventListener('click', () => {
        Sound.ensure();
        this.ring(1, true);
      });
      this.syncUI();
    },

    syncUI() {
      this.btnToggle.setAttribute('aria-pressed', String(this.enabled));
      this.btnToggle.querySelector('.plate-title').textContent = 'Chimes: ' + (this.enabled ? 'On' : 'Off');
      this.btnMute.setAttribute('aria-pressed', String(Sound.muted));
      this.btnMute.querySelector('.plate-title').textContent = 'Mute: ' + (Sound.muted ? 'On' : 'Off');
    },

    ring(strikes, manual) {
      const played = Sound.bells(strikes);
      this.count++;
      this.card.dataset.bellCount = String(this.count);
      if (!reducedMotion()) {
        this.body.classList.remove('ringing');
        void this.body.getBoundingClientRect();
        this.body.classList.add('ringing');
      }
      if (!manual) {
        this.status.textContent = `${strikes} ${strikes === 1 ? 'bell' : 'bells'} struck${played ? '' : ' (muted)'}.`;
      }
    },

    /** Called from the frame loop and the background interval. */
    check() {
      const mark = Math.floor(Timer.elapsedMs() / this.HALF_HOUR_MS);
      if (mark > this.lastMark) {
        this.lastMark = mark;
        if (this.enabled && Timer.running) this.ring(((mark - 1) % 8) + 1, false);
      }
    },

    reset() {
      this.lastMark = 0;
    },

    render(ms) {
      const left = Math.ceil((this.HALF_HOUR_MS - (ms % this.HALF_HOUR_MS)) / 1000);
      const text = `${pad(Math.floor(left / 60))}:${pad(left % 60)}`;
      if (text !== this.lastNext) {
        this.nextDisplay.set(text);
        this.lastNext = text;
      }
    }
  };

  /* ================================================================
     11. Main loop (requestAnimationFrame) and background checker
     ================================================================ */
  let needsRender = true;

  function renderAll() {
    const ms = Timer.elapsedMs();
    SecondsClock.render(ms);
    Helm.render(ms);
    Tally.render(ms);
    Micro.render(ms, Timer.running);
    Bell.render(ms);
  }

  function frame() {
    Hourglass.check();
    Bell.check();
    if (Timer.running || needsRender) {
      renderAll();
      needsRender = false;
    }
    if (Hourglass.running) Hourglass.render();
    requestAnimationFrame(frame);
  }

  // requestAnimationFrame pauses in hidden tabs; this keeps alarms and
  // bells on time. It only checks timestamps, so throttling cannot skew it.
  setInterval(() => {
    Hourglass.check();
    Bell.check();
  }, 250);

  document.addEventListener('visibilitychange', () => { needsRender = true; });
  if (motionQuery.addEventListener) motionQuery.addEventListener('change', () => { needsRender = true; });

  /* ================================================================
     12. Master controls and keyboard
     ================================================================ */
  const ui = {};

  function setVoyageStatus() {
    const ms = Timer.elapsedMs();
    if (Timer.running) ui.status.textContent = 'Under way. The chronometer is running.';
    else if (ms > 0) ui.status.textContent = `Becalmed. Paused at ${formatHMS(Math.floor(ms / 1000))}.`;
    else ui.status.textContent = 'At anchor. Press Start to set sail.';
  }

  function syncControls() {
    ui.start.disabled = Timer.running;
    ui.pause.disabled = !Timer.running;
    ui.reset.disabled = !Timer.running && Timer.elapsedMs() === 0;
    const resumed = !Timer.running && Timer.elapsedMs() > 0;
    ui.start.querySelector('.plate-sub').textContent = resumed ? 'Make sail again' : 'Weigh anchor';
    ui.start.setAttribute('aria-label', resumed ? 'Resume the chronometer' : 'Start the chronometer');
    document.body.classList.toggle('is-running', Timer.running);
  }

  /** Move focus to a sensible enabled button when the focused one becomes disabled. */
  function keepFocus(preferred) {
    if (document.activeElement && document.activeElement.disabled) preferred.focus();
  }

  function doStart() {
    Sound.ensure();
    Timer.start();
    syncControls(); setVoyageStatus(); needsRender = true;
    keepFocus(ui.pause);
  }
  function doPause() {
    Timer.pause();
    syncControls(); setVoyageStatus(); needsRender = true;
    keepFocus(ui.start);
  }
  function doReset() {
    Timer.reset();
    Bell.reset();
    syncControls(); setVoyageStatus(); needsRender = true;
    keepFocus(ui.start);
  }

  function initControls() {
    ui.start = $('#btn-start');
    ui.pause = $('#btn-pause');
    ui.reset = $('#btn-reset');
    ui.status = $('#voyage-status');
    ui.start.addEventListener('click', doStart);
    ui.pause.addEventListener('click', doPause);
    ui.reset.addEventListener('click', doReset);

    // Brief pressed state for keyboard activation too
    document.querySelectorAll('.brass-btn').forEach((b) => {
      b.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') b.classList.add('pressed'); });
      b.addEventListener('keyup', () => b.classList.remove('pressed'));
      b.addEventListener('blur', () => b.classList.remove('pressed'));
    });

    // Global shortcuts (ignored while typing or when a button has focus,
    // so Space never triggers twice)
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      const tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || (t && t.isContentEditable)) return;
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        Timer.running ? doPause() : doStart();
      } else if (e.key === 'r' || e.key === 'R') {
        doReset();
      }
    });
    syncControls();
  }

  /* ================================================================
     13. Service worker (offline support). Skipped on file:// URLs.
     ================================================================ */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
    });
  }

  /* ================================================================
     Boot
     ================================================================ */
  function boot() {
    decorateInstruments();
    SecondsClock.init();
    Helm.init();
    Tally.init();
    Micro.init();
    Hourglass.init();
    Bell.init();
    initControls();
    renderAll();
    requestAnimationFrame(frame);
  }

  registerServiceWorker();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
