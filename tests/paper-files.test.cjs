const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const elements = new Map();
const handlers = new Map();
const alerts = [];
const downloads = [];
const makeElement = () => ({
  value: '', checked: false, open: false, style: {}, children: [], dataset: {},
  set innerHTML(value) { this.children = []; },
  addEventListener() {}, focus() {}, scrollIntoView() {},
  appendChild(child) { this.children.push(child); },
  setAttribute(key, value) { this[key] = value; },
  showModal() { this.open = true; }, close() { this.open = false; }
});
const element = id => {
  if (!elements.has(id)) elements.set(id, makeElement());
  return elements.get(id);
};
const context = vm.createContext({
  console, Blob, TextEncoder, setTimeout,
  alert: message => alerts.push(message),
  document: { createElement: makeElement, getElementById: element, querySelectorAll: () => [], activeElement: null },
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
  renderAll = ()=>{ renderQuestionBuilderMode(); renderDraftPartButtons(); };
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

run('closeReplacementDialog(); startNewBlankPaper(); finishPaperReplacement(false)');
element('qNum').value = '1';
element('qMarks').value = '3';
element('qDesc').value = 'Parts example';
element('partLabel').value = 'a';
element('partMarks').value = '2';
run('addOrSaveDraftPart(); addQuestion()');
assert.equal(current().questions.length, 0, 'Mismatched structure is still rejected without the status area');
element('partLabel').value = 'b';
element('partMarks').value = '1';
run('addOrSaveDraftPart(); addQuestion()');
assert.equal(current().questions.length, 1);
assert.equal(current().questions[0].structure.parts.length, 2);
assert.equal(current().questions[0].segmentPlan.reduce((sum, part) => sum + part.marksCount, 0), 3);
assert.equal(element('qNum').value, '');
assert.equal(run('state.draft.parts.length'), 0, 'Adding a question clears its draft');
assert.equal(dirty(), true, 'Added questions still require saving');
console.log('Question builder checks passed: invalid structure rejected, valid parts retained, and draft cleared.');

run('clearQuestionDraft(); rebuildSubpartsUI = ()=>{};');
element('qNum').value = '2';
element('qMarks').value = '6';
run('addOrSaveDraftPart()');
assert.equal(element('qNoPartsOption').style.display, 'none');
assert.equal(element('draftPartButtons').children[0].children[0].textContent, '(a) · 1 mark');
element('partMarks').value = '2';
run('addOrSaveDraftPart(); editDraftPart(0)');
assert.equal(element('partLabel').value, 'a');
element('partMarks').value = '4';
run('addQuestion()');
assert.equal(current().questions.length, 1, 'Pending part edit cannot be silently omitted');
run('addOrSaveDraftPart()');
assert.equal(run('state.draft.parts.length'), 2, 'Saving replaces the part without duplicating it');
assert.equal(run('state.draft.parts[0].marks'), 4);
run('editDraftPart(0)');
element('partLabel').value = 'b';
run('addOrSaveDraftPart()');
assert.equal(run('state.draft.parts[0].label'), 'a', 'Duplicate label edit is rejected');
run('resetPartForm(); addQuestion()');
assert.equal(current().questions.length, 2);
run('state.selectedQIndex = 1; tagMark("S", 1); tagMark("U", 2); editQuestion(state.questions[1]);');
assert.equal(element('addQuestionBtn').textContent, 'Save question changes');
assert.equal(run('state.draft.parts.length'), 2);
run('editDraftPart(1)');
element('partMarks').value = '3';
run('addOrSaveDraftPart()');
assert.equal(current().questions[1].structure.parts[1].marks, 2, 'Stored question stays unchanged until Save question changes');
element('qMarks').value = '7';
run('addQuestion()');
assert.equal(current().questions.length, 2, 'Existing question is replaced in place');
assert.equal(current().questions[1].structure.parts[1].marks, 3);
assert.equal(current().questions[1].marks.length, 2, 'Tags on earlier unchanged parts survive');
run('editQuestion(state.questions[1]); editDraftPart(0)');
element('partMarks').value = '3';
run('addOrSaveDraftPart()');
element('qMarks').value = '6';
run('addQuestion()');
assert.equal(current().questions[1].marks.length, 0, 'Tags cannot shift into changed parts');
run('editQuestion(state.questions[1]); clearDraftParts(); clearQuestionDraft()');
assert.equal(current().questions[1].structure.parts.length, 2, 'Cancelling question edit leaves stored structure intact');
assert.equal(element('qNoPartsOption').style.display, 'flex');
assert.equal(element('addQuestionBtn').textContent, 'Add question');
assert.equal(element('draftPartButtons').children.length, 0);
// Preserve every tag when only metadata changes, and the ordered prefix when
// a later segment changes or is removed.
context.oldQuestion = { segmentPlan: [{label:'a', marksCount:2}, {label:'b', marksCount:1}], marks:[{ao:'S',level:1},{ao:'U',level:2},{ao:'I',level:3}] };
context.newQuestion = { segmentPlan: [{label:'a', marksCount:2}, {label:'b', marksCount:1}] };
assert.equal(run('retainedTagsForEdit(oldQuestion, newQuestion).length'), 3);
context.newQuestion.segmentPlan[1].marksCount = 2;
assert.equal(run('retainedTagsForEdit(oldQuestion, newQuestion).length'), 2);
console.log('Part editing checks passed: chips, hidden no-parts option, duplicate guard, cancel, existing questions, and safe AO tag retention.');

run('clearQuestionDraft()');
element('qNum').value = '3';
element('qMarks').value = '9';
for (const marks of ['4', '4', '1']) {
  element('partMarks').value = marks;
  run('addOrSaveDraftPart()');
}
assert.equal(element('partEntryFields').style.display, 'none', 'Completed total hides new-part fields');
assert.equal(element('partSaveActions').style.display, 'none');
assert.equal(element('draftPartButtons').children.length, 3, 'Completed parts remain available to edit');
run('addOrSaveDraftPart()');
assert.equal(run('state.draft.parts.length'), 3, 'A completed question cannot gain an extra part');
run('editDraftPart(0)');
assert.equal(element('partEntryFields').style.display, 'block', 'Existing parts remain editable at the total');
element('partMarks').value = '3';
run('addOrSaveDraftPart()');
assert.equal(element('partEntryFields').style.display, 'block', 'Reducing a part restores new-part entry');
element('qMarks').value = '8';
run('renderPartEntryAvailability()');
assert.equal(element('partEntryFields').style.display, 'none', 'Changing question marks updates availability');
element('qMarks').value = '10';
run('renderPartEntryAvailability()');
assert.equal(element('partEntryFields').style.display, 'block');
run('clearQuestionDraft()');
element('qNum').value = '3';
element('qMarks').value = '13';
for (let i = 0; i < 13; i++) run('addOrSaveDraftPart()');
assert.equal(run('state.draft.parts[12].label'), 'm');
assert.equal(element('partEntryFields').style.display, 'none');
run('addQuestion()');
assert.equal(current().questions[2].structure.parts.length, 13);
assert.equal(current().questions[2].segmentPlan[12].label, 'm');
run('editQuestion(state.questions[2]); editDraftPart(12)');
assert.equal(element('partLabel').value, 'm', 'Part m reopens for editing');
assert.equal(element('partEntryFields').style.display, 'block');
console.log('Part allocation checks passed: total reached, edit/reopen, changed totals, and parts a through m.');
