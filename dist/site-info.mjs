const storage = document.querySelector('#storage');
const confirmation = document.querySelector('#clear-saved-confirm');

document.addEventListener('click', event => {
  const trigger = event.target.closest('[data-dialog]');
  if (!trigger) return;
  const dialog = document.getElementById(trigger.dataset.dialog);
  if (dialog === storage) {
    confirmation.hidden = true;
    const count = Number(document.querySelector('#saved-count').textContent);
    document.querySelector('#storage-status').textContent = `${count} saved experiment${count === 1 ? '' : 's'} in this browser.`;
  }
  dialog.showModal();
  window.dispatchEvent(new CustomEvent('booklab:dialog', { detail: { dialog } }));
});

document.querySelector('#manage-saved').addEventListener('click', () => {
  storage.close();
  location.hash = 'experiments';
});
document.querySelector('#clear-saved').addEventListener('click', () => {
  confirmation.hidden = false;
  document.querySelector('#cancel-clear-saved').focus();
});
document.querySelector('#cancel-clear-saved').addEventListener('click', () => {
  confirmation.hidden = true;
  document.querySelector('#clear-saved').focus();
});
document.querySelector('.research-checks').addEventListener('change', event => {
  const checked = event.currentTarget.querySelectorAll('input:checked').length;
  document.querySelector('#checklist-status').textContent = `${checked} of 4 noted · resets when this page reloads.`;
});

document.addEventListener('keydown', event => {
  const dialog = document.querySelector('dialog[open]');
  if (!dialog || event.key !== 'Tab') return;
  const controls = [...dialog.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')]
    .filter(element => element.getClientRects().length);
  const first = controls[0], last = controls.at(-1);
  const focused = document.activeElement;
  if (event.shiftKey && (focused === first || !dialog.contains(focused))) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && (focused === last || !dialog.contains(focused))) {
    event.preventDefault(); first.focus();
  }
});
