const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const nodes = new Map();
const node = () => ({
  value: '', checked: false, style: {}, dataset: {}, children: [],
  classList: { add() {} },
  addEventListener() {},
  set innerHTML(value) { this.children = []; },
  appendChild(child) { this.children.push(child); },
  setAttribute(key, value) { this[key] = value; }
});
const element = id => {
  if (!nodes.has(id)) nodes.set(id, node());
  return nodes.get(id);
};
const context = vm.createContext({
  console, TextEncoder, Blob,
  document: {createElement: node, getElementById: element, querySelectorAll: () => []},
  window: {addEventListener() {}}
});
const html = fs.readFileSync(new URL('../index.html', `file://${__filename}`), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
vm.runInContext(script.slice(0, script.indexOf('// init')), context);
const run = code => vm.runInContext(code, context);
const rows = () => element('heatTable').children;
const mark = level => ({ao: 'U', level});

context.paperQuestions = [
  {qNum: 1, qMarks: 1, desc: 'One difficult mark', marks: [mark(3)]},
  {qNum: 2, qMarks: 9, desc: 'Nine easier marks', marks: Array.from({length:9}, () => mark(1))},
  {qNum: 3, qMarks: 5, desc: 'Not tagged yet', marks: []}
];
run('state.questions = paperQuestions; state.paper.totalMarks = 20; renderHeatTable()');
assert.deepEqual(rows()[0].children.map(cell => cell.textContent), ['Q#', 'Brief Description', 'AO Type and Level', 'Difficulty']);
assert.equal(rows()[1].children.at(-1).textContent, '3.00');
assert.equal(rows()[2].children.at(-1).textContent, '1.00');
assert.equal(rows()[3].children.at(-1).textContent, '—');
assert.equal(rows().at(-1).children[0].textContent, 'Paper average difficulty per mark (10/20 marks tagged)');
assert.equal(rows().at(-1).children.at(-1).textContent, '1.20', 'Paper average weights every mark, not every question; unknown marks are excluded');
assert.equal(run('averageMarkLevel(state.questions[0])'), 3, 'Screen question score uses the existing Excel calculation');

run('state.questions = [{qNum:1,qMarks:3,marks:[{ao:"S",level:1},{ao:"U",level:2},{ao:"I",level:2}]}]; state.paper.totalMarks = 3; renderHeatTable()');
assert.equal(rows()[1].children.at(-1).textContent, '1.67');
assert.equal(rows().at(-1).children[0].textContent, 'Paper average difficulty per mark');
assert.equal(rows().at(-1).children.at(-1).textContent, '1.67');

run('state.questions = [{qNum:1,qMarks:3,marks:[]}]; renderHeatTable()');
assert.equal(rows().at(-1).children.at(-1).textContent, '—', 'No tags must not imply difficulty zero');
assert.equal(rows()[0].children.reduce((sum, cell) => sum + (cell.colSpan || 1), 0), rows()[1].children.length, 'An untagged question still aligns with the four-column header');
run('state.questions = []; renderHeatTable()');
assert.equal(rows()[1].children[0].colSpan, 4);
console.log('Report difficulty checks passed: Excel parity, mark-weighted averages, rounding, partial and missing tags, and empty-table alignment.');
