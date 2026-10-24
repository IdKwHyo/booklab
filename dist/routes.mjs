const pages = new Set(['welcome', 'workbench', 'experiments', 'dataset', 'method']);

export function resolveScreen(hash = '') {
  const route = hash.replace(/^#/, '');
  if (route === 'lab' || route === 'main') return 'workbench';
  if (route === 'study') return 'method';
  if (route === 'top' || !pages.has(route)) return 'welcome';
  return route;
}
