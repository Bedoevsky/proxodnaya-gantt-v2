#!/usr/bin/env node
// Собирает снимок плана (data.js) из реестров проекта.
//
//   node sync-data.mjs <каталог с project-backlog.csv и work-plan.csv>
//
// Пример: node sync-data.mjs ../proxodnaya/docs
// Правки data.js от руки не сохранятся: обновите реестры и повторите команду.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(process.argv[2] ?? join(here, 'data'));
const outFile = join(here, 'data.js');
const { build, clock } = createRequire(import.meta.url)('./model.js');

const REPOSITORY = 'https://github.com/druni-bratani/proxodnaya';
const SOURCES = ['docs/project-backlog.csv', 'docs/work-plan.csv'];

// Расчётное окно рабочего дня (МСК) — docs/wbs.md.
const WINDOW = { from: '10:00', to: '16:00' };

// Роли участников — docs/team.md.
const ROLES = {
  'Бедоев Алан': 'PM, QA',
  'Попов Кирилл': 'Backend, DevOps',
  'Антоненко Илья': 'Backend, QA',
  'Лавров Мирослав': 'ML, frontend',
  'Грановский Марк': 'Frontend',
  'Квитко Дмитрий': 'Аналитик, QA frontend'
};

// Номера карточек доски для разделов, пакетов и вех: в реестре их нет,
// сверены с GitHub 24.11.2026. Новую карточку добавьте сюда.
const CARD_ISSUES = {
  '1': 1, '1.1': 2, '1.2': 3, '1.3': 4,
  '2': 5, '2.1': 6, '2.2': 7, '2.3': 8, '2.4': 9,
  '3': 10, '3.1': 11, '3.2': 12,
  '4': 13, '4.1': 14, '4.2': 15, '4.3-ML': 16, '4.3': 17, '4.4': 18, '4.5': 19, '4.6': 20,
  '5': 21, '5.1': 22, '5.2': 23,
  'M1': 24, 'M2': 25, 'M3': 26, 'M4': 27
};

const TYPES = { 'Раздел': 'section', 'Пакет': 'package', 'Веха': 'milestone' };
const CHECK = /^Проверены результаты пакетов (.+)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ';') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function readTable(name, required) {
  const [header, ...rows] = parseCSV(readFileSync(join(docsDir, name), 'utf8').replace(/^\uFEFF/, ''));
  for (const column of required) {
    if (!header.includes(column)) throw new Error(`${name}: нет столбца «${column}».`);
  }
  return rows.map((row, index) => {
    if (row.length !== header.length) throw new Error(`${name}: строка ${index + 2} содержит ${row.length} полей вместо ${header.length}.`);
    return Object.fromEntries(header.map((column, i) => [column, row[i].trim()]));
  });
}

const list = value => value.split(',').map(part => part.trim()).filter(Boolean);
const fail = (wbs, message) => { throw new Error(`ИСР ${wbs}: ${message}`); };

function toCard(row, index) {
  const wbs = row['ИСР'];
  const type = TYPES[row['Тип']];
  if (!wbs) throw new Error(`project-backlog.csv: пустой ИСР в строке ${index + 2}.`);
  if (!type) fail(wbs, `неизвестный тип «${row['Тип']}».`);
  if (!row['Задача'] || !row['Ответственный']) fail(wbs, 'нет названия или ответственного.');
  for (const value of [row['Старт'], row['Финиш']]) {
    if (!DATE.test(value) || Number.isNaN(Date.parse(value + 'T00:00:00Z'))) fail(wbs, `некорректная дата «${value}».`);
  }
  if (row['Финиш'] < row['Старт']) fail(wbs, 'финиш раньше старта.');
  if (type !== 'package' && row['Завершить до старта']) fail(wbs, 'столбец «Завершить до старта» заполнен только у пакетов.');
  if (type === 'milestone' && !CHECK.test(row['Готово когда'])) {
    console.warn(`  Веха ${wbs}: не удалось найти пакеты приёмки в строке «${row['Готово когда']}».`);
  }
  return {
    type, wbs, title: row['Задача'],
    parent: type === 'package' ? row['Родитель'] : null,
    owner: row['Ответственный'], participants: row['Участники'],
    start: row['Старт'], finish: row['Финиш'],
    blockers: type === 'milestone'
      ? (CHECK.exec(row['Готово когда'])?.[1] ?? '').split(',').map(part => part.trim()).filter(Boolean)
      : list(row['Завершить до старта']),
    result: row['Готово когда'],
    issue: CARD_ISSUES[wbs] ?? null
  };
}

function toOperation(row, index) {
  const wbs = row['ИСР'];
  if (!wbs) throw new Error(`work-plan.csv: пустой ИСР в строке ${index + 2}.`);
  if (!row['Задача'] || !row['Ответственный']) fail(wbs, 'нет названия или исполнителя.');
  for (const value of [row['Начало МСК'], row['Финиш МСК']]) {
    if (!STAMP.test(value)) fail(wbs, `некорректное время «${value}», ожидается ГГГГ-ММ-ДДТЧЧ:ММ.`);
  }
  if (row['Финиш МСК'] <= row['Начало МСК']) fail(wbs, 'финиш не позже старта.');
  const from = clock(row['Начало МСК'].slice(11)), to = clock(row['Финиш МСК'].slice(11));
  if (from < clock(WINDOW.from) || to > clock(WINDOW.to)) {
    fail(wbs, `время вне расчётного окна ${WINDOW.from}–${WINDOW.to}. Обновите WINDOW в скрипте, если окно изменилось.`);
  }
  const number = (column, min) => {
    const value = Number(row[column]);
    if (!Number.isInteger(value) || value < min) fail(wbs, `некорректное значение «${row[column]}» в столбце «${column}».`);
    return value;
  };
  return {
    wbs, parent: row['Суммарная работа'], title: row['Задача'], owner: row['Ответственный'],
    hours: number('План, ч', 1),
    start: row['Начало МСК'], finish: row['Финиш МСК'],
    inputs: list(row['Входы']), result: row['Результат'],
    slack: number('Резерв, ч', 0),
    queue: row['Очередь исполнителя'] || null,
    issue: number('GitHub', 1)
  };
}

const cards = readTable('project-backlog.csv', [
  'Тип', 'ИСР', 'Родитель', 'Задача', 'Ответственный', 'Участники', 'Старт', 'Финиш', 'Завершить до старта', 'Готово когда'
]).map(toCard);
const operations = readTable('work-plan.csv', [
  'ИСР', 'Суммарная работа', 'Задача', 'Ответственный', 'План, ч', 'Начало МСК', 'Финиш МСК',
  'Входы', 'Результат', 'Резерв, ч', 'Очередь исполнителя', 'GitHub'
]).map(toOperation);

const snapshot = {
  meta: {
    project: 'Проходная',
    generated: new Date().toLocaleDateString('sv-SE'),
    repository: REPOSITORY,
    sources: SOURCES
  },
  window: WINDOW,
  team: Object.entries(ROLES).map(([name, role]) => ({ name, role })),
  cards,
  operations
};

// Снимок обязан собираться в модель без ошибок: иначе диаграмма не откроется.
const model = build(snapshot);
const count = type => cards.filter(card => card.type === type).length;

const lines = [
  '// Снимок плана для диаграммы Ганта. Сгенерирован sync-data.mjs — не редактировать вручную.',
  '(function (root) {',
  "  'use strict';",
  '  root.PLAN_DATA = {'
];
for (const [key, value] of Object.entries(snapshot)) {
  if (Array.isArray(value)) {
    lines.push(`    ${key}: [`);
    for (const record of value) lines.push(`      ${JSON.stringify(record)},`);
    lines.push('    ],');
  } else {
    lines.push(`    ${key}: ${JSON.stringify(value)},`);
  }
}
lines.push(
  '  };',
  "  if (typeof module === 'object' && module.exports) module.exports = root.PLAN_DATA;",
  "})(typeof globalThis !== 'undefined' ? globalThis : this);",
  ''
);
writeFileSync(outFile, lines.join('\n'), 'utf8');

const m = model.metrics;
console.log(`Снимок записан в ${outFile}`);
console.log(`  Разделы ${m.sections} · пакеты ${m.packages} · вехи ${m.milestones} · операции ${m.operations} (${m.hours} ч) · передач ${m.handoffs}`);
console.log(`  Связей «финиш → старт»: ${m.links} · критический путь: ${m.criticalDays} дней, маршрутов ${m.routes}`);
if (cards.some(card => card.issue === null)) console.warn('  Есть карточки без номера в CARD_ISSUES — ссылки на доску для них не будет.');
