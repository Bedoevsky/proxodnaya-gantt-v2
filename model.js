// Модель плана: разбор снимка, сетевой расчёт резерва и критического пути (метод CPM).
// Работает в браузере (window.GanttModel) и в Node (require) — для сборки снимка и тестов.
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GanttModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DAY = 86400000;
  const dayIndex = iso => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY);
  const clock = text => {
    const [hours, minutes] = text.split(':').map(Number);
    return hours * 60 + minutes;
  };

  // Часы расчётного окна, которые приходятся на каждый календарный день между метками.
  function dayHours(start, finish, window) {
    const first = dayIndex(start.slice(0, 10)), last = dayIndex(finish.slice(0, 10));
    const days = [];
    for (let day = first; day <= last; day++) {
      const from = day === first ? clock(start.slice(11)) : window.from;
      const to = day === last ? clock(finish.slice(11)) : window.to;
      const hours = Math.max(0, to - from) / 60;
      if (hours) days.push({ day, hours });
    }
    return days;
  }

  function build(data) {
    const window = { from: clock(data.window.from), to: clock(data.window.to) };
    if (!(window.from < window.to)) throw new Error('Некорректное расчётное окно.');

    const byWbs = new Map();
    for (const [order, card] of data.cards.entries()) {
      if (byWbs.has(card.wbs)) throw new Error('Повторяющийся ИСР: ' + card.wbs + '.');
      const first = dayIndex(card.start), last = dayIndex(card.finish);
      byWbs.set(card.wbs, {
        ...card, order, first, last,
        length: card.type === 'milestone' ? 0 : last - first + 1,
        incoming: [], outgoing: [], packages: [], operations: []
      });
    }
    const sections = [], packages = [], milestones = [];
    for (const item of byWbs.values()) {
      if (item.type === 'section') sections.push(item);
      else if (item.type === 'package') packages.push(item);
      else if (item.type === 'milestone') milestones.push(item);
      else throw new Error('Неизвестный тип карточки: ' + item.type + '.');
    }
    sections.forEach((section, index) => { section.index = index + 1; });
    for (const item of packages) {
      const parent = byWbs.get(item.parent);
      if (!parent || parent.type !== 'section') throw new Error('У пакета ' + item.wbs + ' нет раздела ' + item.parent + '.');
      parent.packages.push(item);
      item.index = parent.index;
    }

    // Связи «финиш → старт» между пакетами и от пакетов к вехам.
    const links = [];
    for (const item of [...packages, ...milestones]) {
      for (const wbs of new Set(item.blockers)) {
        const from = byWbs.get(wbs);
        if (!from || from.type !== 'package') throw new Error('ИСР ' + item.wbs + ' ждёт не пакет: «' + wbs + '».');
        const link = { from, to: item, critical: false };
        item.incoming.push(link);
        from.outgoing.push(link);
        links.push(link);
      }
    }

    const jobs = [...packages, ...milestones];
    const start = Math.min(...jobs.map(job => job.first));
    const end = Math.max(...jobs.map(job => job.last));
    const finish = milestones.find(item => item.wbs === 'M4');
    if (!finish) throw new Error('В плане нет вехи M4 — она задаёт конец критического пути.');

    // Ранние сроки: прямой ход по сети. Работа без предшественников начинается вместе с проектом.
    const ordered = [];
    const waiting = new Map(jobs.map(job => [job, job.incoming.length]));
    const ready = jobs.filter(job => !job.incoming.length);
    while (ready.length) {
      const job = ready.shift();
      ordered.push(job);
      job.early = Math.max(0, ...job.incoming.map(link => link.from.early + link.from.length));
      for (const { to } of job.outgoing) {
        const left = waiting.get(to) - 1;
        waiting.set(to, left);
        if (!left) ready.push(to);
      }
    }
    if (ordered.length !== jobs.length) throw new Error('В зависимостях найден цикл.');

    // Поздние сроки: обратный ход от M4. Работа вне сети до M4 резерва не имеет.
    finish.late = finish.early;
    for (const job of [...ordered].reverse()) {
      if (job !== finish) {
        const next = job.outgoing.filter(link => link.to.late !== undefined).map(link => link.to.late - job.length);
        if (next.length) job.late = Math.min(...next);
      }
      job.float = job.late === undefined ? null : job.late - job.early;
      job.critical = job.float === 0;
    }
    for (const link of links) {
      link.critical = link.from.critical && link.to.critical && link.from.early + link.from.length === link.to.early;
    }

    // Все маршруты нулевого резерва до M4.
    const routes = [];
    const walk = (job, path) => {
      const next = job.outgoing.filter(link => link.critical);
      if (!next.length) {
        if (job === finish) routes.push([...path, job.wbs]);
        return;
      }
      for (const link of next) walk(link.to, [...path, job.wbs]);
    };
    for (const job of jobs) {
      if (job.critical && !job.incoming.some(link => link.critical)) walk(job, []);
    }

    const operations = [];
    const operationsByWbs = new Map();
    for (const [order, source] of data.operations.entries()) {
      if (operationsByWbs.has(source.wbs)) throw new Error('Повторяющийся ИСР операции: ' + source.wbs + '.');
      const operation = {
        ...source, type: 'operation', order,
        first: dayIndex(source.start.slice(0, 10)), last: dayIndex(source.finish.slice(0, 10)),
        pred: source.inputs.slice(), succ: []
      };
      operationsByWbs.set(operation.wbs, operation);
      operations.push(operation);
    }
    for (const operation of operations) {
      const parent = byWbs.get(operation.parent);
      if (!parent || parent.type !== 'package') throw new Error('У операции ' + operation.wbs + ' нет пакета ' + operation.parent + '.');
      parent.operations.push(operation);
      operation.index = parent.index;
      byWbs.set(operation.wbs, operation);
      for (const wbs of operation.pred) {
        const previous = operationsByWbs.get(wbs);
        if (!previous) throw new Error('Операция ' + operation.wbs + ' ждёт неизвестную операцию ' + wbs + '.');
        previous.succ.push(operation.wbs);
      }
      if (operation.queue && !operationsByWbs.has(operation.queue)) {
        throw new Error('У операции ' + operation.wbs + ' неизвестная очередь исполнителя: ' + operation.queue + '.');
      }
    }

    for (const milestone of milestones) milestone.checks = milestone.incoming.map(link => link.from);
    for (const item of packages) {
      item.gates = item.outgoing.filter(link => link.to.type === 'milestone').map(link => link.to);
      item.effort = item.operations.reduce((sum, operation) => sum + operation.hours, 0);
    }
    for (const section of sections) section.effort = section.packages.reduce((sum, item) => sum + item.effort, 0);

    const team = data.team.map((person, index) => ({ ...person, index, hours: 0, packages: 0 }));
    const people = new Map(team.map(person => [person.name, person]));
    for (const name of [...packages.map(item => item.owner), ...operations.map(operation => operation.owner)]) {
      if (!people.has(name)) {
        const person = { name, role: '', index: team.length, hours: 0, packages: 0 };
        people.set(name, person);
        team.push(person);
      }
    }
    for (const item of packages) people.get(item.owner).packages++;
    for (const operation of operations) people.get(operation.owner).hours += operation.hours;

    return {
      meta: data.meta, window, start, end, days: end - start + 1,
      sections, packages, milestones, operations, links, routes, team, byWbs,
      people,
      metrics: {
        sections: sections.length,
        packages: packages.length,
        milestones: milestones.length,
        operations: operations.length,
        hours: operations.reduce((sum, operation) => sum + operation.hours, 0),
        handoffs: operations.reduce((sum, operation) => sum + operation.pred.length, 0),
        links: links.length,
        criticalDays: finish.early,
        routes: routes.length
      }
    };
  }

  // Позиция метки времени на шкале: расчётное окно дня занимает всю ширину суток.
  function xOf(stamp, model, width, pad) {
    const day = dayIndex(stamp.slice(0, 10)) - model.start;
    const part = Math.min(1, Math.max(0, (clock(stamp.slice(11)) - model.window.from) / (model.window.to - model.window.from)));
    return pad + (day + part) * width;
  }

  return { build, dayIndex, clock, dayHours, xOf };
});
