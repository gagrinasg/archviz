import test from 'node:test';
import assert from 'node:assert/strict';
import { check, applyOp } from './rules.mjs';

const C = (id, kind = 'class', methods = [], attributes = []) => ({ id, kind, methods, attributes });
const R = (from, type, to) => ({ from, to, type });
const rules = (model) => check(model).map((v) => v.rule).sort();

test('clean model has no violations', () => {
  const m = { language: 'typescript', classes: [C('Shape', 'interface', ['+area(): number']), C('Circle', 'class', ['+area(): number'])], relations: [R('Circle', 'implements', 'Shape')] };
  assert.deepEqual(rules(m), []);
});

test('unknown id', () => {
  assert.deepEqual(rules({ classes: [C('A')], relations: [R('A', 'association', 'Nope')] }), ['unknown-id']);
});

test('interface extends class / class extends interface / implements non-interface', () => {
  const m = { classes: [C('I', 'interface'), C('K'), C('J', 'interface'), C('L')], relations: [R('I', 'extends', 'K'), R('L', 'extends', 'J'), R('K', 'implements', 'L')] };
  assert.deepEqual(rules(m), ['extends-interface', 'implements-non-interface', 'interface-extends-class', 'unused-abstraction']);
});

test('python allows class extends Protocol', () => {
  const m = { language: 'python', classes: [C('P', 'interface'), C('K')], relations: [R('K', 'extends', 'P')] };
  assert.deepEqual(rules(m), []);
});

test('inheritance cycle', () => {
  const m = { classes: [C('A'), C('B')], relations: [R('A', 'extends', 'B'), R('B', 'extends', 'A')] };
  assert.ok(rules(m).includes('inheritance-cycle'));
});

test('multiple inheritance by language', () => {
  const m = (language) => ({ language, classes: [C('A'), C('B'), C('X')], relations: [R('X', 'extends', 'A'), R('X', 'extends', 'B')] });
  assert.equal(check(m('typescript')).find((v) => v.rule === 'multiple-inheritance').severity, 'error');
  assert.equal(check(m(null)).find((v) => v.rule === 'multiple-inheritance').severity, 'warn');
  assert.ok(!rules(m('python')).includes('multiple-inheritance'));
});

test('python diamond', () => {
  const m = { language: 'python', classes: [C('Base'), C('L'), C('Rt'), C('D')], relations: [R('L', 'extends', 'Base'), R('Rt', 'extends', 'Base'), R('D', 'extends', 'L'), R('D', 'extends', 'Rt')] };
  assert.deepEqual(rules(m), ['diamond']);
});

test('missing implementation: interface methods + abstract-marked methods', () => {
  const m = { classes: [C('I', 'interface', ['+run()', '+stop()']), C('A', 'abstract', ['+stop()', '+tick() {abstract}', '+abstract tock()', '+helper()']), C('X', 'class', ['+run()', '+tock()'])], relations: [R('A', 'implements', 'I'), R('X', 'extends', 'A')] };
  const v = check(m).filter((x) => x.rule === 'missing-implementation');
  assert.deepEqual(v.map((x) => x.message), ['X does not implement tick from A']); // stop: concrete in A; helper: not abstract
});

test('deep hierarchy, god class, fat interface, unused abstraction', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => `+m${i}()`);
  const m = {
    classes: [C('A'), C('B'), C('Cc'), C('D'), C('E'), C('God', 'class', many(16)), C('Fat', 'interface', many(8))],
    relations: [R('B', 'extends', 'A'), R('Cc', 'extends', 'B'), R('D', 'extends', 'Cc'), R('E', 'extends', 'D')],
  };
  assert.deepEqual(rules(m), ['deep-hierarchy', 'fat-interface', 'god-class', 'unused-abstraction']);
});

test('applyOp: add, rename, setKind, relations, remove', () => {
  let m = { classes: [C('A')], relations: [] };
  m = applyOp(m, { op: 'addClass', id: 'B', x: 1, y: 2 });
  m = applyOp(m, { op: 'addRelation', from: 'B', to: 'A', type: 'extends' });
  m = applyOp(m, { op: 'addRelation', from: 'B', to: 'A', type: 'extends' }); // dedup
  m = applyOp(m, { op: 'renameClass', id: 'A', to: 'Base' });
  m = applyOp(m, { op: 'setKind', id: 'Base', kind: 'interface' });
  m = applyOp(m, { op: 'setRelationType', from: 'B', to: 'Base', type: 'extends', newType: 'implements' });
  assert.deepEqual(m.relations, [R('B', 'implements', 'Base')]);
  assert.deepEqual(m.layout.B, { x: 1, y: 2 });
  assert.equal(m.classes[0].kind, 'interface');
  m = applyOp(m, { op: 'removeClass', id: 'Base' });
  assert.deepEqual(m.relations, []);
  assert.throws(() => applyOp(m, { op: 'addClass', id: 'B' }));
});
