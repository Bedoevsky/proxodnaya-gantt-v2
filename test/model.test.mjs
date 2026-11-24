// Проверки модели и снимка плана: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { build, dayHours, xOf } = require('../model.js');
const data = require('../data.js');
const model = build(data);

const wbs = items => items.map(item => item.wbs);

test('снимок совпадает с базовым планом из расписания', () => {
  // Числа записаны в docs/schedule.md и docs/wbs.md основного репозитория.
  // Если реестры изменились, после сборки снимка обновите и документацию.
  assert.deepEqual(model.metrics, {
    sections: 5, packages: 18, milestones: 4, operations: 84,
    hours: 421, handoffs: 135, links: 29, criticalDays: 42, routes: 11
  });
  assert.equal(model.days, 42);
});

test('критический путь и резерв совпадают с расчётом в расписании', () => {
  assert.deepEqual(wbs(model.packages.filter(item => item.critical)).sort(),
    ['1.3', '2.1', '2.4', '3.1', '4.1', '4.2', '4.3', '4.4', '4.5', '4.6', '5.1', '5.2']);
  const floats = Object.fromEntries(model.packages.map(item => [item.wbs, item.float]));
  assert.deepEqual(floats, {
    '1.1': null, '1.2': null, '1.3': 0,
    '2.1': 0, '2.2': null, '2.3': null, '2.4': 0,
    '3.1': 0, '3.2': 7,
    '4.1': 0, '4.2': 0, '4.3-ML': 7, '4.3': 0, '4.4': 0, '4.5': 0, '4.6': 0,
    '5.1': 0, '5.2': 0
  });
  assert.deepEqual(wbs(model.milestones.filter(item => item.critical)), ['M4']);
});

test('критические маршруты совпадают со списком в расписании', () => {
  const actual = model.routes.map(path => path.join('→')).sort();
  assert.deepEqual(actual, [
    '2.1→2.4→4.4→5.1→1.3→M4', '2.1→2.4→4.4→5.1→5.2→M4',
    '3.1→4.1→4.4→5.1→1.3→M4', '3.1→4.1→4.4→5.1→5.2→M4',
    '3.1→4.1→4.5→5.1→1.3→M4', '3.1→4.1→4.5→5.1→5.2→M4',
    '3.1→4.1→4.6→5.2→M4',
    '3.1→4.2→5.1→1.3→M4', '3.1→4.2→5.1→5.2→M4',
    '3.1→4.3→5.1→1.3→M4', '3.1→4.3→5.1→5.2→M4'
  ].sort());
});

test('связи «финиш → старт» не нарушают календарь', () => {
  for (const link of model.links) {
    const start = link.to.type === 'milestone' ? link.to.last : link.to.first;
    assert.ok(link.from.last <= start, `${link.from.wbs} → ${link.to.wbs}: предшественник заканчивается позже старта`);
  }
  assert.equal(model.milestones.find(item => item.wbs === 'M2').checks.length, 3);
  assert.equal(model.milestones.find(item => item.wbs === 'M4').checks.length, 2);
});

test('операции лежат в расчётном окне, и их часы сходятся с оценкой', () => {
  const issues = new Set();
  for (const operation of model.operations) {
    assert.equal(model.byWbs.get(operation.parent).type, 'package', operation.wbs);
    assert.ok(operation.start < operation.finish, operation.wbs);
    assert.equal(Math.round(dayHours(operation.start, operation.finish, model.window).reduce((sum, part) => sum + part.hours, 0) * 60) / 60,
      operation.hours, `окно и оценка не совпадают у ${operation.wbs}`);
    for (const wbs of [...operation.pred, operation.queue].filter(Boolean)) {
      assert.equal(model.byWbs.get(wbs)?.type, 'operation', `${operation.wbs} ссылается на ${wbs}`);
    }
    assert.ok(!issues.has(operation.issue), `карточка #${operation.issue} указана дважды`);
    issues.add(operation.issue);
  }
  for (const item of [...model.sections, ...model.packages, ...model.milestones]) {
    assert.ok(Number.isInteger(item.issue), `у ИСР ${item.wbs} нет номера карточки`);
  }
  assert.equal(model.team.reduce((sum, person) => sum + person.hours, 0), model.metrics.hours);
});

test('шкала: расчётное окно дня занимает всю ширину суток', () => {
  const width = 40, pad = 12;
  assert.equal(xOf('2026-11-09T10:00', model, width, pad), pad);
  assert.equal(xOf('2026-11-09T16:00', model, width, pad), pad + width);
  assert.equal(xOf('2026-12-20T16:00', model, width, pad), pad + model.days * width);
  assert.equal(xOf('2026-11-09T13:00', model, width, pad), pad + width / 2);
});
