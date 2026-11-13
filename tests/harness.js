'use strict';
// Loads data.js + sim.js into a fresh vm context with no DOM, and returns an object exposing every
// top-level binding of the game (live getters, so `sim.state` always reads the current state).
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');

// `patch` replaces top-level numeric constants for what-if runs, e.g. loadSim({ CROWN_BONUS: 0.1 }).
function loadSim(patch) {
  const ctx = vm.createContext({ console, btoa, atob });
  let names = [];
  for (const f of ['data.js', 'sim.js']) {
    let src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const k in patch || {}) src = src.replace(new RegExp('^const ' + k + ' = [^;,]+', 'm'), 'const ' + k + ' = ' + patch[k]);
    vm.runInContext(src, ctx, { filename: f });
    names = names.concat([...src.matchAll(/^(?:const|let|function)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));
    names = names.concat([...src.matchAll(/^const\s+[A-Za-z_$][\w$]*\s*=[^;\n]*?,\s*([A-Z_]+)\s*=/gm)].map(m => m[1])); // `const A = 1, B = 2;`
    names = names.concat([...src.matchAll(/^let\s+([\w$]+),\s*([\w$]+);/gm)].flatMap(m => [m[1], m[2]]));
  }
  names = [...new Set(names)];
  const sim = vm.runInContext('({' + names.map(n => `get ${n}() { return ${n}; }`).join(',') +
    ', setState(s) { state = s; calc = compute(); }, eval(code) { return eval(code); } })', ctx);
  return sim;
}
module.exports = { loadSim, ROOT };
