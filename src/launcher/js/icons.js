/**
 * Selbst gezeichnete Icons im einheitlichen Low-Poly/Flat-Stil (24×24, flache Flächen, keine Verläufe).
 * Farben über CSS: Primärfläche = currentColor, Sekundärfläche = var(--icon-2).
 */
const wrap = (body) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export const icons = {
  logo: `<svg class="logo" viewBox="0 0 64 64" aria-hidden="true">
    <polygon points="32,2 58,17 58,47 32,62 6,47 6,17" fill="#212936"/>
    <polygon points="32,6 54,19 54,45 32,58 10,45 10,19" fill="#2c3848"/>
    <polygon points="16,46 46,39 48,43 18,50" fill="#7a4e2e"/><polygon points="18,39 48,46 46,50 16,43" fill="#96623a"/>
    <polygon points="19,42 32,11 45,42" fill="#e85934"/><polygon points="23,42 28,22 36,42" fill="#f68c32"/>
    <polygon points="29,42 38,19 42,42" fill="#f68c32"/><polygon points="27,42 33,27 38,42" fill="#ffd25a"/></svg>`,
  library: wrap('<polygon points="3,4 8,4 8,20 3,20" fill="currentColor"/><polygon points="10,4 15,4 15,20 10,20" fill="var(--icon-2)"/><polygon points="16.5,5 21,3.8 24,19 19.5,20.2" fill="currentColor" transform="translate(-2.5 0)"/>'),
  party: wrap('<circle cx="8" cy="8" r="3.5" fill="currentColor"/><polygon points="2,20 4,13 12,13 14,20" fill="currentColor"/><circle cx="17" cy="9" r="3" fill="var(--icon-2)"/><polygon points="13,20 14.5,14 20.5,14 22,20" fill="var(--icon-2)"/>'),
  settings: wrap('<polygon points="12,1 15,4 19,3.5 19.5,8 23,11 20.5,14 21,18.5 16.5,19 13,23 10,20 5.5,20.5 5,16 1,13 3.5,10 3,5.5 7.5,5" fill="currentColor"/><polygon points="12,8 15.5,10 15.5,14 12,16 8.5,14 8.5,10" fill="var(--icon-2)"/>'),
  user: wrap('<polygon points="12,2 16,5 16,10 12,13 8,10 8,5" fill="currentColor"/><polygon points="3,22 6,15 18,15 21,22" fill="var(--icon-2)"/>'),
  single: wrap('<polygon points="12,2 16,5 16,9.5 12,12.5 8,9.5 8,5" fill="currentColor"/><polygon points="4,22 6.5,14.5 17.5,14.5 20,22" fill="var(--icon-2)"/>'),
  multi: wrap('<polygon points="8,3 11,5 11,9 8,11 5,9 5,5" fill="currentColor"/><polygon points="1,21 3,13 13,13 15,21" fill="currentColor"/><polygon points="16,4 19,6 19,10 16,12 13,10 13,6" fill="var(--icon-2)"/><polygon points="14,21 15,14 21,14 23,21" fill="var(--icon-2)"/>'),
  join: wrap('<polygon points="13,3 21,3 21,21 13,21 13,18 18,18 18,6 13,6" fill="var(--icon-2)"/><polygon points="3,10 10,10 10,6 16,12 10,18 10,14 3,14" fill="currentColor"/>'),
  copy: wrap('<polygon points="8,7 20,7 20,22 8,22" fill="currentColor"/><polygon points="4,2 16,2 16,5 6,5 6,18 4,18" fill="var(--icon-2)"/>'),
  crown: wrap('<polygon points="2,7 7,12 12,4 17,12 22,7 20,19 4,19" fill="currentColor"/><polygon points="4,20 20,20 20,22 4,22" fill="var(--icon-2)"/>'),
  check: wrap('<polygon points="2,12 5,9 10,14 19,4 22,7 10,20" fill="currentColor"/>'),
  cross: wrap('<polygon points="4,7 7,4 12,9 17,4 20,7 15,12 20,17 17,20 12,15 7,20 4,17 9,12" fill="currentColor"/>'),
  cpu: wrap('<polygon points="6,6 18,6 18,18 6,18" fill="currentColor"/><polygon points="9,9 15,9 15,15 9,15" fill="var(--icon-2)"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" stroke="currentColor" stroke-width="2"/>'),
  folder: wrap('<polygon points="2,5 9,5 11,7 22,7 22,20 2,20" fill="var(--icon-2)"/><polygon points="2,10 22,10 22,20 2,20" fill="currentColor"/>'),
  refresh: wrap('<path d="M20 12a8 8 0 1 1-2.3-5.6" fill="none" stroke="currentColor" stroke-width="3"/><polygon points="14,2 22,3 21,11" fill="var(--icon-2)"/>'),
  speaker: wrap('<polygon points="2,9 7,9 13,4 13,20 7,15 2,15" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="var(--icon-2)" stroke-width="2"/>'),
  play: wrap('<polygon points="6,3 21,12 6,21" fill="currentColor"/><polygon points="6,3 12,12 6,21" fill="var(--icon-2)"/>'),
  exit: wrap('<polygon points="3,3 13,3 13,6 6,6 6,18 13,18 13,21 3,21" fill="var(--icon-2)"/><polygon points="22,12 15,6 15,10 9,10 9,14 15,14 15,18" fill="currentColor"/>'),
  gamepad: wrap('<polygon points="3,9 7,6 17,6 21,9 23,18 19,20 15,16 9,16 5,20 1,18" fill="currentColor"/><polygon points="6,10 8,10 8,8.5 9.5,8.5 9.5,10 11,10 11,11.5 9.5,11.5 9.5,13 8,13 8,11.5 6,11.5" fill="var(--icon-2)"/>'),
  plus: wrap('<polygon points="10,3 14,3 14,10 21,10 21,14 14,14 14,21 10,21 10,14 3,14 3,10 10,10" fill="currentColor"/>'),
};
