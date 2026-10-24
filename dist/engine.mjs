export const LABELS = [-1, 0, 1];
export const FEATURE_NAMES = ['Spread', 'Top-level imbalance', 'Five-level imbalance', 'Microprice offset', '1s return', '5s return'];

export function random(seed = 22) {
  let value = seed >>> 0;
  return () => { value += 0x6D2B79F5; let t = value; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export function buildRows(data, config) {
  if (!Number.isFinite(config.horizon) || config.horizon <= 0 || !Number.isFinite(config.deadband) || config.deadband < 0) throw new Error('Choose a positive horizon and a nonnegative deadband.');
  const rows = [], frames = data.frames;
  let future = 0, censored = 0;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (!frame.x) continue;
    future = Math.max(future, i + 1);
    const target = frame.t + config.horizon * 1000;
    while (future < frames.length && frames[future].t < target) future++;
    const next = frames[future];
    if (!next || next.s !== frame.s || next.t - target > 200) { censored++; continue; }
    const change = (next.m / frame.m - 1) * 10000;
    const label = change > config.deadband ? 1 : change < -config.deadband ? -1 : 0;
    const x = frame.x.slice(0, config.features === 'book' ? 4 : 6);
    if (config.leak) x.push(label); // Intentionally invalid teaching mode, always labeled in the UI.
    rows.push({ i, t: frame.t, end: next.t, s: frame.s, y: label, x });
  }
  if (rows.length < 60) throw new Error('Too few labeled observations for this setting. Try a shorter horizon or the synthetic sample.');
  return { rows, censored };
}

export function splitRows(rows, config) {
  if (config.train < 40 || config.train > 75) throw new Error('Training share must be between 40% and 75%.');
  if (config.split === 'random') {
    const shuffled = [...rows], rng = random(22);
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    const a = Math.floor(rows.length * config.train / 100), b = Math.floor(rows.length * .8);
    return { train: shuffled.slice(0, a), validation: shuffled.slice(a, b), test: shuffled.slice(b).sort((a, b) => a.t - b.t), finalTrain: shuffled.slice(0, b), purged: 0, mode: 'Shuffled observations · intentionally invalid', testStart: null };
  }
  const days = [...new Set(rows.map(r => Math.floor(r.t / 86400000)))];
  let validationStart, testStart, mode;
  if (days.length >= 3) {
    const a = Math.min(days.length - 2, Math.max(1, Math.floor(days.length * config.train / 100)));
    const b = Math.min(days.length - 1, Math.max(a + 1, Math.floor(days.length * .8)));
    validationStart = days[a] * 86400000; testStart = days[b] * 86400000; mode = 'Whole UTC days';
  } else {
    validationStart = rows[Math.floor(rows.length * config.train / 100)].t;
    testStart = rows[Math.floor(rows.length * .8)].t; mode = 'Chronological arrival time';
  }
  const train = rows.filter(r => r.t < validationStart && r.end < validationStart);
  const validation = rows.filter(r => r.t >= validationStart && r.t < testStart && r.end < testStart);
  const test = rows.filter(r => r.t >= testStart);
  const finalTrain = rows.filter(r => r.t < testStart && r.end < testStart);
  const purged = rows.filter(r => r.t < validationStart && r.end >= validationStart).length + rows.filter(r => r.t < testStart && r.end >= testStart).length;
  if (!train.length || !validation.length || !test.length) throw new Error('A period became empty after purging. Try a different split.');
  if (Math.max(...train.map(r => r.end)) >= Math.min(...validation.map(r => r.t)) || Math.max(...finalTrain.map(r => r.end)) >= Math.min(...test.map(r => r.t))) throw new Error('Overlapping label endpoints detected.');
  return { train, validation, test, finalTrain, purged, mode, testStart };
}

export function metrics(truth, predictions) {
  const matrix = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  truth.forEach((value, i) => matrix[value + 1][predictions[i] + 1]++);
  const classes = LABELS.map((label, c) => {
    const tp = matrix[c][c], support = matrix[c].reduce((a, b) => a + b, 0), predicted = matrix.reduce((a, row) => a + row[c], 0);
    const precision = predicted ? tp / predicted : 0, recall = support ? tp / support : 0;
    return { label, support, precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0 };
  });
  return { f1: classes.reduce((a, c) => a + c.f1, 0) / 3, accuracy: truth.length ? matrix.reduce((a, row, i) => a + row[i], 0) / truth.length : 0, classes, matrix };
}

export function fit(rows, C = 1, iterations = 150) {
  const dimensions = rows[0].x.length, count = rows.length;
  const mean = Array(dimensions).fill(0), scale = Array(dimensions).fill(0), counts = [0, 0, 0];
  rows.forEach(r => { counts[r.y + 1]++; r.x.forEach((v, j) => mean[j] += v / count); });
  rows.forEach(r => r.x.forEach((v, j) => scale[j] += (v - mean[j]) ** 2 / count));
  scale.forEach((v, j) => scale[j] = Math.sqrt(v) || 1);
  const x = rows.map(r => [...r.x.map((v, j) => (v - mean[j]) / scale[j]), 1]);
  const weights = Array.from({ length: 3 }, () => Array(dimensions + 1).fill(0));
  for (let iteration = 0; iteration < iterations; iteration++) {
    const gradient = weights.map(row => row.map(() => 0));
    for (let i = 0; i < count; i++) {
      const logits = weights.map(w => w.reduce((s, v, j) => s + v * x[i][j], 0));
      const max = Math.max(...logits), exp = logits.map(v => Math.exp(v - max)), total = exp.reduce((a, b) => a + b, 0);
      const y = rows[i].y + 1, balance = count / (3 * Math.max(1, counts[y]));
      for (let c = 0; c < 3; c++) {
        const error = (exp[c] / total - Number(c === y)) * balance / count;
        for (let j = 0; j <= dimensions; j++) gradient[c][j] += error * x[i][j];
      }
    }
    const rate = .25 / (1 + iteration / 100);
    weights.forEach((w, c) => w.forEach((v, j) => w[j] -= rate * (gradient[c][j] + (j < dimensions ? v / (C * count) : 0))));
  }
  return { mean, scale, weights };
}

export function predict(model, row) {
  const x = [...row.x.map((v, j) => (v - model.mean[j]) / model.scale[j]), 1];
  const logits = model.weights.map(w => w.reduce((s, v, j) => s + v * x[j], 0));
  return logits.indexOf(Math.max(...logits)) - 1;
}

function interval(test, predicted, baseline) {
  const grouped = new Map();
  test.forEach((r, i) => { const key = `${r.s}:${Math.floor(r.t / 5000)}`; if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(i); });
  const blocks = [...grouped.values()], rng = random(22), differences = [];
  for (let draw = 0; draw < 100; draw++) {
    const indices = Array.from({ length: blocks.length }, () => blocks[Math.floor(rng() * blocks.length)]).flat();
    const truth = indices.map(i => test[i].y);
    differences.push(metrics(truth, indices.map(i => predicted[i])).f1 - metrics(truth, indices.map(i => baseline[i])).f1);
  }
  differences.sort((a, b) => a - b);
  return { low: differences[2], high: differences[97], blocks: blocks.length, seconds: 5, draws: 100 };
}

export function experiment(data, config, progress = () => {}) {
  const { rows, censored } = buildRows(data, config), split = splitRows(rows, config);
  if (split.train.length < 15 || new Set(split.train.map(r => r.y)).size < 2) throw new Error('Training needs at least two direction classes. Choose another horizon or sample.');
  progress('Fitting validation candidates');
  const candidates = [.1, 1, 10].map(C => {
    const model = fit(split.train, C), predictions = split.validation.map(r => predict(model, r));
    return { C, f1: metrics(split.validation.map(r => r.y), predictions).f1 };
  });
  const best = candidates.reduce((a, b) => b.f1 > a.f1 ? b : a);
  progress('Refitting and evaluating the holdout');
  const final = fit(split.finalTrain, best.C), prediction = split.test.map(r => predict(final, r));
  const counts = LABELS.map(c => split.finalTrain.filter(r => r.y === c).length);
  const majority = LABELS[counts.indexOf(Math.max(...counts))];
  const baseline = split.test.map(() => majority), rule = split.test.map(r => r.x[1] > .1 ? 1 : r.x[1] < -.1 ? -1 : 0), truth = split.test.map(r => r.y);
  const scores = { majority: metrics(truth, baseline), imbalance: metrics(truth, rule), logistic: metrics(truth, prediction) };
  progress('Estimating block uncertainty');
  const uncertainty = interval(split.test, prediction, baseline);
  const coefficients = FEATURE_NAMES.slice(0, config.features === 'book' ? 4 : 6);
  if (config.leak) coefficients.push('Future target · leaked');
  return { config: { ...config }, source: data.source, dataset: data.id, rows: rows.length, censored, selectedC: best.C, candidates,
    split: { train: split.train.length, validation: split.validation.length, test: split.test.length, refit: split.finalTrain.length, purged: split.purged, mode: split.mode, testStart: split.testStart }, scores, uncertainty,
    coefficients: coefficients.map((name, j) => ({ name, weight: final.weights[2][j] - final.weights[0][j] })),
    scalerMean: final.mean, predictions: split.test.map((r, i) => ({ i: r.i, t: r.t, actual: r.y, predicted: prediction[i], majority: baseline[i], imbalance: rule[i] })),
    validProtocol: config.split === 'chronological' && !config.leak,
    implementation: 'Browser softmax logistic regression; balanced classes, training-only standardization, 150 gradient steps, seed 22. Separate from the Python reference estimator.' };
}
