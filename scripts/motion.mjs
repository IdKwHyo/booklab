import { animate } from 'motion';
import { resolveScreen } from '../dist/routes.mjs';

const reducedPreference = matchMedia('(prefers-reduced-motion: reduce)');
const welcome = document.querySelector('.hero-frame');
const workspace = document.querySelector('.workspace');
let requested = false, transition = null, serial = 0, committing = false;
try { requested = localStorage.getItem('booklab-reduced-motion') === 'true'; } catch {}
const reduced = () => reducedPreference.matches || requested;

function applyMotionPreference() {
  document.body.classList.toggle('motion-reduced', reduced());
  document.querySelectorAll('#motion-toggle, [data-motion-toggle]').forEach(button => {
    button.textContent = reducedPreference.matches ? 'Reduced motion · system' : reduced() ? 'Restore motion' : 'Reduce motion';
    button.disabled = reducedPreference.matches;
    button.title = reducedPreference.matches ? 'Follows your device’s accessibility setting.' : '';
    button.setAttribute('aria-pressed', String(reduced()));
  });
  if (reduced() && transition) {
    const destination = transition.destination;
    cancelTransition();
    commit(destination);
  }
}
function cancelTransition() {
  serial++;
  if (!transition) return;
  for (const animation of transition.animations) animation.cancel();
  transition.overlay.remove();
  workspace.style.opacity = '';
  workspace.style.transform = '';
  transition = null;
}
function commit(destination) {
  committing = true;
  history.pushState(null, '', destination);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  committing = false;
}
async function enter(destination) {
  cancelTransition();
  if (reduced()) { commit(destination); return; }
  const token = serial;
  const rect = welcome.getBoundingClientRect();
  const overlay = document.createElement('div');
  overlay.className = 'entry-veil';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.inert = true;
  const scene = welcome.cloneNode(true);
  scene.className = 'entry-cinema';
  scene.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
  Object.assign(scene.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  overlay.append(scene);
  document.body.append(overlay);
  const animations = [];
  transition = { overlay, animations, destination };
  const play = (element, keyframes, options) => {
    const animation = animate(element, keyframes, options);
    animations.push(animation);
    return animation;
  };
  try {
    play(scene.querySelector('.hero-visual'), { scale: [1, 1.72] }, { duration: 1.05, ease: [.22, .58, .22, 1] });
    const titles = [scene.querySelector('.hero-copy'), scene.querySelector('.hero-caption'), scene.querySelector('.motion-toggle')];
    await play(titles, { opacity: [1, 0], y: [0, -12] }, { duration: .22, ease: 'easeOut' }).finished;
    if (token !== serial) return;
    commit(destination);
    play(workspace, { opacity: [.1, 1], y: [14, 0] }, { duration: .55, delay: .15, type: 'spring', bounce: 0 });
    await play(overlay, { opacity: [1, 0] }, { duration: .48, delay: .3, ease: 'easeInOut' }).finished;
  } finally {
    if (token === serial) cancelTransition();
  }
}

document.addEventListener('click', event => {
  const toggle = event.target.closest('#motion-toggle, [data-motion-toggle]');
  if (toggle) {
    requested = !requested;
    try { localStorage.setItem('booklab-reduced-motion', String(requested)); } catch {}
    applyMotionPreference();
    return;
  }
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest('a[href^="#"]');
  if (!link) return;
  const destination = link.getAttribute('href');
  if (transition) {
    event.preventDefault();
    cancelTransition();
    commit(destination);
    return;
  }
  if (document.body.dataset.screen !== 'welcome') return;
  if (resolveScreen(destination) === 'welcome') return;
  event.preventDefault();
  enter(destination).catch(() => { cancelTransition(); commit(destination); });
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && transition) cancelTransition();
  if (event.key !== 'Enter' || event.defaultPrevented || document.body.dataset.screen !== 'welcome' || document.querySelector('dialog[open]')) return;
  if (!['BODY', 'H1'].includes(event.target.tagName)) return;
  event.preventDefault();
  document.querySelector('#enter-lab').click();
});
window.addEventListener('booklab:view', event => {
  if (committing) return;
  cancelTransition();
  if (event.detail.view === 'welcome' || reduced()) return;
  const heading = document.querySelector('[data-view]:not([hidden]) .page-heading');
  animate(heading, { opacity: [.65, 1], y: [8, 0] }, { duration: .3, ease: 'easeOut' });
});
window.addEventListener('booklab:dialog', event => {
  animate(event.detail.dialog, reduced() ? { opacity: [.7, 1] } : { opacity: [.4, 1], y: [10, 0] }, { duration: reduced() ? .1 : .22, ease: 'easeOut' });
});
reducedPreference.addEventListener('change', applyMotionPreference);
window.addEventListener('pagehide', cancelTransition);
applyMotionPreference();
