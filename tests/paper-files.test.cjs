const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const elements = new Map();
const handlers = new Map();
const alerts = [];
const downloads = [];
const element = id => {
  if (!elements.has(id)) elements.set(id, {
    value: '', checked: false, open: false, style: {},
    addEventListener() {}, focus() {},
    showModal() { this.open = true; }, close() { this.open = false; }
  });
  return elements.get(id);
};
const context = vm.createContext({
  console, Blob, TextEncoder, setTimeout,
  alert: message => alerts.push(message),
  document: { getElementById: element, querySelectorAll: () => [], activeElement: null },
  window: { addEventListener: (name, handler) => handlers.set(name, handler) },
  FileReader: class {
    readAsText(file) {
      if (file.error) this.onerror();
      else this.onload({ target: { result: file.text } });
    }
  },
  downloads
});
const script = fs.readFileSync(new URL('../index.html', `file://${__filename}`), 'utf8')
  .match(/<script>([\s\S]*)<\/script>/)[1];
vm.runInContext(script.slice(0, script.indexOf('// init')), context);
vm.runInContext(`
  renderAll = ()=>{};
  renderDraftPartsPreviewAndList = ()=>{};
  downloadJSONFile = (payload, name)=>downloads.push({payload, name});
  clearQuestionDraft();
`, context);
const run = code => vm.runInContext(code, context);
const dirty = () => run('hasUnsavedChanges()');
const beforeUnloadBlocked = () => {
  let blocked = false;
  handlers.get('beforeunload')({ preventDefault() { blocked = true; } });
  return blocked;
};
const current = () => JSON.parse(run('paperSnapshotText()'));

assert.equal(dirty(), false);
assert.equal(beforeUnloadBlocked(), false);
run('state.paper.title = "Draft with no questions"');
assert.equal(beforeUnloadBlocked(), true);
run('startNewBlankPaper()');
assert.equal(element('unsavedChangesDialog').open, true);
run('closeReplacementDialog()');
assert.equal(current().paper.title, 'Draft with no questions', 'Cancel preserves all work');
run('startNewBlankPaper(); finishPaperReplacement(true)');
assert.equal(downloads.at(-1).payload.paper.title, 'Draft with no questions');
assert.equal(downloads.at(-1).payload.questions.length, 0);
assert.equal(current().paper.title, '');
assert.equal(dirty(), false);

const sample = {
  type: 'ao-heatmap-paper', version: 1,
  paper: { title: 'Round trip', totalMarks: 3, note: 'Legacy metadata' },
  questions: [{ qNum: 1, qMarks: 3, desc: 'Functions', highlight: true,
    structure: { noParts: true, parts: [] },
    marks: [{ ao: 'S', level: 1 }, { ao: 'U', level: 2 }, { ao: 'I', level: 3 }] }]
};
context.file = { text: JSON.stringify(sample) };
run('importPaperFile(file)');
assert.equal(dirty(), false, 'Imported file starts clean');
assert.equal(current().questions[0].marks[2].boundaryAfter, 'thick');
run('state.selectedQIndex = 0; state.selectedMarkIndex = 1; tagMark("I", 3)');
assert.equal(dirty(), true, 'AO edits need saving');
run('exportCurrentPaperFile()');
assert.equal(downloads.at(-1).payload.questions[0].marks[1].ao, 'I');
assert.equal(dirty(), false);
run('state.selectedQIndex = null; state.selectedMarkIndex = null');
assert.equal(dirty(), false, 'Selecting questions does not dirty the file');

run('state.paper.totalMarks = 5');
context.file = { text: JSON.stringify({ currentPaper: sample }) };
run('importPaperFile(file)');
run('closeReplacementDialog()');
assert.equal(current().paper.totalMarks, 5, 'Cancel import keeps the current paper');
run('importPaperFile(file); finishPaperReplacement(false)');
assert.equal(current().paper.totalMarks, 3, 'Discard then import loads the chosen file');
assert.equal(dirty(), false);

run('state.paper.title = "Keep this"');
const beforeInvalid = current();
context.file = { text: '{ broken json' };
run('importPaperFile(file)');
assert.deepEqual(current(), beforeInvalid, 'Invalid files cannot replace the paper');
context.file = { error: true };
run('importPaperFile(file)');
assert.deepEqual(current(), beforeInvalid, 'Unreadable files cannot replace the paper');

run('startNewBlankPaper(); finishPaperReplacement(false)');
element('qDesc').value = 'Question still being drafted';
assert.equal(beforeUnloadBlocked(), true, 'Unadded drafts are protected');
run('startNewBlankPaper()');
const downloadCount = downloads.length;
run('finishPaperReplacement(true)');
assert.equal(downloads.length, downloadCount, 'Incomplete question cannot be silently omitted');
assert.equal(element('unsavedChangesDialog').open, true);
assert.equal(element('qDesc').value, 'Question still being drafted');
run('finishPaperReplacement(false)');
assert.equal(element('qDesc').value, '');
assert.equal(dirty(), false);

run('state.paper.title = "Save error"; startNewBlankPaper(); downloadJSONFile = ()=>{throw new Error("Download failed")}; finishPaperReplacement(true)');
assert.equal(current().paper.title, 'Save error', 'Save failure keeps the paper and prompt');
assert.equal(element('unsavedChangesDialog').open, true);
assert.equal(dirty(), true);

assert.ok(alerts.some(message => message.includes('in progress')));
console.log('Paper file checks passed: save/import, draft and AO changes, cancel/discard, legacy files, invalid files, failed saves, and leave warnings.');
