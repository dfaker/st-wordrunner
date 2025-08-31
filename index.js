// WordRunner Auto — SillyTavern UI Extension
// Hooks MESSAGE_RECEIVED / CHARACTER_MESSAGE_RENDERED / STREAM_TOKEN_RECEIVED
// and auto-RSVPs the newest AI message.
// Uses the official extension APIs: getContext(), eventSource.on(), extensionSettings, saveSettingsDebounced().

(() => {
  const MODULE = 'third-party/Extension-WordRunnerAuto';
  const DEFAULTS = Object.freeze({
    enabled: true,
    defaultWPM: 350,
    rampWords: 12,           // words to reach full speed
    rampStartFactor: 0.5,    // start at 50% speed
    rampCurveExp: 0.7,       // curve exponent (1.0 = linear)
    dwellComposeMult: 2.0,   // × baseDelay before compose opens
    sentencePauseMult: 1.6,  // end-of-sentence pause
    commaPauseMult: 1.25,    // short pause
    longLen1: 10, longMul1: 1.25, // very long word
    longLen2: 7,  longMul2: 1.10, // long word
    streamThrottleMs: 80,    // throttle for STREAM_TOKEN_RECEIVED
    stableTokenize: true,    // drop trailing partial word while streaming
    suppressGreeting: true,  // don’t auto-read the very first AI greeting
    perMessageButton: true,   // show WR button in extraMesButtons tray
    theme: 'default', // default | dark-red | dark-blue | sepia | paper
    fontMinPx: 32,
    fontPreferredVw: 8,
    fontMaxPx: 84,

  });

  // --- ST context shims ------------------------------------------------------
  function ctx() { return SillyTavern.getContext(); }
  function getSettings() {
    const { extensionSettings, saveSettingsDebounced } = ctx();
    if (!extensionSettings[MODULE]) extensionSettings[MODULE] = {};
  
    let dirty = false;
    for (const k of Object.keys(DEFAULTS)) {
      if (!Object.hasOwn(extensionSettings[MODULE], k)) {
        extensionSettings[MODULE][k] = DEFAULTS[k];
        dirty = true;
      }
    }
    if (dirty) saveSettingsDebounced(); // only save if we actually wrote defaults


    return extensionSettings[MODULE];
  }

function renderSettingsPanel() {
  const settings = getSettings();
  const root = document.querySelector('#extensions_settings');
  if (!root) return;

  // Create container once
  let container = document.querySelector('#wordrunner_container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'wordrunner_container';
    container.className = 'extension_container';
    container.innerHTML = `
  <div id="wordrunner_settings">
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>WordRunner</b>
        <div class="inline-drawer-icon fa-solid interactable up fa-circle-chevron-up" tabindex="0"></div>
      </div>
      <div class="inline-drawer-content" style="display:none;">
        <div class="wordrunner_block" style="margin-bottom:.5rem;">
          <label class="checkbox_label" for="wra_enabled">
            <input type="checkbox" id="wra_enabled" name="wra_enabled">
            <small data-i18n="Enabled">Enabled</small>
          </label>
        </div>

        <div class="tts_block">
          <label for="wra_theme"><small>Theme</small></label>
          <select id="wra_theme" class="flex1">
            <option value="default">Default</option>
            <option value="dark-red">Dark / Red</option>
            <option value="dark-blue">Dark / Blue</option>
            <option value="sepia">Sepia</option>
            <option value="paper">Paper</option>
          </select>
        </div>

        <div class="range-block">
          <div class="range-block-title justifyLeft"><small>Font Size</small></div>
          <div class="range-block-range-and-counter">
            <label>Min px <input class="text_pole" type="number" id="wra_font_min" min="12" max="80"></label>
            <label>Preferred vw <input class="text_pole" type="number" id="wra_font_pref" min="1" max="20" step="0.5"></label>
            <label>Max px <input class="text_pole" type="number" id="wra_font_max" min="40" max="200"></label>
          </div>
        </div>

        <hr>

        <div class="range-block">
          <div class="range-block-title justifyLeft">
            <small data-i18n="Default WPM">Default Speed (Words per Minute)</small>
          </div>
          <div class="range-block-range-and-counter">
            <div class="range-block-range">
              <input type="range" id="wra_wpm" min="100" max="1200" step="10">
            </div>
            <div class="range-block-counter">
              <input type="number" class="text_pole" id="wra_wpm_counter" min="100" max="1200" step="10" data-for="wra_wpm">
            </div>
          </div>
        </div>

        <div class="range-block">
          <div class="range-block-title justifyLeft"><small>Ramp-up (gradual speed build)</small></div>
          <div class="range-block-range-and-counter">
            <label>Words to reach full speed
              <input type="range" id="wra_ramp_words" min="1" max="30" step="1">
            </label>
            <input type="number" class="text_pole" id="wra_ramp_words_counter" min="1" max="30" step="1" data-for="wra_ramp_words">
          </div>
          <div class="range-block-range-and-counter">
            <label>Starting fraction of speed
              <input type="range" id="wra_ramp_start" min="0.3" max="0.9" step="0.05">
            </label>
            <input type="number" class="text_pole" id="wra_ramp_start_counter" min="0.3" max="0.9" step="0.05" data-for="wra_ramp_start">
          </div>
        </div>

        <div class="range-block">
          <div class="range-block-title justifyLeft"><small>End pause before compose</small></div>
          <div class="range-block-range-and-counter">
            <label>Multiplier × base delay
              <input type="range" id="wra_dwell" min="0" max="4" step="0.1">
            </label>
            <input type="number" class="text_pole" id="wra_dwell_counter" min="0" max="4" step="0.1" data-for="wra_dwell">
          </div>
        </div>

        <div class="range-block">
          <div class="range-block-title justifyLeft"><small>Pauses on punctuation</small></div>
          <div class="range-block-range-and-counter">
            <label>Sentence ending ×
              <input type="range" id="wra_sentence" min="1" max="2.5" step="0.05">
            </label>
            <input type="number" class="text_pole" id="wra_sentence_counter" min="1" max="2.5" step="0.05" data-for="wra_sentence">
          </div>
          <div class="range-block-range-and-counter">
            <label>Comma / short pause ×
              <input type="range" id="wra_comma" min="1" max="2" step="0.05">
            </label>
            <input type="number" class="text_pole" id="wra_comma_counter" min="1" max="2" step="0.05" data-for="wra_comma">
          </div>
        </div>

        <div class="range-block">
          <div class="range-block-title justifyLeft"><small>Extra display time for long words</small></div>
          <div class="range-block-range-and-counter">
            <label>If word length ≥ 
              <input class="text_pole" type="number" id="wra_len2" min="3" max="12" step="1"> letters
              → show × 
              <input class="text_pole" type="number" id="wra_mul2" min="1" max="2" step="0.05"> longer
            </label>
          </div>
          <div class="range-block-range-and-counter">
            <label>If word length ≥ 
              <input class="text_pole" type="number" id="wra_len1" min="5" max="20" step="1"> letters
              → show × 
              <input class="text_pole" type="number" id="wra_mul1" min="1" max="2.5" step="0.05"> longer
            </label>
          </div>
        </div>

        <div class="range-block">
          <div class="range-block-title justifyLeft"><small>Stream throttle (ms)</small></div>
          <div class="range-block-range-and-counter">
            <input type="range" id="wra_stream_throttle" min="0" max="200" step="10">
            <input type="number" class="text_pole" id="wra_stream_throttle_counter" min="0" max="200" step="10" data-for="wra_stream_throttle">
          </div>
        </div>

        <div style="margin-top:.5rem;">
          <label class="checkbox_label"><input type="checkbox" id="wra_stable_tokenize"><small>Only show complete words (stable tokenize)</small></label>
          <label class="checkbox_label"><input type="checkbox" id="wra_suppress_greeting"><small>Don’t auto-read first greeting message</small></label>
          <label class="checkbox_label"><input type="checkbox" id="wra_per_msg_button"><small>Show “WordRunner” button on each message</small></label>
        </div>

        <div class="wordrunner_buttons" style="margin-top:.5rem;">
          <input id="wra_apply" class="menu_button interactable" type="button" value="Apply" tabindex="0">
        </div>
      </div>
    </div>
  </div>`;

    root.appendChild(container);
  }

  // Wire controls
  const cbEnabled = container.querySelector('#wra_enabled');
  const rangeWpm  = container.querySelector('#wra_wpm');
  const ctrWpm    = container.querySelector('#wra_wpm_counter');
  const btnApply  = container.querySelector('#wra_apply');

  // Initialize from settings
  cbEnabled.checked = !!settings.enabled;
  const clamp = (v) => Math.max(100, Math.min(1200, Math.round(Number(v) || 350)));
  const setBoth = (v) => { const x = clamp(v); rangeWpm.value = String(x); ctrWpm.value = String(x); };

  setBoth(settings.defaultWPM);

  // Keep range and number in sync
  rangeWpm.addEventListener('input', () => {
    setBoth(rangeWpm.value);
    settings.defaultWPM = clamp(rangeWpm.value);
    ctx().saveSettingsDebounced();
  });
  
  ctrWpm.addEventListener('input', () => {
    setBoth(ctrWpm.value);
    settings.defaultWPM = clamp(ctrWpm.value);
    ctx().saveSettingsDebounced();
  });
  
  
  cbEnabled.addEventListener('change', () => {
    settings.enabled = cbEnabled.checked;
    ctx().saveSettingsDebounced();
  });

  btnApply.addEventListener('click', () => {
    renderSettingsPanel();
  });

  const S = settings;
  const setSync = (idRange,idNum,get,set, clamp=(x)=>x) => {
    const r = container.querySelector('#'+idRange);
    const n = container.querySelector('#'+idNum);
    const apply = (v)=>{ v = clamp(v); r.value = v; n.value = v; set(v); ctx().saveSettingsDebounced(); };
    r.value = get(); n.value = get();
    r.addEventListener('input', ()=>apply(r.value));
    n.addEventListener('input', ()=>apply(n.value));
  };

  // Ramp
  setSync('wra_ramp_words','wra_ramp_words_counter', ()=>S.rampWords, v=>S.rampWords = Math.max(1, v|0));
  setSync('wra_ramp_start','wra_ramp_start_counter', ()=>S.rampStartFactor, v=>S.rampStartFactor = Math.min(0.9, Math.max(0.3, Number(v)||0.5)));

  // Dwell
  setSync('wra_dwell','wra_dwell_counter', ()=>S.dwellComposeMult, v=>S.dwellComposeMult = Math.max(0, Number(v)||0));

  // Pauses
  setSync('wra_sentence','wra_sentence_counter', ()=>S.sentencePauseMult, v=>S.sentencePauseMult = Math.max(1, Number(v)||1.6));
  setSync('wra_comma','wra_comma_counter', ()=>S.commaPauseMult, v=>S.commaPauseMult = Math.max(1, Number(v)||1.25));

  // Long word thresholds
  container.querySelector('#wra_len2').value = S.longLen2;
  container.querySelector('#wra_mul2').value = S.longMul2;
  container.querySelector('#wra_len1').value = S.longLen1;
  container.querySelector('#wra_mul1').value = S.longMul1;
  ['wra_len2','wra_mul2','wra_len1','wra_mul1'].forEach(id=>{
    container.querySelector('#'+id).addEventListener('input', ()=>{
      S.longLen2 = Math.max(3, container.querySelector('#wra_len2').value|0);
      S.longMul2 = Math.max(1, Number(container.querySelector('#wra_mul2').value)||1.1);
      S.longLen1 = Math.max(5, container.querySelector('#wra_len1').value|0);
      S.longMul1 = Math.max(1, Number(container.querySelector('#wra_mul1').value)||1.25);
      ctx().saveSettingsDebounced();
    });
  });

  // Stream throttle
  setSync('wra_stream_throttle','wra_stream_throttle_counter', ()=>S.streamThrottleMs, v=>S.streamThrottleMs = Math.max(0, v|0));

  const idMap = {
    fontMinPx: 'wra_font_min',
    fontPreferredVw: 'wra_font_pref',
    fontMaxPx: 'wra_font_max',
  };

  ['fontMinPx','fontPreferredVw','fontMaxPx'].forEach(key=>{
    const el = container.querySelector('#' + idMap[key]);
    if (!el) return;                       // guard for safety
    el.value = settings[key];
    el.addEventListener('input', ()=>{
      const v = Number(el.value);
      if (!Number.isNaN(v)) settings[key] = v;
      ctx().saveSettingsDebounced();
      applyTheme();
    });
  });

  const themeSel = container.querySelector('#wra_theme');
  themeSel.value = settings.theme || 'default';
  themeSel.addEventListener('change', () => {
    settings.theme = themeSel.value;
    ctx().saveSettingsDebounced();
    applyTheme();        // live-apply without reload
  });

  // Toggles
  const bindCheck = (id, key)=> {
    const el = container.querySelector('#'+id);
    el.checked = !!S[key];
    el.addEventListener('change', ()=>{ S[key] = el.checked; ctx().saveSettingsDebounced(); });
  };
  bindCheck('wra_stable_tokenize','stableTokenize');
  bindCheck('wra_suppress_greeting','suppressGreeting');
  bindCheck('wra_per_msg_button','perMessageButton');


}


// Global delegated click handler so rebuilt buttons always work
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.mes_wordrunner_single');
  if (!btn) return;
  e.preventDefault(); e.stopPropagation();
  const block = btn.closest('.mes_block');
  if (!block) return;
  try { readOneMessage(block); }
  catch (err) { console.error('[WordRunner Auto] play-one error:', err); }
});

  function applyTheme() {
    const root = ensureOverlay();
    const S = getSettings();
    const theme = S.theme || 'default';
    const THEMES = {
      'default': { '--wr-bg':'#0b0f1aEE','--wr-text':'#e5e7eb','--wr-subtext':'#94a3b8','--wr-pivot':'#60a5fa','--wr-caret':'#7f1734','--wr-chrome-border':'#1f2937','--wr-button-bg':'#111827','--wr-button-bg-hover':'#0f172a','--wr-button-border':'#1f2937' },
      'dark-red': { '--wr-bg':'#0c0c11EE','--wr-text':'#f3f4f6','--wr-subtext':'#9ca3af','--wr-pivot':'#ef4444','--wr-caret':'#f59e0b','--wr-chrome-border':'#262b36','--wr-button-bg':'#141826','--wr-button-bg-hover':'#101524','--wr-button-border':'#262b36' },
      'dark-blue': { '--wr-bg':'#0b1220EE','--wr-text':'#eef2f7','--wr-subtext':'#a1a9b8','--wr-pivot':'#3b82f6','--wr-caret':'#22c55e','--wr-chrome-border':'#1f2a44','--wr-button-bg':'#101a2c','--wr-button-bg-hover':'#0d1626','--wr-button-border':'#1f2a44' },
      'sepia': { '--wr-bg':'#f6e8c6EE','--wr-text':'#1b1b1b','--wr-subtext':'#3b3b3b','--wr-pivot':'#dc2626','--wr-caret':'#7f1734','--wr-chrome-border':'#e0cfaa','--wr-button-bg':'#f3e2bb','--wr-button-bg-hover':'#ead7ac','--wr-button-border':'#e0cfaa' },
      'paper': { '--wr-bg':'#fafafaEE','--wr-text':'#111111','--wr-subtext':'#333333','--wr-pivot':'#7f1734','--wr-caret':'#7f1734','--wr-chrome-border':'#e5e7eb','--wr-button-bg':'#f3f4f6','--wr-button-bg-hover':'#e5e7eb','--wr-button-border':'#e5e7eb' },
    };
    for (const [k,v] of Object.entries(THEMES[theme] || THEMES.default)) {
      root.style.setProperty(k, v);
    }
    root.style.setProperty('--wr-font-min', `${S.fontMinPx}px`);
    root.style.setProperty('--wr-font-preferred', `${S.fontPreferredVw}vw`);
    root.style.setProperty('--wr-font-max', `${S.fontMaxPx}px`);
  }


  function wireSettingsRendering() {
    const { eventSource, event_types } = ctx();
    eventSource.on(event_types.APP_READY, renderSettingsPanel);
    eventSource.on(event_types.SETTINGS_UPDATED, renderSettingsPanel);
    setTimeout(renderSettingsPanel, 500);
  }

  // --- Word extraction and tokenization -------------------------------------
  const qs = (el, sel) => el.querySelector(sel);
  const qsa = (el, sel) => Array.from(el.querySelectorAll(sel));

  function extractVisibleTextFromBlock(mesBlock) {
    const textEl = qs(mesBlock, '.mes_text');
    if (!textEl) return '';
    const clone = textEl.cloneNode(true);
    qsa(clone, 'script,style,button,summary,details,.mes_img_container,.mes_reasoning_details').forEach(n => n.remove());
    let t = clone.innerText || '';
    t = t.replace(/\u00A0/g, ' ')
         .replace(/[ \t]+\n/g, '\n')
         .replace(/\n{3,}/g, '\n\n')
         .replace(/[“”]/g, '"')
         .replace(/[‘’]/g, "'")
         .trim();
     if (/^(?:\.{3,}|\u2026)$/u.test(t)) return '';
     return t;
  }

  function tokenize(text) {
    const ABBR = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|U\.S|U\.K)\.$/i;
    const raw = text.replace(/\r/g, '')
                    .split(/(\s+)/)
                    .filter(s => s.trim().length)
                    .map(s => s.replace(/\s+/g, ' '));
    const words = [];
    for (let i = 0; i < raw.length; i++) {
      let w = raw[i].trim();
      if (!w) continue;
      const endPunct = /[.!?]+["')\]]?$/.test(w) && !ABBR.test(w);
      const comma = /[,;:]["')\]]?$/.test(w);
      words.push({ w, stop: endPunct ? 2 : comma ? 1 : 0 });
    }
    return words;
  }

  function tokenizeStable(text) {
    // Use your existing tokenizer first
    const words = tokenize(text);

    // If the text DOES NOT end with a clear boundary (space or sentence/phrase punctuation),
    // drop the last token because it's still being typed.
    // Boundaries: whitespace or common end punct incl. quotes/brackets.
    const hasBoundaryAtEnd = /(?:\s|[.!?;,:"')\]\u201D\u2019])$/.test(text);
    if (!hasBoundaryAtEnd && words.length) words.pop();

    return words;
  }


  // --- Overlay / Runner (singleton) -----------------------------------------
  let overlayRoot = null;
  let runner = null;
  let composer = null; // { el, sending }
  let manualPin = false; // when true, don't auto-switch to newest during streaming



  function ensureOverlay() {
    if (overlayRoot) return overlayRoot;

     const css = `

    @media (max-width: 1000px) {
      #wordrunner-range { display:none; }
      #wordrunner-compose { display:none; }
    }

    #wordrunner-overlay {
      position:fixed; inset:0; z-index:999999;
      background:var(--wr-bg);
      backdrop-filter:saturate(120%) blur(2px);
      display:none; 
      flex-direction:column;
    }

    #wordrunner-overlay.wr-open { display: flex !important; }

    #wordrunner-chrome {
      display:flex; align-items:center; gap:.75rem;
      padding:.75rem 1rem;
      border-bottom:1px solid var(--wr-chrome-border);
      color:var(--wr-subtext);
      font:14px/1.2 system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
    }
    #wordrunner-chrome .spacer{flex:1}
    #wordrunner-screen{flex:1;display:grid;place-items:center}

    #wordrunner-word {
      font:clamp(var(--wr-font-min), var(--wr-font-preferred), var(--wr-font-max)) system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
      color:var(--wr-text); letter-spacing:.02em;
      display:flex; align-items:center; justify-content:center;
      width:100%;
    }
    #wordrunner-word .pivot{color:var(--wr-pivot)}

    #wordrunner-compose {
      font:inherit; color:inherit; letter-spacing:inherit;
      outline:none;
      white-space:pre-wrap; word-break:normal; overflow-wrap:break-word;
      display:block;
      inline-size:clamp(24ch,60vw,64ch);
      min-height:1em;
      margin:0 auto;
      caret-color:var(--wr-caret);
      position:relative;
    }
    #wordrunner-compose::after {
      content:''; display:inline-block;
      width:0.08em; height:0.9em;
      vertical-align:-0.08em;
      background:var(--wr-caret);
      opacity:.75;
      animation:wrcaret 1s step-end infinite;
    }
    @keyframes wrcaret{50%{opacity:0}}

    #wordrunner-sub {
      margin-top:.4rem;
      text-align:center;
      color:var(--wr-subtext);
      font:13px/1.2 system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
      opacity:.85;
    }
    #wordrunner-footer {
      display:flex; align-items:center; gap:.75rem;
      padding:.75rem 1rem;
      border-top:1px solid var(--wr-chrome-border);
      color:var(--wr-subtext);
      font:13px/1.2 system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
    }
    #wordrunner-range { width: min(40vw, 240px); }
    #wordrunner-chrome button,#wordrunner-footer button {
      background:var(--wr-button-bg);
      border:1px solid var(--wr-button-border);
      color:var(--wr-text);
      border-radius:8px; padding:.45rem .7rem; cursor:pointer;
    }
    #wordrunner-chrome button:hover,#wordrunner-footer button:hover {
      background:var(--wr-button-bg-hover);
    }
    #wordrunner-hidden {
      position:absolute; left:-9999px; top:-9999px;
      height:1px; width:1px; overflow:hidden;
    }

    /* Theme variable sets */
    #wordrunner-overlay.wr-theme-default {
      --wr-bg:#0b0f1aEE; --wr-text:#e5e7eb; --wr-subtext:#94a3b8;
      --wr-pivot:#60a5fa; --wr-caret:#7f1734;
      --wr-chrome-border:#1f2937;
      --wr-button-bg:#111827; --wr-button-bg-hover:#0f172a; --wr-button-border:#1f2937;
    }
    #wordrunner-overlay.wr-theme-dark-red {
      --wr-bg:#0c0c11EE; --wr-text:#f3f4f6; --wr-subtext:#9ca3af;
      --wr-pivot:#ef4444; --wr-caret:#f59e0b;
      --wr-chrome-border:#262b36;
      --wr-button-bg:#141826; --wr-button-bg-hover:#101524; --wr-button-border:#262b36;
    }
    #wordrunner-overlay.wr-theme-dark-blue {
      --wr-bg:#0b1220EE; --wr-text:#eef2f7; --wr-subtext:#a1a9b8;
      --wr-pivot:#3b82f6; --wr-caret:#22c55e;
      --wr-chrome-border:#1f2a44;
      --wr-button-bg:#101a2c; --wr-button-bg-hover:#0d1626; --wr-button-border:#1f2a44;
    }
    #wordrunner-overlay.wr-theme-sepia {
      --wr-bg:#f6e8c6EE; --wr-text:#1b1b1b; --wr-subtext:#3b3b3b;
      --wr-pivot:#dc2626; --wr-caret:#7f1734;
      --wr-chrome-border:#e0cfaa;
      --wr-button-bg:#f3e2bb; --wr-button-bg-hover:#ead7ac; --wr-button-border:#e0cfaa;
    }
    #wordrunner-overlay.wr-theme-paper {
      --wr-bg:#fafafaEE; --wr-text:#111111; --wr-subtext:#333333;
      --wr-pivot:#7f1734; --wr-caret:#7f1734;
      --wr-chrome-border:#e5e7eb;
      --wr-button-bg:#f3f4f6; --wr-button-bg-hover:#e5e7eb; --wr-button-border:#e5e7eb;
    }

    `.trim();


    const style = document.createElement('style');
    style.textContent = css;

    overlayRoot = document.createElement('div');
    overlayRoot.id = 'wordrunner-overlay';
    overlayRoot.innerHTML = `
      <div id="wordrunner-chrome" role="toolbar" aria-label="WordRunner controls">
        <button id="wordrunner-play" title="Play/Pause (Space)">▶</button>
        <button id="wordrunner-back" title="Back 10 words (←)">⟲10</button>
        <button id="wordrunner-fwd"  title="Forward 10 words (→)">10⟳</button>
        <div class="spacer"></div>
        <span>WPM:</span><input id="wordrunner-range" type="range" min="100" max="1200" step="10">
        <span id="wordrunner-wpm">000</span>
        <button id="wordrunner-close" title="Close (Esc)">✕</button>
      </div>
      <div id="wordrunner-screen">
        <div>
          <div id="wordrunner-word" aria-live="polite" aria-atomic="true"></div>
          <div id="wordrunner-sub"></div>
        </div>
      </div>
      <div id="wordrunner-footer">
        <span id="wordrunner-pos">0 / 0</span>
        <div class="spacer"></div>
        <button id="wordrunner-minus" title="WPM -10 (-)">–</button>
        <button id="wordrunner-plus"  title="WPM +10 (+)">+</button>
      </div>
      <div id="wordrunner-hidden" tabindex="0"></div>
    `;
    (document.head || document.getElementsByTagName('head')[0]).appendChild(style);
    document.documentElement.appendChild(overlayRoot);
    overlayRoot.style.setProperty('position', 'fixed', 'important');
    overlayRoot.style.setProperty('inset', '0', 'important');
    overlayRoot.style.setProperty('z-index', '2147483647', 'important');
    overlayRoot.style.display = 'none'; // default: hidden

    overlayRoot.style.setProperty('flex-direction', 'column', 'important');
    overlayRoot.style.setProperty('isolation', 'isolate'); // own stacking context
    //overlayRoot.style.setProperty('contain', 'layout paint size'); // immune to ancestors

    overlayRoot.style.setProperty('position', 'fixed', 'important');
    overlayRoot.style.setProperty('top', '0', 'important');
    overlayRoot.style.setProperty('right', '0', 'important');
    overlayRoot.style.setProperty('bottom', '0', 'important');
    overlayRoot.style.setProperty('left', '0', 'important');

    overlayRoot.style.setProperty('width', '100vw', 'important');
    overlayRoot.style.setProperty('height', '100vh', 'important');
    overlayRoot.style.setProperty('max-width', '100vw', 'important');
    overlayRoot.style.setProperty('max-height', '100vh', 'important');
    overlayRoot.style.setProperty('box-sizing', 'border-box', 'important');



    overlayRoot.style.background = 'rgba(11,15,26,0.93)';

    return overlayRoot;
  }

  function pivotize(word) {
    const len = word.replace(/^[("'\[]|[)"'\]]$/g, '').length;
    const idx = len <= 1 ? 0 : len <= 5 ? 1 : len <= 9 ? 2 : 3;
    let count = 0, out = '';
    for (let i = 0; i < word.length; i++) {
      const ch = word[i];
      if (/\w/.test(ch)) count++;
      if (count - 1 === idx && /\w/.test(ch)) out += `<span class="pivot">${ch}</span>`;
      else out += ch;
    }
    return out;
  }

  function readOneMessage(mesBlock){
    const t = extractVisibleTextFromBlock(mesBlock);
    const tokens = tokenize(t);
    const meta = {
      title:
        (mesBlock.querySelector('.name_text')?.textContent?.trim() || '') +
        (mesBlock.querySelector('.timestamp') ? ' • ' + mesBlock.querySelector('.timestamp').textContent.trim() : '')
    };
    const composeAfterEnd = isLastMessage(mesBlock);
    manualPin = true;

    if (!runner) {
      openRunner(tokens, meta, { composeAfterEnd });
    } else if (runner.playOne) {
      runner.playOne(tokens, meta, composeAfterEnd);
    } else {
      // ultra-safe fallback if you’re on an older runner; just reopen
      runner.close?.();
      openRunner(tokens, meta, { composeAfterEnd });
    }
  }


  function openRunner(initialTokens, meta = {}, opts = {}) {
    const settings = getSettings();
    const DEFAULT_WPM = Math.max(100, Math.min(1200, settings.defaultWPM || 300));
    const root = ensureOverlay();

    const htmlPrev = document.documentElement.style.transform || '';
    const bodyPrev = document.body.style.transform || '';
    overlayRoot.dataset.wrPrevHtmlTransform = htmlPrev;
    overlayRoot.dataset.wrPrevBodyTransform = bodyPrev;
    document.documentElement.style.transform = 'none';
    document.body.style.transform = 'none';

    const elWord = root.querySelector('#wordrunner-word');
    const elSub  = root.querySelector('#wordrunner-sub');
    const elPos  = root.querySelector('#wordrunner-pos');
    const btnPlay= root.querySelector('#wordrunner-play');
    const btnBack= root.querySelector('#wordrunner-back');
    const btnFwd = root.querySelector('#wordrunner-fwd');
    const btnClose=root.querySelector('#wordrunner-close');
    const range  = root.querySelector('#wordrunner-range');
    const wpmLbl = root.querySelector('#wordrunner-wpm');

    const wpmdec  = root.querySelector('#wordrunner-minus');
    const wpminc = root.querySelector('#wordrunner-plus');

    let words = Array.isArray(initialTokens) ? initialTokens.slice() : [];
    let i = 0;
    let playing = false;
    let wpm = DEFAULT_WPM;
    let timer = null;
    let seenSinceStart = 0;

    // default: in auto/stream mode we DO enter compose after the dwell
    let composeAfterEnd = (opts && 'composeAfterEnd' in opts)
     ? !!opts.composeAfterEnd
     : true;

    function setWPM(v) {
      wpm = Math.max(100, Math.min(1200, Math.round(v)));
      range.value = String(wpm);
      wpmLbl.textContent = String(wpm);
    }


    function incWPM() {
      setWPM(wpm+10);
    }

    wpminc.onclick = () => incWPM();

    function decWPM() {
      setWPM(wpm-10); 
    }
    
    wpmdec.onclick = () => decWPM();

    setWPM(wpm);
    applyTheme();
    
    function resume() {
      if (timer) { clearTimeout(timer); timer = null; }
      playing = true;
      tick();
    }

    function enterComposeMode() {
      if (composer?.el) return;
      playing = false; if (timer) { clearTimeout(timer); timer = null; }
      const holder = document.createElement('div');
      holder.id = 'wordrunner-compose';
      // Seed with a thin flashing caret
      holder.innerHTML = '&nbsp;<span class="caret"></span>';
      holder.contentEditable = 'true';
      elWord.replaceChildren(holder);
      composer = { el: holder, sending: false };
      // Focus caret at end
      const range = document.createRange(); range.selectNodeContents(holder); range.collapse(false);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    }
    
    function leaveComposeMode() {
      if (!composer?.el) return;
      composer = null;
      elWord.textContent = ''; // will be overwritten by next tick
      elSub.textContent = meta.title || '';
    }

    function fmtPos() {
      elPos.textContent = `${Math.min(i + 1, words.length)} / ${words.length}`;
    }

    function baseDelay() { return 60000 / wpm; }

    function rampMultiplier() {
      const { rampWords, rampStartFactor, rampCurveExp } = getSettings();
      const n = Math.max(1, rampWords|0);
      const f = Math.min(1, seenSinceStart / n);
      const s = Math.min(0.99, Math.max(0.1, Number(rampStartFactor) || 0.5));
      const e = Math.max(0.2, Number(rampCurveExp) || 0.7);
      return s + (1 - s) * Math.pow(f, e);
    }

    function wordDelay(tok) {
      const b = baseDelay() / rampMultiplier();
      const st = getSettings();
      if (tok.stop === 2) return b * (Number(st.sentencePauseMult) || 1.6);
      if (tok.stop === 1) return b * (Number(st.commaPauseMult) || 1.25);
      const L = Math.max(1, tok.w.length);
      const len1 = Math.max(2, st.longLen1|0), mul1 = Number(st.longMul1) || 1.25;
      const len2 = Math.max(2, st.longLen2|0), mul2 = Number(st.longMul2) || 1.10;
      return b * (L >= len1 ? mul1 : L >= len2 ? mul2 : 1.0);
    }

    function render() {
      const tok = words[i];
      if (!tok) return;
      elWord.innerHTML = pivotize(tok.w);
      fmtPos();
      if (meta.title) elSub.textContent = meta.title;
    }

    function tick() {
      if (!playing) return;


      if (i >= words.length) {
        // No more tokens right now.
        playing = false;
        if (timer) { clearTimeout(timer); timer = null; }
        if (composeAfterEnd) {
          // Allow typing after a short dwell
          const dwell = Math.max(0, Number(getSettings().dwellComposeMult) || 2.0);
          timer = setTimeout(() => enterComposeMode(), baseDelay() * dwell);

        }
        // else: simply pause (no compose)
        return;
     }



      render();
      const d = wordDelay(words[i]);
      i++;
      seenSinceStart++;
      timer = setTimeout(tick, d);
    }

    function playPause(force) {
      const next = force ?? !playing;
      if (timer) { clearTimeout(timer); timer = null; }
      playing = !!next;
      btnPlay.textContent = playing ? '⏸' : '▶';
      if (playing) tick();
    }

    function back(n=10) { i = Math.max(0, i - n); if (!playing) render(); }
    function fwd(n=10)  { i = Math.min(words.length - 1, i + n); if (!playing) render(); }
    function close() {
      if (timer) clearTimeout(timer);
      playing = false;
      root.classList.remove('wr-open');
      root.style.display = 'none';
      document.body.style.overflow = overlayRoot.dataset.wrPrevOverflow || '';
      document.documentElement.style.transform = overlayRoot.dataset.wrPrevHtmlTransform || '';
      document.body.style.transform = overlayRoot.dataset.wrPrevBodyTransform || '';

      document.removeEventListener('keydown', onKey);

      runner = null;
      manualPin = false;
    }

    btnPlay.onclick = () => playPause();
    btnBack.onclick = () => back();
    btnFwd.onclick  = () => fwd();
    btnClose.onclick= () => close();
    range.oninput   = (e) => setWPM(Number(e.target.value));
    document.addEventListener('keydown', onKey);

    function sendMessageText(text) {
      const { eventSource, event_types } = ctx();

      // 1) Extension bus (preferred if present in your build)
      try {
        if (eventSource && event_types?.USER_MESSAGE_REQUESTED) {
          eventSource.emit(event_types.USER_MESSAGE_REQUESTED, { text });
          return true;
        }
        if (eventSource && event_types?.SEND_MESSAGE) {
          eventSource.emit(event_types.SEND_MESSAGE, { text });
          return true;
        }
      } catch (_) {}

      // 2) UI controls
      const ta = document.getElementById('send_textarea');
      if (ta) {
        // Make React/vanilla listeners see a real value change
        ta.focus();
        ta.value = text;
        ta.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertFromPaste' }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Known global in some builds
      if (typeof window.Generate === 'function') {
        window.Generate();
        return true;
      }

      // Fallback: click the send button if present
      const sendBtn = document.getElementById('send_but') || document.querySelector('[data-i18n="[title]Send message"]');
      if (sendBtn) {
        sendBtn.click();
        return true;
      }

      // Last resort: synthesize Enter on the textarea
      if (ta) {
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        ta.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', bubbles: true }));
        return true;
      }

      return false;
    }


    function onKey(e) {
      if (!root.classList.contains('wr-open')) return;

      if (composer?.el) {
        // Compose-mode hotkeys
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault(); e.stopPropagation();
          if (composer.sending) return;

          const text = composer.el.innerText.replace(/\u200B/g, '').trim();
          if (!text) return;

          composer.sending = true;

          // keep overlay open, but clear the field visually
          composer.el.innerHTML = '<span class="caret"></span>';

          const ok = sendMessageText(text);

          // Safety: if nothing actually fired, let the user try again
          if (!ok) {
            composer.sending = false;
            composer.el.textContent = text; // restore so they don't lose it
          }
          return;
        }
        if (e.key === 'Enter' && e.shiftKey) {
          // allow newline in contentEditable
          return; // let the browser insert a <div><br></div> newline
        }
        // Stop WordRunner transport keys from hijacking compose mode
        if (['ArrowLeft','ArrowRight','+','-','_','=',' '].includes(e.key)) return;
        if (e.key === 'Escape') {
         e.preventDefault();
         close();   // allow quitting overlay from compose mode
         return;
        }
      }

      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === ' '){ e.preventDefault(); playPause(); }
      else if (e.key === 'ArrowLeft'){ e.preventDefault(); back(); }
      else if (e.key === 'ArrowRight'){ e.preventDefault(); fwd(); }
      else if (e.key === '+' || e.key === '='){ setWPM(wpm + 10); }
      else if (e.key === '-' || e.key === '_'){ setWPM(wpm - 10); }
    }

    root.classList.add('wr-open');
    root.style.flexDirection = 'column'; 
    
    const prev = document.body.style.overflow;
    overlayRoot.dataset.wrPrevOverflow = prev || '';
    document.body.style.overflow = 'hidden';


    seenSinceStart = 0;
    setWPM(Math.max(100, Math.round(DEFAULT_WPM)));
    i = 0;
    render();
    playPause(true);

    runner = {
      append(newTokens) {
        if (!Array.isArray(newTokens) || !newTokens.length) return;
        const wasEmpty = words.length === 0;
        words.push(...newTokens);
        fmtPos();
        // If we were empty and idle, show the very first token now
        if (wasEmpty && !playing && i === 0 && words.length > 0) {
          render();
        }
      },
      isOpen() { return runner != null; },
      close,
      setMeta(newMeta) { meta = { ...meta, ...newMeta }; },
      enterComposeMode,
      leaveComposeMode,
      resume,
      playOne(newTokens, newMeta, composeFlag){
        if (!Array.isArray(newTokens) || !newTokens.length) return;
        leaveComposeMode();
        meta = { ...meta, ...newMeta };
        composeAfterEnd = !!composeFlag;
        words = newTokens.slice();
        i = 0;
        seenSinceStart = 0;
        render();
        resume();
      },

    };


    return runner;
  }

  // --- Streaming watch: always follow newest AI message ----------------------
  function isCharacterBlock(el) {
    return el?.classList?.contains('mes') || el?.classList?.contains('mes_block') || false;
  }

  function isLastMessage(block){
    const blocks = Array.from(document.querySelectorAll('.mes_block'));
    return blocks.at(-1) === block;
  }

  function isInitialGreetingState(){
     const blocks = Array.from(document.querySelectorAll('.mes_block'));
     if (blocks.length === 0) return false;
     let ai = 0, user = 0;
     for (const b of blocks) {
       const nameEl = b.querySelector('.ch_name .name_text');
       const isUser = nameEl && /You|User/i.test(nameEl.textContent || '');
       if (isUser) user++; else ai++;
     }
     // Exactly one AI message and no user messages → opening greeting
     return ai === 1 && user === 0;
  }

  function ensureWRButtonForBlock(block){
    const tray = block.querySelector('.mes_buttons .extraMesButtons');
    if (!tray || tray.querySelector('.mes_wordrunner_single')) return;

    const btn = document.createElement('div');
    btn.className = 'mes_button mes_wordrunner_single fa-solid fa-forward interactable';
    btn.title = 'Read this message (WordRunner)';
    btn.tabIndex = 0;
    tray.appendChild(btn);
  }

  function patchMessageButtons(){
    if (!getSettings().perMessageButton) return;
    document.querySelectorAll('.mes_block').forEach(ensureWRButtonForBlock);
  }

  function findNewestCharacterBlock() {
    const blocks = Array.from(document.querySelectorAll('.mes_block')).filter(b => {
      const nameEl = b.querySelector('.ch_name .name_text');
      const isUser = nameEl && /You|User/i.test(nameEl.textContent || '');
      return !isUser;
    });
    return blocks.at(-1) || null;
  }

  let active = {
    block: null,
    observer: null,
    lastWordCount: 0,
  };

  function stopWatchingActive() {
    try { active.observer?.disconnect?.(); } catch {}
    active = { block: null, observer: null, lastWordCount: 0 };
  }

  function startWatchingBlock(mesBlock) {
    const settings = getSettings();
    if (!settings.enabled || !mesBlock) return;
    if (!manualPin && getSettings().suppressGreeting && isInitialGreetingState()) return;


    // If we’re already watching this exact block, do nothing.
    if (active.block === mesBlock) return;

    // Switch to newest: disconnect previous and begin fresh.
    stopWatchingActive();
    active.block = mesBlock;

    const seedText = extractVisibleTextFromBlock(mesBlock);
    const stz = !!getSettings().stableTokenize;
    const seedTokens = stz ? tokenizeStable(seedText) : tokenize(seedText);


    const meta = {
      title:
        (mesBlock.querySelector('.name_text')?.textContent?.trim() || '') +
        (mesBlock.querySelector('.timestamp') ? ' • ' + mesBlock.querySelector('.timestamp').textContent.trim() : '')
    };

    if (!runner) openRunner(seedTokens, meta);
    else {
      runner.setMeta(meta);
      runner.append(seedTokens);
    }

    const textEl = mesBlock.querySelector('.mes_text');
    if (!textEl) return;

    active.lastWordCount = seedTokens.length;

    const obs = new MutationObserver(() => {
      const currentText = extractVisibleTextFromBlock(mesBlock);
      const currentTokens = stz ? tokenizeStable(currentText) : tokenize(currentText);
      if (currentTokens.length > active.lastWordCount) {
        const delta = currentTokens.slice(active.lastWordCount);
        runner?.append(delta);
        active.lastWordCount = currentTokens.length;
      }
    });
    obs.observe(textEl, { childList: true, characterData: true, subtree: true });
    active.observer = obs;
  }

  // Small throttle so STREAM_TOKEN_RECEIVED (per-token) doesn’t spam work.
  let lastStreamCheck = 0;
  function maybeSwitchToNewest(throttleMs = (Number(getSettings().streamThrottleMs) || 80)) {
    const now = performance.now?.() ?? Date.now();
    if (now - lastStreamCheck < throttleMs) return;
    lastStreamCheck = now;
    const newest = findNewestCharacterBlock();
    if (newest && isCharacterBlock(newest)) {
     if (!manualPin && isInitialGreetingState()) return; // opening greeting → do nothing
     if (active.block !== newest) startWatchingBlock(newest);

      if (composer?.el) {
        runner?.leaveComposeMode?.();
        runner?.resume?.();
      }

    }
  }

  // --- Event wiring ----------------------------------------------------------
  function wireEvents() {
    const { eventSource, event_types } = ctx();

    eventSource.on(event_types.APP_READY, patchMessageButtons);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, patchMessageButtons);
    // Optional (if available in your build):
    if (event_types.USER_MESSAGE_RENDERED) eventSource.on(event_types.USER_MESSAGE_RENDERED, patchMessageButtons);

    document.addEventListener('click', (e) => {
     if (e.target.closest('.extraMesButtonsHint')) {
       setTimeout(patchMessageButtons, 0);
     }
    });


    // Model acknowledged a message (id created, DOM may follow)
    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
     if (composer?.el) { runner?.leaveComposeMode?.(); runner?.resume?.(); }
     setTimeout(() => maybeSwitchToNewest(0), 0);
    });

    // Message rendered (covers non-stream + first paint)
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => {
      setTimeout(() => maybeSwitchToNewest(0), 0);
    });

    // Per-token stream event — follow the newest message, throttled.
    if (event_types.STREAM_TOKEN_RECEIVED) {
      eventSource.on(event_types.STREAM_TOKEN_RECEIVED, () => {


       // If we were composing, immediately resume reading
       if (composer?.el) {
         runner?.leaveComposeMode?.();
         runner?.resume?.();
       }
       // Keep the watcher pinned to the currently-latest AI message
        maybeSwitchToNewest();

      });
    }

    // When the chat changes, close overlay and stop watching
    eventSource.on(event_types.CHAT_CHANGED, () => {
      if (runner?.isOpen?.()) runner.close();
      stopWatchingActive();
      manualPin = false;
    });
  }

  // --- Bootstrap -------------------------------------------------------------
  function init() {
    wireSettingsRendering();
    wireEvents();
  }

  try {
    const { eventSource, event_types } = ctx();
    eventSource.on(event_types.APP_READY, init);
    setTimeout(init, 200);
    setTimeout(() => { try { applyTheme(); } catch {} }, 400);


  } catch (e) {
    console.error('[WordRunner Auto] init error:', e);
  }
})();
