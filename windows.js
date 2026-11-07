let zCounter = 100;
let activeWin = null;

// same as stacked layout mobile breakpoint in w95.css
const MOBILE_MQ = window.matchMedia('(max-width: 880px), (max-height: 500px)');

function openWindow(id, scroll = true) {
  const win = document.getElementById(id);
  win.classList.add('visible');
  bringToFront(win);
  // on mobile a reopened window may be off-screen
  if (scroll && MOBILE_MQ.matches) win.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeWindow(id) {
  const win = document.getElementById(id);
  win.classList.remove('visible');
}

function bringToFront(win) {
  if (activeWin) activeWin.classList.remove('active');
  zCounter++;
  win.style.zIndex = zCounter;
  win.classList.add('active');
  activeWin = win;
}

document.addEventListener('pointerdown', (e) => {
  const win = e.target.closest('.window');
  if (win) bringToFront(win);
});

let dragging = null, dragOffX = 0, dragOffY = 0;

document.addEventListener('pointerdown', (e) => {
  if (MOBILE_MQ.matches) return; // windows are stacked, not draggable
  const titleBar = e.target.closest('.title-bar');
  if (!titleBar || e.target.classList.contains('win-btn')) return;
  const win = document.getElementById(titleBar.dataset.win);
  if (!win) return;
  dragging = win;
  const r = win.getBoundingClientRect();
  dragOffX = e.clientX - r.left;
  dragOffY = e.clientY - r.top;
  e.preventDefault();
});

document.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  dragging.style.left = (e.clientX - dragOffX) + 'px';
  dragging.style.top = Math.max(0, e.clientY - dragOffY) + 'px';
});

document.addEventListener('pointerup', () => { dragging = null; });
document.addEventListener('pointercancel', () => { dragging = null; });

function showSentDialog() { openWindow('sent-dialog'); }

window.onload = () => {
  openWindow('about-win', false);
  openWindow('skills-win', false);
  openWindow('contact-win', false);
  openWindow('sites-win', false);
  openWindow('sand-win', false);
};
