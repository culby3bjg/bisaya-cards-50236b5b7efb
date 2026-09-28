/* Bisaya flashcards — SM-2, PWA, localStorage. */
(function () {
  'use strict';
  const LS_KEY = 'bisayaCards.v1';
  const VERSION = '1.1.0';

  let deck = null;           // {title, categories, cards}
  let progress = null;       // {settings, cards: {sid: state}, history, version}
  let queue = [];            // current study session queue of {sid, card, dir}
  let current = null;
  let flipped = false;
  let lastAction = null;     // for undo
  let view = 'home';

  const $ = (id) => document.getElementById(id);
  const views = {
    home: $('view-home'), study: $('view-study'), browse: $('view-browse'), settings: $('view-settings'),
    testSetup: $('view-testSetup'), test: $('view-test'), testResults: $('view-testResults')
  };

  // ---------- storage ----------
  function defaultSettings() {
    return {
      newPerDay: 15,
      direction: 'both',          // both | b2e | e2b
      enabledCategories: null,    // null = all
      newIntroducedOn: {},        // dayKey -> count
      reviewsToday: 0,
      reviewsDay: '',
      streak: 0,
      lastStudyDay: '',
      studyDays: []               // last N dayKeys studied
    };
  }

  function loadProgress() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return { settings: defaultSettings(), cards: {}, tests: [], version: VERSION };
      const p = JSON.parse(raw);
      p.settings = Object.assign(defaultSettings(), p.settings || {});
      p.cards = p.cards || {};
      p.tests = Array.isArray(p.tests) ? p.tests : [];
      p.version = VERSION;
      return p;
    } catch (e) {
      console.warn('progress load failed', e);
      return { settings: defaultSettings(), cards: {}, tests: [], version: VERSION };
    }
  }

  function saveProgress() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(progress)); }
    catch (e) { toast('Could not save progress (storage full?)'); }
  }

  // ---------- deck helpers ----------
  function sid(cardId, dir) { return cardId + '::' + dir; }

  function getState(s) {
    return progress.cards[s] || SRS.newState();
  }

  function activeCategories() {
    const en = progress.settings.enabledCategories;
    if (!en) return new Set(deck.categories);
    return new Set(en);
  }

  function sourceCards() {
    const cats = activeCategories();
    return deck.cards.filter(c => cats.has(c.category));
  }

  function directions() {
    const d = progress.settings.direction;
    if (d === 'b2e') return ['b2e'];
    if (d === 'e2b') return ['e2b'];
    return ['b2e', 'e2b'];
  }

  function allStudyItems() {
    const dirs = directions();
    const out = [];
    for (const c of sourceCards()) for (const dir of dirs) out.push({ sid: sid(c.id, dir), card: c, dir });
    return out;
  }

  function bumpDayCounters(now) {
    const key = SRS.dayKey(now);
    const s = progress.settings;
    if (s.reviewsDay !== key) { s.reviewsDay = key; s.reviewsToday = 0; }
    if (s.newIntroducedOn[key] == null) s.newIntroducedOn[key] = 0;
    // prune old days
    for (const k of Object.keys(s.newIntroducedOn)) {
      if (k < key && Object.keys(s.newIntroducedOn).length > 14) delete s.newIntroducedOn[k];
    }
  }

  function buildQueue(now) {
    bumpDayCounters(now);
    const items = allStudyItems();
    const learning = [], review = [], news = [];
    for (const it of items) {
      const st = getState(it.sid);
      if (st.state === 'new') news.push(it);
      else if (st.due <= now) {
        if (st.state === 'learning' || st.state === 'relearning') learning.push(it);
        else review.push(it);
      }
    }
    // Stable-ish shuffle for reviews & new; keep learning FIFO by due
    learning.sort((a, b) => getState(a.sid).due - getState(b.sid).due);
    shuffle(review);   // new cards stay in document order (deck order)...
    // ...except words missed in a test, which jump the new-card line
    news.sort((a, b) => (getState(b.sid).priority || 0) - (getState(a.sid).priority || 0));

    const key = SRS.dayKey(now);
    const used = progress.settings.newIntroducedOn[key] || 0;
    const room = Math.max(0, progress.settings.newPerDay - used);
    const takeNew = [], chosen = new Set();
    for (const it of news) {
      if (takeNew.length >= room) break;
      // sibling burying: don't introduce both directions of one word on the same day
      const sib = getState(sid(it.card.id, it.dir === 'b2e' ? 'e2b' : 'b2e'));
      if (chosen.has(it.card.id)) continue;
      if (sib.firstSeen && SRS.dayKey(sib.firstSeen) === key) continue;
      takeNew.push(it); chosen.add(it.card.id);
    }

    // Interleave: learning first (urgent), then mix review + new
    const rest = [];
    let i = 0, j = 0;
    while (i < review.length || j < takeNew.length) {
      if (j < takeNew.length && (i >= review.length || (i + j) % 3 === 2)) rest.push(takeNew[j++]);
      else if (i < review.length) rest.push(review[i++]);
      else rest.push(takeNew[j++]);
    }
    return learning.concat(rest);
  }

  function newAvailable(now) {
    return buildQueue(now).filter(it => getState(it.sid).state === 'new').length;
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function counts(now) {
    bumpDayCounters(now);
    const items = allStudyItems();
    let due = 0, learning = 0, review = 0, news = 0, learned = 0;
    for (const it of items) {
      const st = getState(it.sid);
      if (st.state === 'new') news++;
      else if (st.state === 'learning' || st.state === 'relearning') {
        learning++; if (st.due <= now) due++;
      } else {
        learned++;
        if (st.due <= now) { review++; due++; }
      }
    }
    const newAvail = newAvailable(now);
    // "due now" for the home screen = learning due + review due + new we will introduce
    return {
      dueNow: due + newAvail,
      learning, review, news: newAvail, newsTotal: news,
      learned, reviewsToday: progress.settings.reviewsToday,
      streak: progress.settings.streak
    };
  }

  // ---------- study ----------
  function startStudy() {
    const now = Date.now();
    queue = buildQueue(now);
    if (!queue.length) { toast('Nothing due right now'); return; }
    lastAction = null;
    showView('study');
    nextCard();
  }

  function nextCard() {
    const now = Date.now();
    // skip stale entries (e.g. a card that already graduated to a future review)
    while (queue.length) {
      const st = getState(queue[0].sid);
      if (st.state === 'review' && st.due > now) queue.shift(); else break;
    }
    current = queue.shift() || null;
    flipped = false;
    if (!current) {
      toast('Session done');
      updateHome();
      showView('home');
      return;
    }
    renderCard();
  }

  function renderCard() {
    const { card, dir } = current;
    const front = dir === 'b2e' ? card.bisaya : card.english;
    const back = dir === 'b2e' ? card.english : card.bisaya;
    $('dirLabel').textContent = dir === 'b2e' ? 'Bisaya → English' : 'English → Bisaya';
    $('cardCat').textContent = card.category;
    $('qLeft').textContent = (queue.length + 1) + ' left';
    const frontEl = $('front');
    frontEl.innerHTML = esc(front) + (card.context ? '<span class="ctx">' + esc(card.context) + '</span>' : '');
    const extras = [];
    if (card.breakdown && card.breakdown.length)
      extras.push('<div><b>Breakdown</b>' + card.breakdown.map(esc).join('<br>') + '</div>');
    if (card.examples && card.examples.length)
      extras.push('<div><b>Examples</b>' + card.examples.map(esc).join('<br>') + '</div>');
    if (card.notes && card.notes.length)
      extras.push('<div><b>Notes</b>' + card.notes.map(esc).join('<br>') + '</div>');
    if (card.flags && card.flags.length)
      extras.push('<div class="flag"><b>Parse note</b>' + card.flags.map(esc).join('<br>') + '</div>');
    $('back').innerHTML = '<div class="answer">' + esc(back) + '</div>' +
      (extras.length ? '<div class="extra">' + extras.join('') + '</div>' : '');
    $('back').hidden = true;
    $('tapHint').hidden = false;
    $('grades').hidden = true;
    $('showBtn').hidden = false;
    $('undoBtn').hidden = !lastAction;
    // preview grade intervals
    const now = Date.now();
    const st = getState(current.sid);
    for (const btn of $('grades').querySelectorAll('.grade')) {
      const g = +btn.dataset.g;
      const next = SRS.schedule(st, g, now);
      btn.querySelector('small').textContent = SRS.fmtInterval(next, now);
    }
  }

  function flip() {
    if (!current || flipped) return;
    flipped = true;
    $('back').hidden = false;
    $('tapHint').hidden = true;
    $('grades').hidden = false;
    $('showBtn').hidden = true;
  }

  function grade(g) {
    if (!current || !flipped) return;
    const now = Date.now();
    bumpDayCounters(now);
    const prev = getState(current.sid);
    const wasNew = prev.state === 'new';
    const next = SRS.schedule(prev, g, now);
    progress.cards[current.sid] = next;
    if (wasNew) {
      next.firstSeen = now;
      const key = SRS.dayKey(now);
      progress.settings.newIntroducedOn[key] = (progress.settings.newIntroducedOn[key] || 0) + 1;
    }
    progress.settings.reviewsToday += 1;
    touchStreak(now);
    lastAction = { sid: current.sid, prev, item: current, wasNew };
    // Re-queue if still learning and due soon (within ~20 min) — put back at end of learning block
    if ((next.state === 'learning' || next.state === 'relearning') && next.due - now < 20 * SRS.MIN) {
      queue.push(current);
    }
    saveProgress();
    nextCard();
  }

  function undo() {
    if (!lastAction) return;
    const a = lastAction;
    progress.cards[a.sid] = a.prev;
    if (a.wasNew) {
      const key = SRS.dayKey(Date.now());
      progress.settings.newIntroducedOn[key] = Math.max(0, (progress.settings.newIntroducedOn[key] || 1) - 1);
    }
    progress.settings.reviewsToday = Math.max(0, progress.settings.reviewsToday - 1);
    // put the card back at front (and drop any re-queued copy of it)
    queue = queue.filter(it => it.sid !== a.sid);
    if (current && current.sid !== a.sid) queue.unshift(current);
    queue.unshift(a.item);
    lastAction = null;
    saveProgress();
    nextCard();
  }

  function touchStreak(now) {
    const key = SRS.dayKey(now);
    const s = progress.settings;
    if (s.lastStudyDay === key) return;
    const yesterday = SRS.dayKey(now - SRS.DAY);
    if (s.lastStudyDay === yesterday) s.streak = (s.streak || 0) + 1;
    else if (!s.lastStudyDay) s.streak = 1;
    else s.streak = 1;
    s.lastStudyDay = key;
    s.studyDays = (s.studyDays || []).filter(d => d !== key).concat(key).slice(-60);
  }

  // ---------- UI ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function showView(name) {
    view = name;
    for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
    $('backBtn').hidden = name === 'home';
    $('title').textContent = ({ home: 'Bisaya Cards', study: 'Study', browse: 'Browse', settings: 'Settings', testSetup: 'Test', test: 'Test', testResults: 'Test results' })[name];
    if (name === 'testSetup') QuizUI.renderSetup();
    if (name === 'browse') renderBrowse();
    if (name === 'settings') renderSettings();
    if (name === 'home') updateHome();
    window.scrollTo(0, 0);
  }

  function updateHome() {
    const now = Date.now();
    const c = counts(now);
    $('dueCount').textContent = c.dueNow;
    $('newCount').textContent = c.news;
    $('reviewCount').textContent = c.review;
    $('learnCount').textContent = learningDue(now);
    $('statLearned').textContent = c.learned;
    $('statDueToday').textContent = c.dueNow;
    $('statStreak').textContent = c.streak;
    $('statReviewsToday').textContent = c.reviewsToday;
    $('startBtn').disabled = c.dueNow === 0;
    $('testSummary').textContent = QuizUI.homeSummary();
    $('doneMsg').hidden = c.dueNow !== 0;
    // sync direction segment
    for (const b of $('dirSeg').querySelectorAll('button')) {
      b.classList.toggle('on', b.dataset.dir === progress.settings.direction);
    }
    const cats = activeCategories();
    const n = deck.categories.length;
    $('filterNote').textContent = cats.size < n
      ? 'Studying ' + cats.size + ' of ' + n + ' categories · ' + allStudyItems().length + ' cards in deck'
      : allStudyItems().length + ' cards in deck (' + directions().length + '× ' + sourceCards().length + ' words)';
  }

  function learningDue(now) {
    let n = 0;
    for (const it of allStudyItems()) {
      const st = getState(it.sid);
      if ((st.state === 'learning' || st.state === 'relearning') && st.due <= now) n++;
    }
    return n;
  }

  function renderBrowse() {
    const sel = $('browseCat');
    if (!sel.dataset.ready) {
      sel.innerHTML = '<option value="">All categories</option>' +
        deck.categories.map(c => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
      sel.dataset.ready = '1';
    }
    const q = ($('search').value || '').trim().toLowerCase();
    const cat = sel.value;
    const items = deck.cards.filter(c => {
      if (cat && c.category !== cat) return false;
      if (!q) return true;
      return (c.bisaya + ' ' + c.english + ' ' + (c.notes || []).join(' ') + ' ' + (c.examples || []).join(' ')).toLowerCase().includes(q);
    });
    $('browseCount').textContent = items.length + ' words';
    const now = Date.now();
    $('list').innerHTML = items.map(c => {
      const stB = getState(sid(c.id, 'b2e')), stE = getState(sid(c.id, 'e2b'));
      const tags = [];
      tags.push('<span class="tag">' + esc(c.category) + '</span>');
      if (c.context) tags.push('<span class="tag">' + esc(c.context) + '</span>');
      for (const [lab, st] of [['B→E', stB], ['E→B', stE]]) {
        if (st.state === 'new') tags.push('<span class="tag">' + lab + ' new</span>');
        else if (st.due <= now) tags.push('<span class="tag due">' + lab + ' due</span>');
        else if (st.state === 'review') tags.push('<span class="tag learned">' + lab + ' learned · next ' + SRS.fmtInterval(st, now) + '</span>');
        else tags.push('<span class="tag">' + lab + ' learning</span>');
      }
      let details = '';
      const bits = [];
      if (c.breakdown) bits.push('<b>Breakdown</b><br>' + c.breakdown.map(esc).join('<br>'));
      if (c.examples) bits.push('<b>Examples</b><br>' + c.examples.map(esc).join('<br>'));
      if (c.notes) bits.push('<b>Notes</b><br>' + c.notes.map(esc).join('<br>'));
      if (c.flags) bits.push('<b>Parse note</b><br>' + c.flags.map(esc).join('<br>'));
      if (bits.length) details = '<details><summary>Details</summary>' + bits.join('<hr style="border:0;border-top:1px solid var(--line);margin:8px 0">') + '</details>';
      return '<li><div class="b">' + esc(c.bisaya) + '</div><div class="e">' + esc(c.english) + '</div><div class="m">' + tags.join('') + '</div>' + details + '</li>';
    }).join('');
  }

  function renderSettings() {
    $('npd').value = progress.settings.newPerDay;
    $('dirSelect').value = progress.settings.direction;
    const en = activeCategories();
    $('catList').innerHTML = deck.categories.map(cat => {
      const n = deck.cards.filter(c => c.category === cat).length;
      return '<label><input type="checkbox" data-cat="' + esc(cat) + '"' + (en.has(cat) ? ' checked' : '') + '> <span>' + esc(cat) + '</span><span class="n">' + n + '</span></label>';
    }).join('');
    $('versionInfo').textContent = 'v' + VERSION + ' · ' + deck.cards.length + ' words · ' + deck.cards.length * 2 + ' study cards';
  }

  function readCategoriesFromUI() {
    const boxes = [...$('catList').querySelectorAll('input[type=checkbox]')];
    const on = boxes.filter(b => b.checked).map(b => b.dataset.cat);
    progress.settings.enabledCategories = on.length === deck.categories.length ? null : on;
    saveProgress();
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2200);
  }

  // ---------- backup ----------
  function exportProgress() {
    const blob = new Blob([JSON.stringify({
      type: 'bisaya-flashcards-progress',
      version: VERSION,
      exportedAt: new Date().toISOString(),
      progress
    }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bisaya-progress-' + SRS.dayKey(Date.now()) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $('backupMsg').textContent = 'Exported. Save the file in Files / iCloud Drive.';
  }

  function importProgress(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const p = data.progress || data;
        if (!p.settings || !p.cards) throw new Error('Missing settings/cards');
        progress = {
          settings: Object.assign(defaultSettings(), p.settings),
          cards: p.cards,
          tests: Array.isArray(p.tests) ? p.tests : [],
          version: VERSION
        };
        saveProgress();
        updateHome();
        renderSettings();
        $('backupMsg').textContent = 'Imported ' + Object.keys(progress.cards).length + ' card states and ' + progress.tests.length + ' test results.';
        toast('Progress imported');
      } catch (e) {
        $('backupMsg').textContent = 'Import failed: ' + e.message;
      }
    };
    reader.readAsText(file);
  }

  // ---------- wiring ----------
  function wire() {
    $('startBtn').onclick = startStudy;
    $('backBtn').onclick = () => showView('home');
    document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => showView(b.dataset.go));
    $('card').onclick = flip;
    $('card').onkeydown = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } };
    $('showBtn').onclick = flip;
    $('grades').onclick = (e) => {
      const b = e.target.closest('.grade');
      if (b) grade(+b.dataset.g);
    };
    $('undoBtn').onclick = undo;
    $('dirSeg').onclick = (e) => {
      const b = e.target.closest('button[data-dir]');
      if (!b) return;
      progress.settings.direction = b.dataset.dir;
      saveProgress(); updateHome();
    };
    $('search').oninput = renderBrowse;
    $('browseCat').onchange = renderBrowse;
    $('npd').onchange = () => {
      progress.settings.newPerDay = Math.max(0, Math.min(500, +$('npd').value || 0));
      saveProgress(); updateHome();
    };
    $('npdMinus').onclick = () => { $('npd').value = Math.max(0, (+$('npd').value || 0) - 1); $('npd').dispatchEvent(new Event('change')); };
    $('npdPlus').onclick = () => { $('npd').value = Math.min(500, (+$('npd').value || 0) + 1); $('npd').dispatchEvent(new Event('change')); };
    $('dirSelect').onchange = () => {
      progress.settings.direction = $('dirSelect').value;
      saveProgress(); updateHome();
    };
    $('catList').onchange = readCategoriesFromUI;
    $('catAll').onclick = () => {
      $('catList').querySelectorAll('input').forEach(i => i.checked = true);
      readCategoriesFromUI(); updateHome();
    };
    $('catNone').onclick = () => {
      $('catList').querySelectorAll('input').forEach(i => i.checked = false);
      readCategoriesFromUI(); updateHome();
    };
    $('exportBtn').onclick = exportProgress;
    $('importFile').onchange = (e) => { if (e.target.files[0]) importProgress(e.target.files[0]); e.target.value = ''; };
    $('resetBtn').onclick = () => {
      if (!confirm('Erase all study progress on this device? This cannot be undone unless you exported a backup.')) return;
      progress = { settings: defaultSettings(), cards: {}, tests: [], version: VERSION };
      saveProgress(); updateHome(); renderSettings(); toast('Progress reset');
    };
  }

  // ---------- boot ----------
  async function boot() {
    progress = loadProgress();
    const res = await fetch('cards.json', { cache: 'no-cache' });
    deck = await res.json();
    if (!progress.settings.enabledCategories) {
      // first run: all on
    }
    wire();
    QuizUI.initUI({
      deck: () => deck, progress: () => progress, save: saveProgress, showView, sid, toast, esc, SRS
    });
    updateHome();
    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('sw.js'); } catch (e) { console.warn(e); }
    }
  }

  // Expose for Playwright tests
  window.__bisaya = {
    get progress() { return progress; },
    get deck() { return deck; },
    get queue() { return queue; },
    get current() { return current; },
    counts, buildQueue, grade, flip, startStudy, sid, getState, showView, saveProgress, LS_KEY
  };

  boot().catch(e => {
    document.body.innerHTML = '<p style="padding:24px">Failed to load cards.json: ' + esc(e.message) + '</p>';
  });
})();
