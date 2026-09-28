/* SM-2 style scheduler (Anki-like variant). Pure functions; works in browser and Node. */
(function (root) {
  'use strict';
  const MIN = 60 * 1000, DAY = 24 * 60 * MIN;
  const CFG = {
    learningSteps: [1, 10],     // minutes
    relearnSteps: [10],         // minutes
    graduatingInterval: 1,      // days (Good on last step)
    easyInterval: 4,            // days (Easy on a new/learning card)
    startEase: 2.5, minEase: 1.3,
    hardFactor: 1.2, easyBonus: 1.3, lapseFactor: 0,  // lapse: interval reset (0 => 1 day)
    maxInterval: 36500
  };

  function newState() {
    return { state: 'new', ease: CFG.startEase, interval: 0, reps: 0, lapses: 0, step: 0, due: 0, last: 0 };
  }

  // Start of the local day containing ts
  function dayStart(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function dayKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // Review due dates land at the start of a local day so "due today" is stable.
  function dueInDays(now, days) {
    const d = new Date(dayStart(now)); d.setDate(d.getDate() + days); return d.getTime();
  }

  /** grade: 1 Again, 2 Hard, 3 Good, 4 Easy. Returns a NEW state object. */
  function schedule(prev, grade, now) {
    const s = Object.assign(newState(), prev || {});
    s.last = now;
    if (s.state === 'new') { s.state = 'learning'; s.step = 0; }

    if (s.state === 'learning' || s.state === 'relearning') {
      const steps = s.state === 'learning' ? CFG.learningSteps : CFG.relearnSteps;
      if (grade === 1) {
        s.step = 0; s.due = now + steps[0] * MIN;
      } else if (grade === 2) {
        // repeat current step; on first step use avg of step 1 & 2 (like Anki)
        const m = s.step === 0 && steps.length > 1 ? (steps[0] + steps[1]) / 2 : steps[s.step];
        s.due = now + m * MIN;
      } else if (grade === 3) {
        if (s.step + 1 < steps.length) { s.step += 1; s.due = now + steps[s.step] * MIN; }
        else graduate(s, s.state === 'learning' ? CFG.graduatingInterval : Math.max(1, s.interval), now);
      } else { // Easy
        const iv = s.state === 'learning' ? CFG.easyInterval : Math.max(1, s.interval) + 1;
        graduate(s, iv, now);
      }
      return s;
    }

    // review
    s.reps += 1;
    const late = Math.max(0, Math.floor((dayStart(now) - dayStart(s.due)) / DAY));
    if (grade === 1) {
      s.lapses += 1;
      s.ease = Math.max(CFG.minEase, s.ease - 0.2);
      s.interval = Math.max(1, Math.round(s.interval * CFG.lapseFactor));
      s.state = 'relearning'; s.step = 0; s.due = now + CFG.relearnSteps[0] * MIN;
      return s;
    }
    let iv;
    if (grade === 2) { s.ease = Math.max(CFG.minEase, s.ease - 0.15); iv = s.interval * CFG.hardFactor; }
    else if (grade === 3) { iv = (s.interval + late / 2) * s.ease; }
    else { s.ease += 0.15; iv = (s.interval + late) * s.ease * CFG.easyBonus; }
    iv = Math.round(iv);
    iv = Math.max(iv, s.interval + 1);   // always move forward at least a day
    if (grade === 4) iv = Math.max(iv, Math.round(s.interval * s.ease) + 1);
    s.interval = Math.min(CFG.maxInterval, iv);
    s.due = dueInDays(now, s.interval);
    return s;
  }

  function graduate(s, days, now) {
    s.state = 'review'; s.step = 0; s.interval = days; s.reps += 1;
    s.due = dueInDays(now, days);
  }

  function fmtInterval(s, now) {
    const ms = s.due - now;
    if (s.state === 'learning' || s.state === 'relearning') {
      const m = Math.max(1, Math.round(ms / MIN));
      return m < 60 ? m + 'm' : Math.round(m / 60) + 'h';
    }
    const d = s.interval;
    if (d < 30) return d + 'd';
    if (d < 365) return (d / 30).toFixed(d < 60 ? 1 : 0).replace(/\.0$/, '') + 'mo';
    return (d / 365).toFixed(1).replace(/\.0$/, '') + 'y';
  }

  const api = { CFG, MIN, DAY, newState, schedule, fmtInterval, dayStart, dayKey, dueInDays };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SRS = api;
})(this);
