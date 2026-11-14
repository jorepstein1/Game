'use strict';
/* Hearthold — sprites. Original hand-drawn vector art on a 32×32 grid, one entry per sprite.
   Every shape inherits a dark, rounded outline from the wrapping <g>; `N` switches it off for
   highlights and details. The whole set is injected once as hidden <symbol>s, and `sprite(id)`
   returns a small <svg><use> that sizes with the surrounding text (1em), so the same drawing
   serves the map, the build bar, cost lines and the resource row. */

const SPRITE_INK = '#2b2118';
const N = 'stroke="none"';
// Detail lines that run to a shape's edge are drawn first and the shape's outline is drawn again on top,
// so the dark border is never broken or crossed.
const SPRITES = {
  // ── Resources ──
  gold: `<circle cx="16" cy="16" r="11.5" fill="#e8bf3a"/><circle cx="16" cy="16" r="7.5" fill="#f7dd72" stroke="#b08a1c"/>
    <path d="M12.500 18.500l-1-5 3 2.200 1.500-3.200 1.500 3.200 3-2.200-1 5z" fill="#c2951f" stroke="#b08a1c" stroke-width="1"/>`,
  food: `<path d="M3.500 21q0-10.500 12.500-10.500t12.500 10.500v2.500q0 2-2 2h-21q-2 0-2-2z" fill="#d6934a"/>
    <path d="M6.500 17.500q2-4.200 9.500-4.200" stroke="#f0c98a" stroke-width="1.800" fill="none"/>
    <path d="M11 15.500l3 4.500M16.500 15l3 4.500M22 15.800l2.200 3.400" stroke="#8e5722" stroke-width="1.700" fill="none"/>`,
  wood: `<g transform="translate(0 32) scale(1 -1)"><rect x="3.500" y="10.500" width="23" height="11" rx="5.500" fill="#8a5a2b"/>
    <path d="M7 14h9M10 18h8" stroke="#5e3b1a" stroke-width="1.300" fill="none"/>
    <ellipse cx="23.500" cy="16" rx="5" ry="5.500" fill="#e2b877"/>
    <ellipse cx="23.500" cy="16" rx="2.200" ry="2.600" fill="none" stroke="#a8742f" stroke-width="1.200"/>
    <path d="M9 21.500v3.500q0 1.500 1.500 1.500h1q1.500 0 1.500-1.500v-3.500" fill="#8a5a2b"/></g>`,
  stone: `<path d="M3.500 25l2.500-9 7-5.500 9.500 1 6 7.500v6z" fill="#a9a59a"/>
    <path d="M13 10.500l2 7.500-9-2M15 18l7.500-6.500M15 18l5 7M15 18l13.500 1" stroke="#77736a" stroke-width="1.200" fill="none"/>
    <path d="M13.800 12.500l6.800 0.600-4.800 3.800z" fill="#d2cec3" ${N}/>
    <path d="M3.500 25l2.500-9 7-5.500 9.500 1 6 7.500v6z" fill="none"/>`,
  iron: `<path d="M3.500 24l4-10h15l6 10z" fill="#6f7f8f"/><path d="M7.500 14l4-4.500h14l-3 4.500z" fill="#a9b7c4"/>
    <path d="M22.500 14l3-4.500 5 10-2 4.500z" fill="#55647a"/>`,
  pop: `<path d="M14.500 27q0-9 7.500-9t7.500 9z" fill="#a8453a"/><circle cx="22" cy="12.500" r="4.300" fill="#e3b189"/>
    <path d="M2.500 27q0-10 8.500-10t8.500 10z" fill="#4b6ea8"/><circle cx="11" cy="11" r="5" fill="#f0c49a"/>`,
  crown: `<path d="M5 24.500l-2-14 7.500 6 5.500-9.500 5.500 9.500 7.500-6-2 14z" fill="#e8bf3a"/>
    <path d="M5 24.500l-.6-4.200h23.200l-.6 4.200z" fill="#c2951f"/>
    <circle cx="16" cy="22.400" r="1" fill="#b5352c" ${N}/><circle cx="10.500" cy="22.400" r="1" fill="#3f7fb8" ${N}/><circle cx="21.500" cy="22.400" r="1" fill="#3f7fb8" ${N}/>
    <circle cx="3" cy="10" r="1.600" fill="#f7dd72"/><circle cx="16" cy="6.500" r="1.600" fill="#f7dd72"/><circle cx="29" cy="10" r="1.600" fill="#f7dd72"/>`,

  // ── Terrain ──
  forest: `<rect x="9" y="19" width="3" height="8.500" fill="#6b4423"/><path d="M10.500 3l-7 9.500h3l-4.500 7.500h17l-4.500-7.500h3z" fill="#2f6b38"/>
    <path d="M10.500 5.500l-3.500 5.500h3.500z" fill="#4c9a4a" ${N}/>
    <rect x="21" y="23" width="3" height="6" fill="#6b4423"/><path d="M22.500 9l-6 8h2.500l-4 7.500h15l-4-7.500h2.500z" fill="#3b7d3f"/>
    <path d="M22.500 11.500l-3 4.500h3z" fill="#5fae55" ${N}/>`,
  hill: `<path d="M12 27l8.500-15 9.500 15z" fill="#857c6b"/><path d="M20.500 12l-2.300 4 2-.8 1.600 1.600.900-1.300z" fill="#e2dccb" stroke-width="1.300"/>
    <path d="M1.500 27l10.500-20 10.500 20z" fill="#a39a86"/>
    <path d="M12 7l-4.200 8 2.700-1.400 1.800 2.400 2.200-2.600 2 1.800z" fill="#f4efe2"/>`,
  water: `<g fill="none" stroke="#d7edfa" stroke-width="2.200"><path d="M3 10q3.250-3.500 6.500 0t6.500 0 6.500 0 6.500 0"/>
    <path d="M3 23q3.250-3.500 6.500 0t6.500 0 6.500 0 6.500 0"/></g>
    <path d="M6 16.500q3.250-3.500 6.500 0t6.500 0 6.500 0" fill="none" stroke="#3b78a8" stroke-width="2.200"/>`,

  // ── The seat of the realm, by level ──
  hall1: `<path d="M16 9v-6.500" fill="none"/><path d="M16 2.500l6.500 1.800-6.500 2z" fill="#b5352c"/>
    <rect x="5.500" y="17" width="21" height="10.500" fill="#f1e3c0"/>
    <path d="M10 17v10.500M22 17v10.500M5.500 22h4.500M22 22h4.500" stroke="#8a5a2b" stroke-width="1.300" fill="none"/><path d="M5.500 17h21v10.500h-21z" fill="none"/>
    <path d="M2.500 18.500l5.500-9.500h16l5.500 9.500z" fill="#d9a441"/>
    <path d="M10 12.300h12M8.500 15.300h15" stroke="#b07c26" stroke-width="1.200" fill="none"/>
    <path d="M13 27.500v-5.500a3 3 0 0 1 6 0v5.500z" fill="#6b4423"/>`,

  hall2: `<rect x="7" y="4" width="3.200" height="6" fill="#a9a59a"/><rect x="22" y="4" width="3.200" height="6" fill="#a9a59a"/>
    <rect x="4.500" y="16" width="23" height="11.500" fill="#f1e3c0"/>
    <path d="M2.500 16.500l4.500-8.500h18l4.500 8.500z" fill="#55708f"/><path d="M8.500 10.500h15" stroke="#8aa3bf" stroke-width="1.300" fill="none"/>
    <path d="M11 16.500l5-6.500 5 6.500z" fill="#f1e3c0"/><circle cx="16" cy="14" r="1.200" fill="#8fc7e8" stroke-width="1"/>
    <path d="M4.500 21.800h7M20.500 21.800h7M11.500 16.500v11M20.500 16.500v11" stroke="#8a5a2b" stroke-width="1.300" fill="none"/><path d="M4.500 16h23v11.500h-23z" fill="none"/>
    <path d="M13.500 27.500v-5a2.500 2.500 0 0 1 5 0v5z" fill="#6b4423"/>
    <rect x="6.500" y="18" width="3" height="2.600" fill="#8fc7e8" stroke-width="1"/><rect x="22.500" y="18" width="3" height="2.600" fill="#8fc7e8" stroke-width="1"/>
    <rect x="6.500" y="23" width="3" height="2.600" fill="#8fc7e8" stroke-width="1"/><rect x="22.500" y="23" width="3" height="2.600" fill="#8fc7e8" stroke-width="1"/>`,
  hall3: `<path d="M16 6v-5" fill="none"/><path d="M16 1l6 1.700-6 1.800z" fill="#b5352c"/>
    <rect x="9" y="10" width="14" height="15" fill="#b9b4a6"/><path d="M9 10h5v15h-5z" fill="#cfcabd" ${N}/>
    <path d="M7.500 10.500v-5.500h3.400v2.500h3.400v-2.500h3.400v2.500h3.400v-2.500h3.400v5.500z" fill="#b9b4a6"/>
    <path d="M6.500 28v-3.500h19v3.500z" fill="#8f8a7d"/>
    <path d="M13.500 24.500v-4a2.500 2.500 0 0 1 5 0v4z" fill="#3a2a1c"/>
    <path d="M12.500 13v3.500M19.500 13v3.500M16 12.500v3" stroke-width="1.800" fill="none"/>
    <path d="M19.500 19.500h2M10.500 21.500h1.800M18.500 12h2.500" stroke="#8f8a7d" stroke-width="1.100" fill="none"/>`,
  hall4: `<path d="M16 13v-8.500" fill="none"/><path d="M16 4.500l5.500 1.600-5.500 1.700z" fill="#b5352c"/>
    <path d="M10.500 27.500v-14.500h2.500v2h2v-2h2v2h2v-2h2.500v14.500z" fill="#a39e90"/>
    <rect x="2.500" y="10" width="8" height="17.500" fill="#b9b4a6"/><rect x="21.500" y="10" width="8" height="17.500" fill="#b9b4a6"/>
    <path d="M1.500 10.500v-5.500h3.200v2.200h3.600v-2.200h3.200v5.500z" fill="#cfcabd"/><path d="M20.500 10.500v-5.500h3.200v2.200h3.600v-2.200h3.200v5.500z" fill="#cfcabd"/>
    <path d="M12.800 27.500v-5a3.200 3.200 0 0 1 6.400 0v5z" fill="#6b4423"/><path d="M14.900 20v7.500M17.100 20v7.500M13 23.500h6" stroke-width="1" fill="none"/>
    <path d="M6.500 14v3.500M25.500 14v3.500" stroke-width="1.800" fill="none"/>`,
  hall5: `<rect x="8" y="18" width="16" height="9.500" fill="#f6ecd0"/><path d="M8 18.200h16" stroke="#e0b53a" stroke-width="1.600" fill="none"/>
    <rect x="3.500" y="14" width="5.500" height="13.500" fill="#fbf5e2"/><rect x="23" y="14" width="5.500" height="13.500" fill="#fbf5e2"/>
    <path d="M2.200 14.500l4-7.500 4 7.500z" fill="#3f6fb0"/><path d="M21.800 14.500l4-7.500 4 7.500z" fill="#3f6fb0"/>
    <rect x="11.500" y="12" width="9" height="15.500" fill="#fbf5e2"/><path d="M10 12.500l6-9 6 9z" fill="#3f6fb0"/>
    <path d="M16 6l-2.800 4.500h2.800z" fill="#6e9ad6" ${N}/>
    <circle cx="16" cy="2.800" r="1.700" fill="#f2cb45"/><circle cx="6.200" cy="6.500" r="1.300" fill="#f2cb45"/><circle cx="25.800" cy="6.500" r="1.300" fill="#f2cb45"/>
    <path d="M13.500 27.500v-5a2.500 2.500 0 0 1 5 0v5z" fill="#e0b53a"/>
    <path d="M14.500 15h3v3h-3z" fill="#8fc7e8" stroke-width="1"/><path d="M6.200 17.500v3M25.800 17.500v3" stroke-width="1.700" fill="none"/>`,

  // ── Buildings ──
  cottage: `<rect x="20.500" y="6.500" width="3.500" height="7" fill="#a9a59a"/>
    <rect x="6.500" y="16" width="19" height="11.500" fill="#f1e3c0"/>
    <path d="M3 17.500l13-12.500 13 12.500z" fill="#b5452c"/>
    <path d="M9.500 14l6.500-6.300" stroke="#dd7a55" stroke-width="1.600" fill="none"/>
    <rect x="13.500" y="20" width="5" height="7.500" fill="#6b4423"/><rect x="8.500" y="19.500" width="3.200" height="3.200" fill="#8fc7e8" stroke-width="1.100"/>
    <rect x="20.300" y="19.500" width="3.200" height="3.200" fill="#8fc7e8" stroke-width="1.100"/>`,
  lumber: `<path d="M4 19.500v6q0 3.500 12 3.500t12-3.500v-6z" fill="#8a5a2b"/><ellipse cx="16" cy="19.500" rx="12" ry="4.500" fill="#e2b877"/>
    <ellipse cx="16" cy="19.500" rx="7" ry="2.500" fill="none" stroke="#a8742f" stroke-width="1.100"/>
    <path d="M9 25v2.300M22.500 25.300v2M15.500 26v2" stroke="#5e3b1a" stroke-width="1.300" fill="none"/>
    <g transform="translate(11.600 13.300) rotate(-35)"><path d="M0 0h14" stroke-width="4.400" fill="none"/><path d="M0 0h14" stroke="#b07a3e" stroke-width="2" fill="none"/>
    <path d="M-1.700-1.800h3.600v3.500q0 3 2 5.300-3.800 1.300-7.600 0 2-2.300 2-5.300z" fill="#a9b7c4"/><path d="M-2.300 6.300q2.400.600 4.800 0" stroke="#e6edf2" stroke-width="1.200" fill="none"/></g>`,
  farm: `<g fill="#e8bf3a"><ellipse cx="16" cy="9.500" rx="3" ry="6.500" transform="rotate(-32 16 20)"/>
    <ellipse cx="16" cy="9.500" rx="3" ry="6.500" transform="rotate(32 16 20)"/><ellipse cx="16" cy="8.500" rx="3" ry="6.500"/></g>
    <path d="M16 4.500v8M13.800 7l2.200 2 2.200-2M13.800 10l2.200 2 2.200-2" stroke="#b08a1c" stroke-width="1.100" fill="none"/>
    <path d="M13.500 19l-4 9.500h13l-4-9.500z" fill="#d9a441"/><path d="M14 23l-1.500 5.500M18 23l1.500 5.500M16 22v6.500" stroke="#b07c26" stroke-width="1.100" fill="none"/><path d="M13.500 19l-4 9.500h13l-4-9.500z" fill="none"/>
    <rect x="12.500" y="17.500" width="7" height="3" rx="1" fill="#b5352c"/>`,
  quarry: `<path d="M3 27.500l2-8 6.500-4.500 9 .500 7 5 1.500 7z" fill="#a9a59a"/>
    <path d="M11.500 15l1.500 6-8-1.500M13 21l7.500-5.500M13 21l3.500 6.500M13 21l14.500-.500" stroke="#77736a" stroke-width="1.200" fill="none"/>
    <path d="M12.800 16.300l6 .400-5 3.400z" fill="#d2cec3" ${N}/><path d="M3 27.500l2-8 6.500-4.500 9 .500 7 5 1.500 7z" fill="none"/>
    <path d="M25 5.500l-10.500 12" stroke-width="4.400" fill="none"/><path d="M25 5.500l-10.500 12" stroke="#b07a3e" stroke-width="2" fill="none"/>
    <path d="M15 4.500q8-2.500 14.500 5.500l-2 1.500q-5.500-5.500-12-4.500z" fill="#a9b7c4"/>`,

  market: `<rect x="5.500" y="13" width="2.200" height="14.500" fill="#8a5a2b"/><rect x="24.300" y="13" width="2.200" height="14.500" fill="#8a5a2b"/>
    <rect x="4" y="20.500" width="24" height="7" fill="#b07a3e"/><path d="M4 23.800h24" stroke="#8a5a2b" stroke-width="1.100" fill="none"/><path d="M4 20.500h24v7h-24z" fill="none"/>
    <circle cx="10.500" cy="18.800" r="2.200" fill="#c9413a"/><circle cx="15" cy="18.800" r="2.200" fill="#e8bf3a"/><circle cx="19.500" cy="18.800" r="2.200" fill="#6aa84f"/>
    <path d="M3 14l3-8h20l3 8z" fill="#f6ecd0"/><path d="M6 6h4l-1.800 8h-5.200zM14 6h4l.800 8h-5.600zM22 6h4l3 8h-5.200z" fill="#c9413a" ${N}/>
    <path d="M3 14l3-8h20l3 8z" fill="none"/>`,
  mill: `<path d="M10.500 28.500l2.500-15h6l2.500 15z" fill="#f1e3c0"/><path d="M12 14.500q4-7.500 8 0z" fill="#b5452c"/>
    <path d="M14.200 28.500v-4.200a1.800 1.800 0 0 1 3.600 0v4.200z" fill="#6b4423"/>
    <g fill="#f6ecd0">${[45, 135, 225, 315].map(a => `<path d="M14 8.500v-8h4v8z" transform="rotate(${a} 16 11.500)"/>`).join('')}</g>
    <g stroke="#9a8560" stroke-width="1" fill="none">${[45, 135, 225, 315].map(a => `<path d="M16 1.500v6.500M14.500 4.500h3" transform="rotate(${a} 16 11.500)"/>`).join('')}</g>
    <circle cx="16" cy="11.500" r="2.200" fill="#8a5a2b"/>`,
  tavern: `<path d="M21 14.500h3q3.500 0 3.500 3.500v2q0 3.500-3.500 3.500h-3" stroke-width="5" fill="none"/>
    <path d="M21 14.500h3q3.500 0 3.500 3.500v2q0 3.500-3.500 3.500h-3" stroke="#b07a3e" stroke-width="2.200" fill="none"/>
    <path d="M7 11h15l-1 15.500q0 1.500-1.500 1.500h-10q-1.500 0-1.500-1.500z" fill="#b07a3e"/>
    <path d="M12 13v14.500M17 13v14.500" stroke="#8a5a2b" stroke-width="1.100" fill="none"/>
    <path d="M7.300 16h14.400M7.800 23.500h13.400" stroke="#55647a" stroke-width="2" stroke-linecap="butt" fill="none"/><path d="M7 11h15l-1 15.500q0 1.500-1.500 1.500h-10q-1.500 0-1.500-1.500z" fill="none"/>
    <path d="M7.500 12.500q-3-.500-2-3.500.800-2.500 3.500-2 1-3.500 5-2.500 3-2.500 5.500.500 4-.500 4 3 0 3.500-3 4-1.500 2-3.500.500-2 1.500-4 0-2.500 1.500-5.500 0z" fill="#fff7e0"/>`,
  mine: `<path d="M2 27.500q1-12.500 8-17.500 6-4 12 0 7 5 8 17.500z" fill="#857c6b"/>
    <path d="M6.500 20q1.500-6 5.500-8.500" stroke="#a39a86" stroke-width="1.600" fill="none"/>
    <path d="M22.500 11.500l1.500 1.800-1.500 1.800-1.500-1.800zM26.500 19l1.200 1.500-1.200 1.500-1.200-1.500zM6 23l1.200 1.500-1.200 1.500-1.200-1.500z" fill="#bcd3e6" stroke-width=".9"/>
    <path d="M11 27.500v-9.500h10v9.500z" fill="#2b2118"/>
    <path d="M10 27.500v-10.500M22 27.500v-10.500M8.500 17h15" stroke-width="4.200" fill="none"/>
    <path d="M10 27.500v-10.500M22 27.500v-10.500M8.500 17h15" stroke="#b07a3e" stroke-width="2" fill="none"/>
    <path d="M14 27.500l1-5M18 27.500l-1-5" stroke="#8f9dab" stroke-width="1.200" fill="none"/>`,
  smith: `<path d="M3.500 15h18q3.500 0 7-2v3.500q-3.500 3.500-8.500 4v2.500l3.500 3v2.500h-15v-2.500l3.500-3v-2.500q-6-.500-8.500-5.500z" fill="#55647a"/>
    <path d="M5 16.500h16q3 0 5.500-1.200" stroke="#a9b7c4" stroke-width="1.300" fill="none"/>
    <g transform="translate(9.500 9.200) rotate(-30)"><path d="M0 0h13" stroke-width="4.400" fill="none"/><path d="M0 0h13" stroke="#b07a3e" stroke-width="2" fill="none"/>
    <rect x="-2.800" y="-3.800" width="5.600" height="8.800" rx="1" fill="#8f9dab"/><path d="M-1.300 3.500h2.600" stroke="#d5dde4" stroke-width="1.200" fill="none"/></g>
    <path d="M16 12.500l3-1.500M5.500 13l-2.800-1.200M4 8.500l-1.800-2" stroke="#f2a53a" stroke-width="1.500" fill="none"/>`,
  church: `<rect x="4.500" y="18.500" width="23" height="9" fill="#f1e3c0"/><path d="M3 19l3-5.500h20l3 5.500z" fill="#55708f"/>
    <rect x="12" y="10" width="8" height="17.500" fill="#fbf5e2"/><path d="M10.800 10.500l5.200-6.500 5.200 6.500z" fill="#55708f"/>
    <path d="M16 4.500v-4M14.200 1.800h3.600" stroke-width="1.500" fill="none"/>
    <circle cx="16" cy="14.500" r="2.200" fill="#8fc7e8" stroke-width="1.100"/>
    <path d="M14 27.500v-5a2 2 0 0 1 4 0v5z" fill="#6b4423"/>
    <path d="M7.500 22v3M24.500 22v3" stroke-width="1.800" fill="none"/>`,
  guild: `<path d="M5 27.500v-13.500h3.200v-3.500h3.200v-3.500h3v-3h3.200v3h3v3.500h3.200v3.500h3.200v13.500z" fill="#e3c48f"/>
    <path d="M5 16.500h22" stroke="#b08a52" stroke-width="1.200" fill="none"/><path d="M5 27.500v-13.500h3.200v-3.500h3.200v-3.500h3v-3h3.200v3h3v3.500h3.200v3.500h3.200v13.500z" fill="none"/>
    <circle cx="16" cy="11.500" r="3" fill="#e8bf3a"/><circle cx="16" cy="11.500" r="1" fill="#b08a1c" ${N}/>
    <path d="M13.300 27.500v-5.500a2.700 2.700 0 0 1 5.400 0v5.500z" fill="#6b4423"/>
    <path d="M7.500 18.500h3.500v6.500l-1.750-1.600-1.750 1.600z" fill="#3f6fb0" stroke-width="1.100"/><path d="M21 18.500h3.500v6.500l-1.750-1.600-1.750 1.600z" fill="#b5352c" stroke-width="1.100"/>`,

  // ── Interface ──
  build: `<path d="M19 13l-13.500 14" stroke-width="5" fill="none"/><path d="M19 13l-13.500 14" stroke="#b07a3e" stroke-width="2.600" fill="none"/>
    <path d="M13.500 6.500l5-3.500 10 10-5 3.500z" fill="#8f9dab"/><path d="M15.800 6.800l3-2 7.800 7.800" stroke="#d5dde4" stroke-width="1.300" fill="none"/>`,
  research: `<path d="M3 8q7-2.500 13 1 6-3.500 13-1v16.500q-7-2.500-13 1-6-3.500-13-1z" fill="#f6ecd0"/>
    <path d="M16 9v16.500" fill="none"/><path d="M6 12q4-1 7 .500M6 16q4-1 7 .500M6 20q4-1 7 .500M19 12.500q3-1.500 7-.500M19 16.500q3-1.500 7-.500" stroke="#9a8560" stroke-width="1.200" fill="none"/>
    <path d="M21 19v8.500l2-1.800 2 1.800v-8.500z" fill="#b5352c" stroke-width="1.200"/>`,
  decrees: `<path d="M8 6h17v17q0 4-4 4h-13z" fill="#f6ecd0"/><path d="M8 6q-4 0-4 3.500h4z" fill="#d9c595"/>
    <path d="M12 11h9M12 14.500h9M12 18h5" stroke="#9a8560" stroke-width="1.300" fill="none"/>
    <path d="M8 27q4 0 4-4h13q0 4-4 4z" fill="#d9c595"/><circle cx="21.500" cy="20" r="3.800" fill="#b5352c"/><circle cx="21.500" cy="20" r="1.300" fill="#e0685c" ${N}/>`,
  merchant: `<path d="M4.500 19.500v-5q0-9 11.500-9t11.500 9v5z" fill="#f6ecd0"/>
    <path d="M10.500 6.500q-2 5-2 13M16 5.500v14M21.500 6.500q2 5 2 13" stroke="#b9a273" stroke-width="1.200" fill="none"/><path d="M4.500 19.500v-5q0-9 11.500-9t11.500 9v5z" fill="none"/>
    <rect x="3.500" y="19" width="25" height="4.500" rx="1" fill="#8a5a2b"/>
    <circle cx="9.500" cy="25" r="4.200" fill="#b07a3e"/><circle cx="9.500" cy="25" r="1.300" fill="#5e3b1a" ${N}/>
    <circle cx="22.500" cy="25" r="4.200" fill="#b07a3e"/><circle cx="22.500" cy="25" r="1.300" fill="#5e3b1a" ${N}/>`,
  festival: `<path d="M16 8v-6" fill="none"/><path d="M16 2l5.500 1.600-5.500 1.700z" fill="#e8bf3a"/>
    <rect x="5" y="18" width="22" height="9.500" fill="#f6ecd0"/><path d="M5 18h4v9.500h-4zM23 18h4v9.500h-4z" fill="#c9413a" ${N}/>
    <rect x="5" y="18" width="22" height="9.500" fill="none"/>
    <path d="M12.500 27.500q3.500-4 3.500-9 0 5 3.500 9z" fill="#3a2a1c"/>
    <path d="M3 18.500l13-11 13 11z" fill="#c9413a"/><path d="M16 7.500l-3 11h6z" fill="#f6ecd0" ${N}/><path d="M16 7.500l-9.500 11h-3.500zM16 7.500l9.500 11h3.500z" fill="#f6ecd0" ${N}/>
    <path d="M3 18.500l13-11 13 11z" fill="none"/>`,
  lock: `<path d="M10.500 15v-4.500a5.500 5.500 0 0 1 11 0v4.500" stroke-width="5" fill="none"/>
    <path d="M10.500 15v-4.500a5.500 5.500 0 0 1 11 0v4.500" stroke="#a9b7c4" stroke-width="2.200" fill="none"/>
    <rect x="6.500" y="14.500" width="19" height="13.500" rx="2.500" fill="#c2951f"/>
    <path d="M16 19v4.500" stroke-width="2.200" fill="none"/><circle cx="16" cy="19.500" r="2" fill="#2b2118" ${N}/>`,
  map: `<path d="M3.500 8.500l8-3 9 3 8-3v18l-8 3-9-3-8 3z" fill="#f6ecd0"/>
    <path d="M3.500 8.500l8-3v18l-8 3z" fill="#e3d3a6" ${N}/><path d="M20.500 8.500l8-3v18l-8 3z" fill="#e3d3a6" ${N}/>
    <path d="M11.500 5.500v18M20.500 8.500v18" stroke="#b9a273" stroke-width="1.100" fill="none"/>
    <path d="M6.500 20q3-5 7-3.500t5-3" stroke="#8a5a2b" stroke-width="1.400" stroke-dasharray="1.600 2.400" fill="none"/>
    <path d="M22 11l4 4M26 11l-4 4" stroke="#b5352c" stroke-width="1.900" fill="none"/>
    <path d="M3.500 8.500l8-3 9 3 8-3v18l-8 3-9-3-8 3z" fill="none"/>`,
  repeat: `<path d="M5.500 17l10.500-10.500 10.500 10.500-3.500 3.500-7-7-7 7z" fill="#5fae55"/>
    <path d="M5.500 25l10.500-10.500 10.500 10.500-3.500 3.500-7-7-7 7z" fill="#3b7d3f"/>`,
  demolish: `<path d="M4.500 27.500v-13l4-2.500 2.500 3.500 3.500-5 2.500 5.500 3-1.500.500 6 3.500 1 1.500 3 2.500.500v2.500z" fill="#c98a5a"/>
    <path d="M4.500 18.500h17M4.500 23h20.500M9 13v5.500M15 13v5.500M12 18.500v4.500M18.500 18.500v4.500M8.500 23v4.500M15.500 23v4.500M22 23v4.500" stroke="#8e5a34" stroke-width="1.100" fill="none"/><path d="M4.500 27.500v-13l4-2.500 2.500 3.500 3.500-5 2.500 5.500 3-1.500.500 6 3.500 1 1.500 3 2.500.500v2.500z" fill="none"/>
    <path d="M23 8l3 1-1 3-3-1zM26.500 15.500l2.500 1-1 2.500-2.500-1zM19.500 3.500l2 .500-.500 2-2-.500z" fill="#c98a5a" stroke-width="1.200"/>`,
  warn: `<path d="M16 4l13 23h-26z" fill="#f2cb45"/><path d="M16 12.500v7" stroke-width="2.800" fill="none"/><circle cx="16" cy="23" r="1.600" fill="#2b2118" ${N}/>`,
};
SPRITES.realm = SPRITES.crown;

// With a label the sprite is announced as an image of that name; without one it is decoration.
const sprite = (id, label) => `<svg class="sp" viewBox="0 0 32 32" ${label ? `role="img" aria-label="${String(label).replace(/[&<>"]/g, c => '&#' + c.charCodeAt(0) + ';')}"` : 'aria-hidden="true"'}><use href="#sp-${id}"/></svg>`;

if (typeof document !== 'undefined') {
  const sheet = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  sheet.setAttribute('aria-hidden', 'true'); sheet.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  sheet.innerHTML = Object.keys(SPRITES).map(id =>
    `<symbol id="sp-${id}" viewBox="0 0 32 32"><g stroke="${SPRITE_INK}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${SPRITES[id]}</g></symbol>`).join('');
  document.body.insertBefore(sheet, document.body.firstChild);
}

// The data tables keep plain-text icons (sim.js also runs without a DOM); in the browser each one
// that has a drawing is swapped for its sprite, so every `.icon` read by ui.js is markup.
if (typeof document !== 'undefined') {
  // Resources are labelled (a cost reads "50 Gold"); the rest always sit beside their own name.
  const dress = (table, key, named) => { for (const k in table) { const id = key ? key(k) : k; if (SPRITES[id]) table[k].icon = sprite(id, named && table[k].name); } };
  dress(RESOURCES, null, true); dress(TERRAIN); dress(BUILDINGS); dress(HALL_TIERS, i => 'hall' + (+i + 1));
}
