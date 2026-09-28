/* Test (quiz) mode for Bisaya Cards: pure helpers + UI. */
(function (root) {
  'use strict';

  // ---------- pure helpers (unit-tested in Node) ----------
  function norm(s) {
    return String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')      // strip accents (â → a)
      .toLowerCase()
      .replace(/[’‘`´]/g, "'")
      .replace(/[^a-z0-9\s]/g, ' ')                           // punctuation, underscores, quotes
      .replace(/\s+/g, ' ').trim();
  }
  function key(s) { return norm(s).replace(/\s/g, ''); }       // also ignore spaces ("tan-aw" == "tanaw")
  function stripParens(s) { return String(s).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim(); }

  /** All acceptable forms of an answer: full text, text without (…) notes, and each /, " or ", ; alternative. */
  function alternatives(text) {
    const out = new Set();
    const add = (t) => { const k = key(t); if (k) out.add(k); };
    add(text);
    const base = stripParens(text);
    add(base);
    let parts = base.split(/\s*(?:\/|;|\bor\b)\s*/i);
    // Comma lists only when they look like a list of short items (not "I am good, and you?")
    const commaParts = base.split(/\s*,\s*/);
    if (commaParts.length > 1 && commaParts.every(p => p.split(/\s+/).length <= 2 && !/^(and|or|but)\b/i.test(p))) {
      parts = parts.concat(commaParts);
    }
    for (const p of parts) add(p);
    return out;
  }

  function checkTyped(input, answer) {
    const k = key(input);
    if (!k) return false;
    return alternatives(answer).has(k);
  }

  function sideText(card, side) { return side === 'bisaya' ? card.bisaya : card.english; }

  /** Are two cards duplicates / near-duplicates (so one must not be a distractor for the other)? */
  function nearDuplicate(a, b) {
    if (a.id === b.id) return true;
    for (const side of ['bisaya', 'english']) {
      const A = alternatives(sideText(a, side)), B = alternatives(sideText(b, side));
      for (const x of A) if (B.has(x)) return true;
    }
    return false;
  }

  function shuffle(a, rnd) {
    rnd = rnd || Math.random;
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /** Pick up to n distractor cards: same category first, then the rest; unique option text; no near-dups. */
  function pickDistractors(card, answerSide, pool, n, rnd) {
    n = n == null ? 3 : n;
    const chosen = [];
    const seenText = new Set([key(sideText(card, answerSide))]);
    const ok = (c) => {
      if (nearDuplicate(card, c)) return false;
      const k = key(sideText(c, answerSide));
      if (!k || seenText.has(k)) return false;
      for (const d of chosen) if (nearDuplicate(d, c)) return false;
      return true;
    };
    const same = shuffle(pool.filter(c => c.category === card.category), rnd);
    const other = shuffle(pool.filter(c => c.category !== card.category), rnd);
    for (const c of same.concat(other)) {
      if (chosen.length >= n) break;
      if (ok(c)) { chosen.push(c); seenText.add(key(sideText(c, answerSide))); }
    }
    return chosen;
  }

  /** Typed answers need something typeable: table-derived labels / pure "(…)" descriptions go to multiple choice. */
  function typeable(card, dir) {
    const ans = dir === 'b2e' ? card.english : card.bisaya;
    if (!stripParens(ans).replace(/[^\p{L}\p{N}]/gu, '')) return false;
    if (dir === 'b2e' && card.category === 'Pronoun Chart') return false;
    return true;
  }

  /** Build question list. opts: {direction:'b2e'|'e2b'|'mixed', qtype:'mc'|'typed'|'mixed', count:number|'all'} */
  function buildQuestions(cards, allCards, opts, rnd) {
    rnd = rnd || Math.random;
    const pool = shuffle(cards.slice(), rnd);
    const n = opts.count === 'all' ? pool.length : Math.min(+opts.count, pool.length);
    return pool.slice(0, n).map(card => {
      const dir = opts.direction === 'mixed' ? (rnd() < 0.5 ? 'b2e' : 'e2b') : opts.direction;
      let type = opts.qtype === 'mixed' ? (rnd() < 0.5 ? 'mc' : 'typed') : opts.qtype;
      if (type === 'typed' && !typeable(card, dir)) type = 'mc';
      const answerSide = dir === 'b2e' ? 'english' : 'bisaya';
      const q = { card, dir, type, prompt: dir === 'b2e' ? card.bisaya : card.english, answer: sideText(card, answerSide) };
      if (type === 'mc') {
        const ds = pickDistractors(card, answerSide, allCards, 3, rnd);
        q.options = shuffle([card].concat(ds).map(c => ({ id: c.id, text: sideText(c, answerSide) })), rnd);
      }
      return q;
    });
  }

  const api = { norm, key, alternatives, checkTyped, nearDuplicate, pickDistractors, typeable, buildQuestions, stripParens };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.Quiz = api;

  // ---------- UI ----------
  const $ = (id) => document.getElementById(id);
  let A = null;                 // app API
  let T = null;                 // current test session
  const setup = { direction: 'mixed', qtype: 'mc', count: 10, cats: null };

  function esc(s) { return A.esc(s); }

  function initUI(app) {
    A = app;
    const saved = A.progress().settings.testSetup;
    if (saved) Object.assign(setup, saved);
    $('testBtn').onclick = () => A.showView('testSetup');
    for (const segId of ['tDir', 'tType', 'tCount']) {
      $(segId).onclick = (e) => {
        const b = e.target.closest('button[data-v]'); if (!b) return;
        const field = { tDir: 'direction', tType: 'qtype', tCount: 'count' }[segId];
        setup[field] = field === 'count' && b.dataset.v !== 'all' ? +b.dataset.v : b.dataset.v;
        renderSetup();
      };
    }
    $('tCatAll').onclick = () => { setup.cats = null; renderSetup(); };
    $('tCatNone').onclick = () => { setup.cats = []; renderSetup(); };
    $('tCatList').onchange = () => {
      const on = [...$('tCatList').querySelectorAll('input:checked')].map(i => i.dataset.cat);
      setup.cats = on.length === A.deck().categories.length ? null : on;
      renderSetup();
    };
    $('tStart').onclick = () => startTest(null);
    $('tOptions').onclick = (e) => { const b = e.target.closest('button[data-i]'); if (b) answerMC(+b.dataset.i); };
    $('tTypedForm').onsubmit = (e) => { e.preventDefault(); answerTyped(); };
    $('tOverride').onclick = override;
    $('tNext').onclick = next;
    $('tRetake').onclick = () => startTest(T.missed.map(m => ({ card: m.card, dir: m.dir })));
    $('tAgain').onclick = () => A.showView('testSetup');
    $('tHome').onclick = () => A.showView('home');
  }

  function catsSelected() {
    return setup.cats ? new Set(setup.cats) : new Set(A.deck().categories);
  }

  function renderSetup() {
    const mark = (segId, val) => {
      for (const b of $(segId).querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === String(val));
    };
    mark('tDir', setup.direction); mark('tType', setup.qtype); mark('tCount', setup.count);
    const sel = catsSelected();
    const deck = A.deck();
    $('tCatList').innerHTML = deck.categories.map(cat => {
      const n = deck.cards.filter(c => c.category === cat).length;
      return '<label><input type="checkbox" data-cat="' + esc(cat) + '"' + (sel.has(cat) ? ' checked' : '') + '> <span>' + esc(cat) + '</span><span class="n">' + n + '</span></label>';
    }).join('');
    const avail = deck.cards.filter(c => sel.has(c.category)).length;
    const n = setup.count === 'all' ? avail : Math.min(setup.count, avail);
    $('tCatSummary').textContent = sel.size === deck.categories.length ? 'All categories (' + avail + ' words)' : sel.size + ' categories · ' + avail + ' words';
    $('tStart').disabled = avail === 0;
    $('tStart').textContent = avail ? 'Start test · ' + n + ' question' + (n === 1 ? '' : 's') : 'Pick at least one category';
    renderHistory($('tHistory'));
  }

  function history() { return A.progress().tests || []; }

  function bestResult() {
    let best = null;
    for (const h of history()) if (!best || h.pct > best.pct || (h.pct === best.pct && h.total > best.total)) best = h;
    return best;
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  const DIR_LABEL = { b2e: 'B→E', e2b: 'E→B', mixed: 'Mixed' };
  const TYPE_LABEL = { mc: 'Multiple choice', typed: 'Typed', mixed: 'Mixed' };

  function renderHistory(el) {
    const h = history();
    if (!h.length) { el.innerHTML = '<p class="muted small">No tests yet.</p>'; return; }
    const best = bestResult();
    el.innerHTML = '<p class="small"><b>Best:</b> ' + best.score + '/' + best.total + ' (' + best.pct + '%) · ' + esc(fmtDate(best.date)) + '</p>' +
      '<ul class="list hist">' + h.slice(-5).reverse().map(r =>
        '<li><div class="b">' + r.score + '/' + r.total + ' · ' + r.pct + '%' + (r.retake ? ' <span class="tag">retake</span>' : '') + '</div>' +
        '<div class="e small">' + esc(fmtDate(r.date)) + ' · ' + DIR_LABEL[r.settings.direction] + ' · ' + TYPE_LABEL[r.settings.qtype] +
        ' · ' + (r.settings.categories ? r.settings.categories.length + ' categories' : 'all categories') + '</div></li>').join('') + '</ul>';
  }

  function homeSummary() {
    const h = history();
    if (!h.length) return 'No tests yet';
    const last = h[h.length - 1], best = bestResult();
    return 'Last ' + last.score + '/' + last.total + ' (' + last.pct + '%) · Best ' + best.pct + '%';
  }

  // ---------- running a test ----------
  function startTest(retakeItems) {
    const deck = A.deck();
    let qs;
    if (retakeItems) {
      // Retake: exactly the missed words, each in the direction it was missed; type from setup
      qs = shuffle(retakeItems.map(r =>
        buildQuestions([r.card], deck.cards, { direction: r.dir, qtype: setup.qtype, count: 1 })[0]));
    } else {
      A.progress().settings.testSetup = Object.assign({}, setup);
      A.save();
      const sel = catsSelected();
      qs = buildQuestions(deck.cards.filter(c => sel.has(c.category)), deck.cards, setup);
    }
    if (!qs.length) { A.toast('No words to test'); return; }
    T = { qs, i: 0, score: 0, missed: [], answered: false, retake: !!retakeItems, settings: Object.assign({}, setup) };
    A.showView('test');
    renderQuestion();
  }

  function renderQuestion() {
    window.scrollTo(0, 0);
    const q = T.qs[T.i];
    T.answered = false; T.correct = null; T.snapshot = undefined;
    $('tProgress').textContent = 'Question ' + (T.i + 1) + ' of ' + T.qs.length;
    $('tScore').textContent = T.score + ' correct';
    $('tBar').style.width = (100 * T.i / T.qs.length) + '%';
    $('tDirLabel').textContent = q.dir === 'b2e' ? 'Bisaya → English' : 'English → Bisaya';
    $('tCat').textContent = q.card.category;
    $('tPrompt').innerHTML = esc(q.prompt) + (q.card.context ? '<span class="ctx">' + esc(q.card.context) + '</span>' : '');
    $('tFeedback').hidden = true;
    $('tFeedback').className = 'feedback';
    $('tNext').hidden = true;
    $('tOverride').hidden = true;
    if (q.type === 'mc') {
      $('tTypedForm').hidden = true;
      $('tOptions').hidden = false;
      $('tOptions').innerHTML = q.options.map((o, i) => '<button class="opt" data-i="' + i + '">' + esc(o.text) + '</button>').join('');
    } else {
      $('tOptions').hidden = true;
      $('tTypedForm').hidden = false;
      const inp = $('tInput');
      inp.value = ''; inp.disabled = false; inp.className = '';
      inp.placeholder = q.dir === 'b2e' ? 'Type the English…' : 'Type the Bisaya…';
      $('tSubmit').disabled = false;
      setTimeout(() => inp.focus(), 50);
    }
  }

  function answerMC(i) {
    if (T.answered) return;
    const q = T.qs[T.i];
    const correct = q.options[i].id === q.card.id;
    const btns = $('tOptions').querySelectorAll('.opt');
    btns.forEach((b, j) => {
      b.disabled = true;
      if (q.options[j].id === q.card.id) b.classList.add('right');
      else if (j === i) b.classList.add('wrong');
    });
    finish(correct, q.options[i].text);
  }

  function answerTyped() {
    if (T.answered) return;
    const q = T.qs[T.i];
    const val = $('tInput').value;
    if (!val.trim()) { $('tInput').focus(); return; }
    const correct = checkTyped(val, q.answer);
    $('tInput').disabled = true;
    $('tSubmit').disabled = true;
    $('tInput').className = correct ? 'right' : 'wrong';
    finish(correct, val);
    if (!correct) $('tOverride').hidden = false;
  }

  function finish(correct, given) {
    const q = T.qs[T.i];
    T.answered = true; T.correct = correct; T.given = given;
    if (correct) T.score++;
    else {
      T.missed.push({ card: q.card, dir: q.dir, given });
      T.snapshot = penalize(q.card, q.dir);
    }
    const fb = $('tFeedback');
    fb.hidden = false;
    fb.className = 'feedback ' + (correct ? 'ok' : 'bad');
    const extra = [];
    if (q.card.notes && q.card.notes.length) extra.push(esc(q.card.notes[0]));
    fb.innerHTML = '<div class="verdict">' + (correct ? '✓ Correct' : '✗ Not quite') + '</div>' +
      '<div class="pair"><b>' + esc(q.card.bisaya) + '</b> = ' + esc(q.card.english) + '</div>' +
      (!correct && q.type === 'typed' ? '<div class="small">You typed: ' + esc(given) + '</div>' : '') +
      (extra.length ? '<div class="small muted">' + extra.join('<br>') + '</div>' : '');
    $('tScore').textContent = T.score + ' correct';
    $('tNext').hidden = false;
    $('tNext').textContent = T.i + 1 < T.qs.length ? 'Next →' : 'See results';
    A.save();
    // keep feedback + Next visible on a small phone screen
    requestAnimationFrame(() => $('tNext').scrollIntoView({ block: 'end', behavior: 'smooth' }));
  }

  function override() {
    if (!T.answered || T.correct) return;
    const q = T.qs[T.i];
    T.correct = true; T.score++;
    T.missed = T.missed.filter(m => !(m.card.id === q.card.id && m.dir === q.dir));
    // undo the spaced-repetition penalty
    const s = A.sid(q.card.id, q.dir);
    if (T.snapshot === null) delete A.progress().cards[s];
    else if (T.snapshot) A.progress().cards[s] = T.snapshot;
    A.save();
    $('tOverride').hidden = true;
    $('tInput').className = 'right';
    $('tFeedback').className = 'feedback ok';
    $('tFeedback').querySelector('.verdict').textContent = '✓ Counted as correct';
    $('tScore').textContent = T.score + ' correct';
  }

  /** Missed word → its flashcard becomes due now (gentle lapse). Returns the previous state for undo. */
  function penalize(card, dir) {
    const now = Date.now();
    const s = A.sid(card.id, dir);
    const cards = A.progress().cards;
    const prev = cards[s] ? JSON.parse(JSON.stringify(cards[s])) : null;
    const st = Object.assign(A.SRS.newState(), cards[s] || {});
    const today = A.SRS.dayKey(now);
    const already = st.testMissedAt && A.SRS.dayKey(st.testMissedAt) === today;
    if (st.state === 'new') {
      st.priority = now;                          // introduced first among new cards
    } else if (st.state === 'review') {
      if (!already) {
        st.interval = Math.max(1, Math.round(st.interval / 2));
        st.ease = Math.max(A.SRS.CFG.minEase, st.ease - 0.1);
      }
      st.due = now;
    } else {                                      // learning / relearning
      st.due = Math.min(st.due, now);
    }
    st.testMissedAt = now;
    cards[s] = st;
    return prev;
  }

  function next() {
    if (!T.answered) return;
    T.i++;
    if (T.i < T.qs.length) { renderQuestion(); return; }
    showResults();
  }

  function showResults() {
    const total = T.qs.length, pct = Math.round(100 * T.score / total);
    const p = A.progress();
    p.tests = p.tests || [];
    p.tests.push({
      date: new Date().toISOString(), score: T.score, total, pct, retake: T.retake,
      settings: { direction: T.settings.direction, qtype: T.settings.qtype, count: T.retake ? total : T.settings.count, categories: T.settings.cats }
    });
    if (p.tests.length > 200) p.tests = p.tests.slice(-200);
    A.save();
    A.showView('testResults');
    $('rScore').textContent = T.score + ' / ' + total;
    $('rPct').textContent = pct + '%';
    $('rMsg').textContent = pct === 100 ? 'Perfect! Maayo kaayo! 🎉' : pct >= 80 ? 'Great job!' : pct >= 50 ? 'Good progress — keep going.' : 'Keep practising — missed words are now due in your flashcards.';
    $('rMissedWrap').hidden = !T.missed.length;
    $('tRetake').hidden = !T.missed.length;
    $('tRetake').textContent = 'Retake missed (' + T.missed.length + ')';
    $('rMissed').innerHTML = T.missed.map(m =>
      '<li><div class="b">' + esc(m.card.bisaya) + '</div><div class="e">' + esc(m.card.english) + '</div>' +
      '<div class="m"><span class="tag">' + (m.dir === 'b2e' ? 'B→E' : 'E→B') + '</span><span class="tag">' + esc(m.card.category) + '</span>' +
      '<span class="tag due">you: ' + esc(m.given) + '</span></div></li>').join('');
    renderHistory($('rHistory'));
  }

  root.QuizUI = { initUI, renderSetup, homeSummary, get session() { return T; } };
})(this);
