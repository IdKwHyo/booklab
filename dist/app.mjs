import { resolveScreen } from './routes.mjs';

const $ = selector => document.querySelector(selector);
const defaults = () => ({ horizon: 1, features: 'all', deadband: .001, train: 60, split: 'chronological', leak: false });
const state = { dataset: null, config: defaults(), cursor: 0, playing: false, result: null, busy: false, dirty: false, worker: null, loadToken: 0, saved: [], predictionMap: new Map() };
const money = value => Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const count = value => Number(value).toLocaleString('en-US');
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const signed = value => `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;
const direction = value => value === 1 ? 'Up' : value === -1 ? 'Down' : 'Unchanged';
const time = value => new Date(value).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 1 });
let toastTimer, playbackTimer, replayClock, lastTick;

try {
  const saved = JSON.parse(localStorage.getItem('booklab-experiments-v1') || '[]');
  state.saved = Array.isArray(saved) ? saved.filter(run => run?.result?.scores?.logistic && ['recorded', 'synthetic'].includes(run.result.dataset)).slice(0, 20) : [];
} catch { state.saved = []; }

function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 3500); }

function navigate() {
  const previous = document.body.dataset.screen;
  const view = resolveScreen(location.hash);
  if (previous !== view) document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  document.body.dataset.screen = view;
  $('#top').hidden = view !== 'welcome';
  $('.workspace').hidden = view === 'welcome';
  $('.maison-footer').hidden = view === 'welcome';
  $('.skip').href = view === 'welcome' ? '#workbench' : '#main';
  $('.skip').textContent = view === 'welcome' ? 'Skip to laboratory' : 'Skip to content';
  document.querySelectorAll('[data-view]').forEach(el => el.hidden = el.dataset.view !== view);
  document.querySelectorAll('[data-nav]').forEach(el => { if (el.dataset.nav === view) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  $('#view-label').textContent = ({ workbench: 'Laboratory', experiments: 'Notebook', dataset: 'The evidence', method: 'Our method' })[view] || 'Laboratory';
  document.title = `BookLab — ${view === 'welcome' ? 'Beyond the surface' : $('#view-label').textContent}`;
  window.scrollTo(0, 0);
  if (view !== 'workbench') pause();
  else if (state.dataset) renderFrame();
  if (view === 'experiments') renderHistory();
  if (previous && previous !== view) {
    const heading = view === 'welcome' ? $('#hero-title') : $('[data-view]:not([hidden]) h1');
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
  window.dispatchEvent(new CustomEvent('booklab:view', { detail: { view, previous } }));
}
window.addEventListener('hashchange', navigate);
navigate();
$('.skip').addEventListener('click', event => {
  if (document.body.dataset.screen === 'welcome') return;
  event.preventDefault();
  const heading = $('[data-view]:not([hidden]) h1');
  heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true });
  heading.scrollIntoView({ block: 'start', behavior: 'instant' });
});

function readControls() {
  return { ...state.config, features: $('#features').value, deadband: Number($('#deadband').value), train: Number($('#train-share').value), split: $('#split-mode').value, leak: $('#leak-feature').checked };
}
function syncControls() {
  $('#features').value = state.config.features; $('#deadband').value = state.config.deadband;
  $('#train-share').value = state.config.train; $('#train-output').textContent = `${state.config.train}%`;
  $('#split-mode').value = state.config.split; $('#leak-feature').checked = state.config.leak;
  document.querySelectorAll('[data-horizon]').forEach(button => {
    const selected = Number(button.dataset.horizon) === state.config.horizon;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  });
  const unsafe = state.config.leak || state.config.split === 'random';
  $('#leak-warning').hidden = !unsafe;
  if (unsafe) $('.leakage-tools').open = true;
}
function changed() {
  state.config = readControls(); state.dirty = true; syncControls();
  if (state.result) { $('#result-status').textContent = 'Settings changed · run again'; $('#save-run').disabled = true; }
}
document.querySelectorAll('[data-horizon]').forEach(button => button.addEventListener('click', () => { state.config.horizon = Number(button.dataset.horizon); changed(); }));
for (const selector of ['#features', '#deadband', '#train-share', '#split-mode', '#leak-feature']) $(selector).addEventListener('input', changed);
syncControls();

async function loadDataset(id) {
  const token = ++state.loadToken;
  pause(); if (state.worker) state.worker.terminate(); state.busy = false; state.dataset = null; state.result = null;
  state.predictionMap.clear(); $('#run').disabled = true; $('#play').disabled = true; $('#seek').disabled = true;
  $('#result-content').hidden = true; $('#result-empty').hidden = false; $('#export').disabled = true; $('#progress').textContent = 'Opening the research sample…';
  try {
    const response = await fetch(`/data/${id}.json`);
    if (!response.ok) throw new Error('Sample request failed.');
    const dataset = await response.json();
    if (token !== state.loadToken) return;
    if (!dataset.frames?.length) throw new Error('The sample has no observations.');
    state.dataset = dataset; state.cursor = Math.floor(dataset.frames.length * .72);
    $('#seek').max = dataset.frames.length - 1; $('#seek').disabled = false; $('#play').disabled = false;
    $('#source-badge').textContent = id === 'recorded' ? 'Recorded sample' : 'Synthetic sample';
    $('#sample-note').textContent = dataset.note;
    $('#capture-time').textContent = id === 'recorded' ? `${new Date(dataset.frames[0].t).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })} · historical capture · UTC` : 'Artificial sessions · observation order · session gaps omitted';
    renderFrame(); renderInspector(); runExperiment();
  } catch (error) {
    if (token !== state.loadToken) return;
    $('#progress').textContent = 'The sample could not load. Use Retry sample to try again.';
    $('#price-chart').innerHTML = '<div class="loading-state">Sample unavailable. Retry to continue.</div>';
    $('#result-status').textContent = 'Sample unavailable'; $('#run').disabled = false; $('#run').textContent = 'Retry sample ↗';
    toast(error.message);
  }
}
$('#dataset-choice').addEventListener('change', event => loadDataset(event.target.value));

function renderChart() {
  const frames = state.dataset.frames, current = frames[state.cursor];
  const min = Math.min(...frames.map(f => f.m)), max = Math.max(...frames.map(f => f.m));
  const pad = Math.max((max - min) * .2, .02), bottom = min - pad, top = max + pad;
  const width = Math.max(280, $('#price-chart').clientWidth - 28), left = 62, right = width - 16, span = right - left;
  const x = index => left + index / Math.max(1, frames.length - 1) * span, y = price => 218 - (price - bottom) / (top - bottom) * 190;
  const stride = Math.max(1, Math.floor(frames.length / 500));
  const sampled = frames.map((f, i) => ({ f, i })).filter(({ i }) => i % stride === 0 || i === frames.length - 1);
  const path = sampled.map(({ f, i }, n) => `${n ? 'L' : 'M'}${x(i).toFixed(2)},${y(f.m).toFixed(2)}`).join(' ');
  const grid = [0, 1, 2, 3].map(n => { const price = bottom + (top - bottom) * n / 3, yy = y(price); return `<line x1="${left}" x2="${right}" y1="${yy}" y2="${yy}" stroke="#edf0e8"/><text x="${left - 7}" y="${yy + 3}" text-anchor="end">${price.toFixed(2)}</text>`; }).join('');
  const labels = [0, .25, .5, .75, 1].map((ratio, i) => { const index = Math.round((frames.length - 1) * ratio), label = state.dataset.id === 'recorded' ? `${((frames[index].t - frames[0].t) / 1000).toFixed(0)}s` : `Session ${frames[index].s + 1}`; return `<text x="${left + ratio * span}" y="244" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${label}</text>`; }).join('');
  const holdout = state.result?.validProtocol && state.result.split.testStart !== null ? state.result.split.testStart : null;
  const startIndex = holdout === null ? -1 : frames.findIndex(f => f.t >= holdout);
  const shade = startIndex >= 0 ? `<rect x="${x(startIndex)}" y="22" width="${right - x(startIndex)}" height="196" fill="#edf3e9"/><text x="${x(startIndex) + 8}" y="34" fill="#719374">Holdout</text>` : '';
  $('#price-chart').innerHTML = `<svg viewBox="0 0 ${width} 260" role="img" aria-label="Mid-price in US dollars over recorded observation order. Use the replay slider to inspect an observation.">${shade}${grid}<path d="${path}" fill="none" stroke="#548162" stroke-width="1.8" stroke-linejoin="round"/><line x1="${x(state.cursor)}" x2="${x(state.cursor)}" y1="22" y2="218" stroke="#93a991" stroke-width="1" stroke-dasharray="3 4"/><circle cx="${x(state.cursor)}" cy="${y(current.m)}" r="4" fill="#245a43" stroke="white" stroke-width="2"/>${labels}</svg>`;
}

function renderFrame() {
  if (!state.dataset) return;
  const frames = state.dataset.frames, frame = frames[state.cursor];
  $('#seek').value = state.cursor;
  $('#seek').setAttribute('aria-valuetext', `${time(frame.t)} UTC, midpoint ${money(frame.m)} US dollars`);
  $('#mid-price').textContent = money(frame.m);
  const sameSession = frames.filter(f => f.s === frame.s), elapsed = (frame.t - sameSession[0].t) / 1000;
  $('#replay-time').textContent = `${Math.floor(elapsed / 60).toString().padStart(2, '0')}:${(elapsed % 60).toFixed(1).padStart(4, '0')}`;
  $('#observation-counter').textContent = `${count(state.cursor + 1)} / ${count(frames.length)} observations`;
  const largest = Math.max(...frame.b.map(level => level[1]), ...frame.a.map(level => level[1]));
  $('#book-levels').innerHTML = Array.from({ length: Math.max(frame.b.length, frame.a.length) }, (_, i) => {
    const b = frame.b[i], a = frame.a[i];
    return `<div class="book-row"><span class="bid-cell"><i style="width:${b ? Math.max(1, b[1] / largest * 100) : 0}%"></i>${b ? b[1].toFixed(4) : '—'}</span><span class="book-price"><span class="ask">${a ? money(a[0]) : '—'}</span><span class="bid">${b ? money(b[0]) : '—'}</span></span><span class="ask-cell"><i style="width:${a ? Math.max(1, a[1] / largest * 100) : 0}%"></i>${a ? a[1].toFixed(4) : '—'}</span></div>`;
  }).join('');
  const imbalance = (frame.b[0][1] - frame.a[0][1]) / (frame.b[0][1] + frame.a[0][1]);
  $('#imbalance-value').textContent = signed(imbalance); $('#imbalance-fill').style.width = `${(imbalance + 1) / 2 * 100}%`;
  const predicted = state.predictionMap.get(state.cursor);
  $('#frame-prediction').innerHTML = predicted ? `<strong>Held-out prediction: ${direction(predicted.predicted)}</strong><br>Observed later: ${direction(predicted.actual)} · ${time(frame.t)} UTC` : `Observation ${count(state.cursor + 1)} · ${time(frame.t)} UTC<br>${frame.x ? 'Outside the current held-out predictions.' : 'Warming up five seconds of trailing history.'}`;
  renderChart();
}
window.addEventListener('resize', () => { if (state.dataset) renderChart(); });
$('#seek').addEventListener('input', event => { pause(); state.cursor = Number(event.target.value); renderFrame(); });
$('#price-chart').addEventListener('click', event => {
  if (!state.dataset) return;
  const svg = $('#price-chart svg'); if (!svg) return;
  const box = svg.getBoundingClientRect(), width = svg.viewBox.baseVal.width;
  const ratio = Math.max(0, Math.min(1, ((event.clientX - box.left) / box.width * width - 62) / (width - 78)));
  pause(); state.cursor = Math.round(ratio * (state.dataset.frames.length - 1)); renderFrame();
});
function pause() { clearInterval(playbackTimer); state.playing = false; $('#play').textContent = '▶'; $('#play').setAttribute('aria-label', 'Play replay'); }
function play() {
  if (!state.dataset) return;
  if (state.cursor >= state.dataset.frames.length - 1) state.cursor = 0;
  state.playing = true; $('#play').textContent = 'Ⅱ'; $('#play').setAttribute('aria-label', 'Pause replay');
  clearInterval(playbackTimer);
  replayClock = state.dataset.frames[state.cursor].t; lastTick = performance.now();
  playbackTimer = setInterval(() => {
    const now = performance.now(), frames = state.dataset.frames;
    replayClock += (now - lastTick) * Number($('#speed').value); lastTick = now;
    const previous = state.cursor;
    while (state.cursor + 1 < frames.length && frames[state.cursor + 1].s === frames[state.cursor].s && frames[state.cursor + 1].t <= replayClock) state.cursor++;
    if (state.cursor + 1 < frames.length && frames[state.cursor + 1].s !== frames[state.cursor].s && replayClock > frames[state.cursor].t + 100) { state.cursor++; replayClock = frames[state.cursor].t; }
    if (previous !== state.cursor) renderFrame();
    if (state.cursor === frames.length - 1) pause();
  }, 100);
}
$('#play').addEventListener('click', () => state.playing ? pause() : play());
$('#speed').addEventListener('change', () => { if (state.playing) play(); });
$('#jump-holdout').addEventListener('click', () => { if (!state.result) return; pause(); state.cursor = state.result.predictions[0].i; renderFrame(); });

function runExperiment() {
  if (!state.dataset) return loadDataset($('#dataset-choice').value);
  state.config = readControls();
  if (!Number.isFinite(state.config.deadband) || state.config.deadband < 0 || state.config.deadband > 5) { toast('Enter a deadband between 0 and 5 basis points.'); $('#deadband').focus(); return; }
  if (state.worker) state.worker.terminate();
  state.busy = true; $('#run').disabled = true; $('#run').textContent = 'Running…'; $('#result-content').hidden = true; $('#result-empty').hidden = false; $('#result-status').textContent = 'Calculating locally'; $('#progress').textContent = 'Building causal features and forward labels…';
  $('#export').disabled = true; pause();
  state.worker = new Worker('/worker.mjs', { type: 'module' });
  state.worker.onmessage = ({ data }) => {
    if (data.type === 'progress') { $('#progress').textContent = `${data.message}…`; return; }
    state.busy = false; $('#run').disabled = false; $('#run').innerHTML = 'Run experiment <span aria-hidden="true">↗</span>';
    if (data.type === 'error') { $('#progress').textContent = data.message; $('#result-status').textContent = 'Adjust the settings'; toast(data.message); return; }
    state.result = data.result; state.dirty = JSON.stringify(state.config) !== JSON.stringify(data.result.config);
    state.predictionMap = new Map(data.result.predictions.map(row => [row.i, row]));
    renderResult(); renderFrame(); $('#jump-holdout').disabled = false; $('#export').disabled = false;
  };
  state.worker.onerror = () => { state.busy = false; $('#run').disabled = false; $('#run').textContent = 'Retry experiment ↗'; $('#progress').textContent = 'The experiment worker could not finish. Retry the experiment.'; $('#result-status').textContent = 'Retry needed'; };
  state.worker.postMessage({ dataset: state.dataset, config: state.config });
}
$('#run').addEventListener('click', runExperiment);
$('#reset').addEventListener('click', () => { state.config = defaults(); syncControls(); $('.leakage-tools').open = false; runExperiment(); toast('Controls reset to the valid chronological experiment.'); });

function renderResult() {
  const result = state.result, { scores, split, uncertainty: ci } = result;
  $('#result-empty').hidden = true; $('#result-content').hidden = false;
  $('#result-status').textContent = state.dirty ? 'Settings changed · run again' : result.validProtocol ? 'Chronological · purged' : 'Invalid protocol demo';
  $('#result-status').classList.toggle('bad', !result.validProtocol);
  $('#main-f1').textContent = scores.logistic.f1.toFixed(3); $('#delta-f1').textContent = `${signed(scores.logistic.f1 - scores.majority.f1)} vs majority baseline`;
  $('#test-count').textContent = count(split.test); $('#purge-count').textContent = `${split.purged} boundary overlaps purged`;
  $('#selected-c').textContent = `C = ${result.selectedC}`;
  $('#model-comparison').innerHTML = [['majority', 'Majority class'], ['imbalance', 'Imbalance rule'], ['logistic', 'Logistic model']].map(([key, label]) => `<div class="model-row"><span class="model-label">${label}${key === 'logistic' ? '<b>Fitted</b>' : ''}</span><div class="model-track"><div class="model-bar ${key}" style="width:${scores[key].f1 * 100}%"></div></div><strong>${scores[key].f1.toFixed(3)}</strong></div>`).join('');
  const insight = $('#result-insight'); insight.classList.toggle('bad', !result.validProtocol);
  if (!result.validProtocol) insight.textContent = 'Invalid demonstration: future information or shuffled observations compromise this evaluation.';
  else if (result.source === 'synthetic') insight.textContent = 'Artificial data. Use these scores to explore the workflow, not infer market performance.';
  else if (ci.blocks < 20 || ci.low <= 0) insight.textContent = 'This short capture cannot establish a reliable improvement over the baseline.';
  else insight.textContent = 'The model improved in this capture. Test later, unseen days before treating it as a durable signal.';
  $('#interval-note').textContent = `Exploratory 95% interval for Δ macro F1: ${signed(ci.low)} to ${signed(ci.high)} · ${ci.blocks} five-second blocks · ${ci.draws} paired resamples.`;
  $('#save-run').disabled = state.dirty;
  $('#class-table').innerHTML = '<caption class="sr-only">Logistic model performance by class</caption><thead><tr><th>Direction</th><th>Precision</th><th>Recall</th><th>F1</th><th>Count</th></tr></thead><tbody>' + scores.logistic.classes.map(row => `<tr><td>${direction(row.label)}</td><td>${row.precision.toFixed(3)}</td><td>${row.recall.toFixed(3)}</td><td>${row.f1.toFixed(3)}</td><td>${count(row.support)}</td></tr>`).join('') + '</tbody>';
  $('#validation-detail').innerHTML = `<p style="margin:16px 0 5px">${escape(split.mode)} · ${count(split.train)} training / ${count(split.validation)} validation / ${count(split.test)} test observations.</p><p>Validation macro F1: ${result.candidates.map(c => `C=${c.C}: ${c.f1.toFixed(3)}`).join(' · ')}.</p>`;
  $('#model-note').textContent = result.implementation;
}

function persistHistory() {
  try {
    if (state.saved.length) localStorage.setItem('booklab-experiments-v1', JSON.stringify(state.saved));
    else localStorage.removeItem('booklab-experiments-v1');
  } catch { toast('Browser storage is unavailable. Export your result to keep it.'); }
  $('#saved-count').textContent = state.saved.length;
}
$('#save-run').addEventListener('click', () => {
  if (!state.result || state.dirty) return;
  const result = { ...state.result, predictions: undefined };
  state.saved.unshift({ createdAt: new Date().toISOString(), result });
  state.saved = state.saved.slice(0, 20); persistHistory(); toast('Experiment saved in this browser.');
});
function renderHistory() {
  $('#history-list').innerHTML = state.saved.length ? state.saved.map((entry, index) => {
    const r = entry.result;
    return `<article class="panel history-card"><div><span class="quiet-badge ${r.validProtocol ? '' : 'bad'}">${r.validProtocol ? 'Chronological · purged' : 'Invalid protocol demo'}</span><h2>${r.dataset === 'recorded' ? 'Coinbase · BTC-USD' : 'Synthetic sessions'} · ${r.config.horizon}s ahead</h2><p>${escape(new Date(entry.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', calendar: 'gregory' }))} · ${r.config.features === 'book' ? 'Order book' : 'Book + trailing returns'}</p></div><div class="history-data"><div><strong>${r.scores.logistic.f1.toFixed(3)}</strong><span>Logistic macro F1</span></div><div><strong>${signed(r.scores.logistic.f1 - r.scores.majority.f1)}</strong><span>vs majority</span></div></div><div class="history-actions"><button class="button secondary small" data-reload="${index}">Rerun settings ↗</button><button class="delete-run" data-delete="${index}" aria-label="Remove experiment ${index + 1}">Remove</button></div></article>`;
  }).join('') : '<div class="panel empty-history"><h2>Your next useful question starts here.</h2><p>Run an experiment in the workbench, then save it. Your settings and results will stay in this browser.</p><a class="button primary" href="#workbench">Open the workbench ↗</a></div>';
}
$('#history-list').addEventListener('click', event => {
  const remove = event.target.closest('[data-delete]'), reload = event.target.closest('[data-reload]');
  if (remove) { state.saved.splice(Number(remove.dataset.delete), 1); persistHistory(); renderHistory(); toast('Experiment removed.'); }
  if (reload) { const result = state.saved[Number(reload.dataset.reload)].result; state.config = { ...defaults(), ...result.config }; syncControls(); $('#dataset-choice').value = result.dataset; location.hash = 'workbench'; loadDataset(result.dataset); }
});
persistHistory();
$('#confirm-clear-saved').addEventListener('click', () => {
  state.saved = []; persistHistory(); renderHistory();
  $('#clear-saved-confirm').hidden = true;
  $('#storage-status').textContent = 'Saved experiments cleared from this browser.';
  $('#clear-saved').focus();
  toast('Saved experiments cleared.');
});

$('#export').addEventListener('click', () => {
  if (!state.result) return;
  const result = { exportedAt: new Date().toISOString(), ...state.result };
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `booklab-${result.dataset}-${result.config.horizon}s.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});

function renderInspector() {
  if (!state.dataset) return;
  const d = state.dataset, frames = d.frames, sessions = new Set(frames.map(f => f.s)).size;
  const span = frames.reduce((sum, frame, i) => sum + (i && frame.s === frames[i - 1].s ? frame.t - frames[i - 1].t : 0), 0) / 1000;
  $('#dataset-inspector').innerHTML = `<h2>${escape(d.name)}</h2><p>${escape(d.note)}</p><div class="inspector-grid"><div><span>Book observations</span><strong>${count(frames.length)}</strong></div><div><span>Capture sessions</span><strong>${sessions}</strong></div><div><span>Observed duration</span><strong>${span.toFixed(1)}s</strong></div><div><span>Available features</span><strong>6</strong></div></div><h2>Sample construction checks</h2><div class="check-list">${['Monotonic arrival timestamps', 'Two-sided uncrossed books', 'Features confined to past observations', 'Independent session history', 'Positive finite prices and sizes', 'Forward labels censored at breaks'].map(text => `<div class="check-item"><span aria-hidden="true">✓</span>${text}</div>`).join('')}</div><p>These fixtures came through the Python replay pipeline. Browser labels and split checks run again for each experiment. A batch feed cannot prove the absence of every silently missing exchange event.</p><h2>Feature allowlist</h2><div class="table-scroll"><table><thead><tr><th>Feature</th><th>Meaning</th></tr></thead><tbody><tr><td>Spread</td><td>Best ask minus best bid, in basis points</td></tr><tr><td>Top-level imbalance</td><td>(Bid size − ask size) / total size</td></tr><tr><td>Five-level imbalance</td><td>Imbalance across the best five levels</td></tr><tr><td>Microprice offset</td><td>Size-weighted price relative to midpoint</td></tr><tr><td>Trailing returns</td><td>One- and five-second past log returns</td></tr></tbody></table></div>`;
}
async function loadReference() {
  try { const response = await fetch('/data/python-reference.json'); if (!response.ok) throw new Error(); const r = await response.json(); $('#reference-results').innerHTML = `<div class="table-scroll"><table><thead><tr><th>Python reference model</th><th>Macro F1</th><th>Accuracy</th></tr></thead><tbody>${Object.entries(r.heldout).map(([name, score]) => `<tr><td>${escape(name)}</td><td>${score.macro_f1.toFixed(4)}</td><td>${(score.accuracy * 100).toFixed(1)}%</td></tr>`).join('')}</tbody></table></div>`; } catch { $('#reference-results').textContent = 'Reference unavailable. Your local browser experiments still work.'; }
}
$('#guide-open').addEventListener('click', () => $('#guide').showModal());
window.addEventListener('pagehide', () => { pause(); if (state.worker) state.worker.terminate(); });
loadDataset('recorded'); loadReference();
