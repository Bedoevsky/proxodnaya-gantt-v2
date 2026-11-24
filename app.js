// Интерактивная диаграмма Ганта. Снимок плана — data.js, расчёт сети — model.js.
(function () {
  'use strict';

  const { build, dayIndex, xOf, dayHours } = window.GanttModel;
  const model = build(window.PLAN_DATA);
  const data = window.PLAN_DATA;

  const DAY = 86400000;
  const PAD = 12;
  const MIN_WIDTH = 14;
  const MAX_WIDTH = 84;
  const ISSUE = data.meta.repository + '/issues/';
  const CHEVRON = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const SUN = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="currentColor"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  const MOON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.6 9.7A6 6 0 0 1 6.3 2.4a6 6 0 1 0 7.3 7.3Z" fill="currentColor"/></svg>';
  // Светлые цвета: подпись внутри полосы читается только тёмная.
  const LIGHT = { section: [3], owner: [3, 4] };
  const SHORT_SECTION = {
    '1': 'Управление проектом',
    '2': 'Инфраструктура и DevOps',
    '3': 'Аналитика и проектирование',
    '4': 'Разработка модулей',
    '5': 'Тестирование и защита'
  };
  const LEGEND_SECTION = {
    '1': 'Управление',
    '2': 'Инфраструктура и DevOps',
    '3': 'Аналитика',
    '4': 'Разработка',
    '5': 'Тестирование и защита'
  };

  // ---- Форматирование ----
  const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const date = day => new Date(day * DAY);
  const pad2 = value => String(value).padStart(2, '0');
  const dm = day => pad2(date(day).getUTCDate()) + '.' + pad2(date(day).getUTCMonth() + 1);
  const dmy = day => dm(day) + '.' + date(day).getUTCFullYear();
  const long = day => date(day).getUTCDate() + ' ' + MONTHS_GENITIVE[date(day).getUTCMonth()];
  const longYear = day => long(day) + ' ' + date(day).getUTCFullYear();
  const span = (first, last) => first === last ? dmy(first) : dm(first) + ' — ' + dmy(last);
  const clock = stamp => stamp.slice(11, 16);
  const when = operation => dm(operation.first) + ' ' + clock(operation.start) + ' — ' +
    (operation.first === operation.last ? '' : dm(operation.last) + ' ') + clock(operation.finish);
  function plural(count, forms) {
    const tens = Math.abs(count) % 100, ones = tens % 10;
    return forms[tens > 10 && tens < 20 ? 2 : ones === 1 ? 0 : ones >= 2 && ones <= 4 ? 1 : 2];
  }
  const nouns = (count, forms) => count + ' ' + plural(count, forms);
  const days = count => nouns(count, ['день', 'дня', 'дней']);
  const hours = count => nouns(count, ['час', 'часа', 'часов']);

  // ---- Состояние ----
  const prefs = (() => {
    try { return JSON.parse(localStorage.getItem('gantt-v2:prefs')) || {}; } catch { return {}; }
  })();
  const systemDark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  const state = {
    lens: prefs.lens === 'owner' ? 'owner' : 'section',
    theme: prefs.theme === 'dark' || prefs.theme === 'light' ? prefs.theme : systemDark ? 'dark' : 'light',
    owner: '', critical: false, route: null, showRoutes: false,
    links: true, handoffs: false,
    hidden: new Set(), expanded: new Set(),
    selected: null, hovered: null,
    width: 20, fitted: true, wide: false
  };
  const savePrefs = () => {
    try { localStorage.setItem('gantt-v2:prefs', JSON.stringify({ lens: state.lens, theme: state.theme })); } catch { /* режим приватного просмотра */ }
  };

  // Сегодня в МСК: линия на шкале и подсказка о ближайшей вехе.
  const today = (() => {
    const now = new Date();
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Moscow', hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
      }).formatToParts(now);
      const get = type => Number(parts.find(part => part.type === type).value);
      return { day: Math.round(Date.UTC(get('year'), get('month') - 1, get('day')) / DAY), minutes: get('hour') * 60 + get('minute') };
    } catch {
      return { day: Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY), minutes: now.getHours() * 60 + now.getMinutes() };
    }
  })();
  const todayInside = today.day >= model.start && today.day <= model.end;
  const todayPart = todayInside
    ? Math.min(1, Math.max(0, (today.minutes - model.window.from) / (model.window.to - model.window.from)))
    : null;

  // ---- Ссылки на страницу ----
  const $ = (selector, root = document) => root.querySelector(selector);
  const root = document.documentElement;
  const chart = $('.chart'), head = $('#chead'), body = $('#cbody'), scroll = $('#scroll'), legend = $('#legend');
  const workspace = $('.workspace'), inspector = $('#inspector'), inspectorBody = $('#inspector-body');
  const tooltip = $('#tooltip'), ownerSelect = $('#owner');

  const esc = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const n = value => Math.round(value * 10) / 10;
  const person = name => model.people.get(name);
  const initials = name => name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const cssVar = name => parseFloat(getComputedStyle(root).getPropertyValue(name));
  const railWidth = () => cssVar('--rail');
  // Размеры берутся из стилей, чтобы строки и связи по ним всегда совпадали.
  const HEAD = cssVar('--head');
  const ROW_HEIGHT = { section: cssVar('--row-section'), package: cssVar('--row-package'), operation: cssVar('--row-operation') };

  // ---- Шкала ----
  const xDay = day => PAD + (day - model.start) * state.width;
  const xEnd = day => PAD + (day - model.start + 1) * state.width;
  const xStamp = stamp => xOf(stamp, model, state.width, PAD);
  const chartWidth = () => PAD * 2 + model.days * state.width;

  // ---- Строки ----
  const isOpen = item => state.expanded.has(item.wbs) || !!state.owner;
  // Виден ли элемент при фильтре по исполнителю: раскрытый пакет показан, если в нём есть его операция.
  const showsOwner = item => !state.owner || item.owner === state.owner ||
    (item.type === 'package' && isOpen(item) && item.operations.some(operation => operation.owner === state.owner));

  function visibleRows() {
    const rows = [];
    for (const section of model.sections) {
      const packages = section.packages.filter(showsOwner);
      if (!packages.length) continue;
      rows.push({ kind: 'section', item: section });
      if (state.hidden.has(section.wbs)) continue;
      for (const item of packages) {
        rows.push({ kind: 'package', item });
        if (isOpen(item)) {
          rows.push(...item.operations
            .filter(operation => !state.owner || operation.owner === state.owner)
            .map(operation => ({ kind: 'operation', item: operation })));
        }
      }
    }
    return rows;
  }

  const caret = (item, open, what) => `<button type="button" class="caret" data-toggle="${item.wbs}" aria-expanded="${open}" aria-label="${open ? 'Свернуть' : 'Раскрыть'} ${what}">${CHEVRON}</button>`;
  const bar = (item, left, width, text, extra = '', labelFrom = 56) => `<span class="bar${extra ? ' ' + extra : ''}" data-tip="${item.wbs}" style="left:${n(left + 1)}px;width:${n(Math.max(2, width - 2))}px">${width >= labelFrom ? `<span class="lbl">${text}</span>` : ''}</span>`;
  const summary = item => `<span class="sum" data-tip="${item.wbs}" style="left:${xDay(item.first) + 1}px;width:${xEnd(item.last) - xDay(item.first) - 2}px"></span>`;

  function rowHTML(row, order) {
    const { kind, item } = row;
    const section = kind === 'section';
    const open = section ? !state.hidden.has(item.wbs) : isOpen(item);
    const light = LIGHT[state.lens === 'owner' && !section ? 'owner' : 'section'].includes(section ? item.index : person(item.owner).index);
    const classes = ['crow', 'kind-' + kind];
    if (item.critical) classes.push('is-critical');
    if (state.selected === item.wbs) classes.push('is-selected');
    const style = [
      `--c:${state.lens === 'owner' && !section ? `var(--o${person(item.owner).index})` : `var(--s${item.index})`}`,
      `--o:var(--o${person(item.owner).index})`,
      light ? '--on:rgba(22,17,4,.84);--on-shadow:none' : '',
      `--i:${Math.min(order, 18)}`
    ].filter(Boolean).join(';');
    const label = kind === 'operation'
      ? `${item.wbs} ${item.title}, ${item.owner}, ${when(item)}, ${hours(item.hours)}`
      : `${item.wbs} ${item.title}, ${item.owner}, ${span(item.first, item.last)}`;

    let rail, plot;
    if (section) {
      rail = `<div class="crail">${caret(item, open, `раздел ${item.wbs}`)}
        <button type="button" class="crow-btn" data-select="${item.wbs}" aria-label="${esc(label)}">
          <span class="num" aria-hidden="true">${item.wbs}</span>
          <span class="avatar" aria-hidden="true">${initials(item.owner)}</span>
          <span class="title">${esc(item.title)}</span>
        </button></div>`;
      plot = summary(item);
    } else if (kind === 'package') {
      rail = `<div class="crail">${caret(item, open, `операции пакета ${item.wbs}`)}
        <button type="button" class="crow-btn" data-select="${item.wbs}" aria-label="${esc(label)}">
          <span class="avatar" aria-hidden="true">${initials(item.owner)}</span>
          <span class="wbs">${item.wbs}</span>
          <span class="title">${esc(item.title)}</span>
        </button></div>`;
      if (open) {
        plot = summary(item);
      } else {
        plot = bar(item, xDay(item.first), xEnd(item.last) - xDay(item.first), days(item.length));
        const lateFinish = item.late === undefined ? null : item.late + item.length - 1;
        if (lateFinish > item.last) {
          plot = `<span class="slack" style="left:${xEnd(item.last)}px;width:${xEnd(lateFinish) - xEnd(item.last)}px"></span>` + plot;
        }
      }
    } else {
      rail = `<div class="crail">
        <button type="button" class="crow-btn is-op" data-select="${item.wbs}" aria-label="${esc(label)}">
          <span class="wbs">${item.wbs}</span>
          <span class="title">${esc(item.title)}</span>
          <span class="meta"><i class="dot" aria-hidden="true"></i>${item.hours} ч</span>
        </button></div>`;
      plot = bar(item, xStamp(item.start), xStamp(item.finish) - xStamp(item.start), `${item.hours} ч`, 'bar-op', 30);
    }
    return `<div class="${classes.join(' ')}" data-wbs="${item.wbs}" style="${style}">${rail}<div class="cplot">${plot}</div></div>`;
  }

  // ---- Шапка шкалы ----
  function renderHead() {
    const width = state.width;
    let months = '';
    for (let offset = 0; offset < model.days;) {
      const current = date(model.start + offset);
      const next = Math.round(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1) / DAY) - model.start;
      const length = Math.min(model.days, next) - offset;
      months += `<span class="month" style="left:${xDay(model.start + offset)}px;width:${length * width}px">${MONTHS[current.getUTCMonth()]} ${current.getUTCFullYear()}</span>`;
      offset += length;
    }
    let daysRow = '';
    if (width >= 16) {
      for (let offset = 0; offset < model.days; offset++) {
        const index = model.start + offset, weekday = (index + 4) % 7;
        const classes = ['day', weekday === 0 || weekday === 6 ? 'is-off' : '', index === today.day ? 'is-today' : ''].filter(Boolean).join(' ');
        daysRow += `<span class="${classes}" style="left:${xDay(index)}px;width:${width}px">${width >= 26 ? `<small>${WEEKDAYS[weekday]}</small>` : ''}<b>${date(index).getUTCDate()}</b></span>`;
      }
    } else {
      for (let offset = 0; offset < model.days; offset += 7) {
        const from = model.start + offset, to = Math.min(model.end, from + 6);
        daysRow += `<span class="week" style="left:${xDay(from)}px;width:${(to - from + 1) * width}px">${dm(from)} – ${dm(to)}</span>`;
      }
    }
    const gates = model.milestones.map(item => {
      const classes = ['ms', item.critical ? 'is-critical' : '', state.selected === item.wbs ? 'is-selected' : ''].filter(Boolean).join(' ');
      return `<button type="button" class="${classes}" data-select="${item.wbs}" data-tip="${item.wbs}" data-wbs="${item.wbs}" style="left:${xEnd(item.last)}px" aria-label="Веха ${item.wbs}: ${esc(item.title)}, ${longYear(item.last)}"><i aria-hidden="true"></i><span aria-hidden="true">${item.wbs}</span></button>`;
    }).join('');
    head.innerHTML = `<div class="ch-rail">ИСР · Работа</div><div class="ch-time">${months}${daysRow}${gates}</div>`;
  }

  // ---- Линии-ориентиры: границы месяцев, вехи, сегодня ----
  function guidesHTML(height) {
    let lines = '';
    for (let index = model.start + 1; index <= model.end; index++) {
      if (date(index).getUTCDate() === 1) lines += `<line class="g-month" x1="${xDay(index)}" x2="${xDay(index)}" y1="0" y2="${height}"/>`;
    }
    for (const item of model.milestones) {
      const classes = ['g-gate', item.critical ? 'is-critical' : '', state.selected === item.wbs ? 'is-on' : ''].filter(Boolean).join(' ');
      lines += `<line class="${classes}" x1="${xEnd(item.last)}" x2="${xEnd(item.last)}" y1="0" y2="${height}"/>`;
    }
    if (todayPart !== null) {
      const x = PAD + (today.day - model.start + todayPart) * state.width;
      lines += `<line class="g-today" x1="${n(x)}" x2="${n(x)}" y1="0" y2="${height}"/>`;
    }
    return `<svg class="guides" width="${chartWidth()}" height="${height}" aria-hidden="true">${lines}</svg>`;
  }

  // ---- Связи ----
  // Стык «финиш → старт» без запаса времени: линия проходит у стыка и входит в начало следующей работы.
  function edgePath(x1, y1, x2, y2) {
    if (y2 === 0) {
      if (Math.abs(x2 - x1) < 2) return `M${n(x1)},${n(y1)}V0`;
      const r = Math.min(6, Math.abs(x2 - x1) / 2), sign = x2 > x1 ? 1 : -1;
      return `M${n(x1)},${n(y1)}H${n(x2 - sign * r)}Q${n(x2)},${n(y1)} ${n(x2)},${n(y1 - r)}V0`;
    }
    if (x2 - x1 >= 14) {
      const mid = x1 + Math.min(12, (x2 - x1) / 2), sign = y2 > y1 ? 1 : -1, r = Math.min(5, Math.abs(y2 - y1) / 2);
      return `M${n(x1)},${n(y1)}H${n(mid - r)}Q${n(mid)},${n(y1)} ${n(mid)},${n(y1 + sign * r)}V${n(y2 - sign * r)}Q${n(mid)},${n(y2)} ${n(mid + r)},${n(y2)}H${n(x2)}`;
    }
    return `M${n(x1)},${n(y1)}H${n(x1 - 3)}V${n(y2)}H${n(x2)}`;
  }

  function edgesHTML(rows) {
    if (!state.links) return '';
    const y = new Map();
    let height = 0;
    for (const row of rows) {
      y.set(row.item.wbs, height + ROW_HEIGHT[row.kind] / 2);
      height += ROW_HEIGHT[row.kind];
    }
    const focusKey = state.hovered ?? state.selected;
    const focusItem = focusKey ? model.byWbs.get(focusKey) : null;
    const route = state.route === null ? null : model.routes[state.route];
    const detailed = rows.some(row => row.kind === 'operation');
    const edges = [];
    const add = (from, to, kind, hot) => edges.push({ from, to, kind, hot });
    const onRoute = (from, to) => route !== null && route[route.indexOf(from.wbs) + 1] === to.wbs;

    for (const link of model.links) {
      if (!y.has(link.from.wbs) || (link.to.type !== 'milestone' && !y.has(link.to.wbs))) continue;
      const hot = focusItem === link.from || focusItem === link.to || onRoute(link.from, link.to);
      // Связи пакетов показываются всегда, кроме режима операций: там — только вокруг выбранного.
      if (hot || !detailed || state.handoffs) {
        add(link.from, link.to, link.critical ? 'crit' : link.to.type === 'milestone' ? 'gate' : 'flow', hot);
      }
    }
    if (detailed) {
      for (const operation of model.operations) {
        if (!y.has(operation.wbs)) continue;
        for (const wbs of [...operation.pred, ...(operation.queue ? [operation.queue] : [])]) {
          const previous = model.byWbs.get(wbs);
          if (!y.has(wbs)) continue;
          const handoff = operation.pred.includes(wbs);
          const hot = focusItem === operation || focusItem === previous;
          if (hot || (handoff && state.handoffs)) add(previous, operation, handoff ? 'op' : 'queue', hot);
        }
      }
    }

    const anyHot = edges.some(edge => edge.hot);
    const layer = { flow: 0, op: 0, gate: 1, queue: 1, crit: 2 };
    edges.sort((a, b) => Number(a.hot) - Number(b.hot) || layer[a.kind] - layer[b.kind]);
    const markers = ['flow', 'crit', 'gate', 'op', 'queue'].map(kind =>
      `<marker id="arrow-${kind}" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="var(--edge-${kind})"/></marker>`).join('');
    const paths = edges.map(edge => {
      const { from, to } = edge;
      const x1 = from.type === 'operation' ? xStamp(from.finish) - 1 : xEnd(from.last) - 1;
      const x2 = to.type === 'milestone' ? xEnd(to.last) : to.type === 'operation' ? xStamp(to.start) + 1 : xDay(to.first) + 1;
      const y2 = to.type === 'milestone' ? 0 : y.get(to.wbs);
      const opacity = anyHot ? (edge.hot ? 1 : 0.1) : edge.kind === 'crit' ? 0.8 : edge.kind === 'gate' ? 0.5 : 0.7;
      return `<path class="edge e-${edge.kind}${edge.hot ? ' is-hot' : ''}" d="${edgePath(x1, y.get(from.wbs), x2, y2)}" marker-end="url(#arrow-${edge.kind})" opacity="${opacity}"/>`;
    }).join('');
    return `<svg class="edges" width="${chartWidth()}" height="${height}" aria-hidden="true"><defs>${markers}</defs>${paths}</svg>`;
  }

  function drawEdges() {
    $('.edges')?.remove();
    body.insertAdjacentHTML('beforeend', edgesHTML(visibleRows()));
  }

  // ---- Акценты: выбранная строка и то, что с ней связано ----
  function relations(key) {
    const map = new Map();
    const item = key ? model.byWbs.get(key) : null;
    if (!item) return map;
    map.set(item.wbs, 'focus');
    // Связи пакетов и вех — в полях incoming/outgoing, у операций — pred и succ.
    for (const link of item.incoming ?? []) map.set(link.from.wbs, 'near');
    for (const link of item.outgoing ?? []) map.set(link.to.wbs, 'near');
    if (item.type === 'section') item.packages.forEach(child => map.set(child.wbs, 'near'));
    if (item.type === 'package') {
      map.set(item.parent, 'near');
      item.operations.forEach(child => map.set(child.wbs, 'near'));
    }
    if (item.type === 'operation') {
      map.set(item.parent, 'near');
      [...item.pred, ...item.succ, item.queue].forEach(wbs => { if (wbs) map.set(wbs, 'near'); });
    }
    return map;
  }

  function applyEmphasis() {
    const route = state.route === null ? null : model.routes[state.route];
    const selected = relations(state.selected);
    const hovered = relations(state.hovered);
    const near = hovered.size ? hovered : selected;
    for (const element of body.querySelectorAll('.crow')) {
      const wbs = element.dataset.wbs;
      const item = model.byWbs.get(wbs);
      let away = state.selected !== null && !selected.has(wbs);
      let soft = false;
      if (route) away = !route.includes(wbs);
      else if (state.critical) {
        if (item.type === 'operation') soft = model.byWbs.get(item.parent).critical;
        else if (item.type === 'section') away = !item.packages.some(child => child.critical);
        else away = !item.critical;
      }
      element.classList.toggle('is-focus', near.get(wbs) === 'focus');
      element.classList.toggle('is-near', near.get(wbs) === 'near');
      // Наведённая строка и её окружение видны всегда, даже при выбранной другой строке.
      element.classList.toggle('is-away', away && near.get(wbs) === undefined);
      element.classList.toggle('is-soft', soft);
    }
    drawEdges();
  }

  // ---- Отрисовка ----
  function render() {
    tooltip.hidden = true;
    // Строки перестроены: наведение читаем заново по позиции курсора, а не по старому событию.
    const focused = scroll.contains(document.activeElement);
    state.hovered = $('#scroll .crow:hover, #scroll .ms:hover')?.dataset.wbs ?? null;
    const rows = visibleRows();
    chart.style.setProperty('--W', state.width + 'px');
    chart.style.setProperty('--days', model.days);
    renderHead();
    let height = 0;
    body.innerHTML = rows.map((row, index) => {
      height += ROW_HEIGHT[row.kind];
      return rowHTML(row, index);
    }).join('') + guidesHTML(height);
    syncControls(rows);
    renderLegend();
    renderInspector();
    for (const gate of document.querySelectorAll('.gate')) gate.classList.toggle('is-selected', gate.dataset.select === state.selected);
    root.classList.toggle('is-focus-mode', state.critical || state.route !== null);
    if (focused) scroll.focus({ preventScroll: true });
    applyEmphasis();
  }

  function fitWidth() {
    return clamp(Math.floor((scroll.clientWidth - railWidth() - PAD * 2 - 2) / model.days), MIN_WIDTH, MAX_WIDTH);
  }

  // Автоматический масштаб: пакеты вписываются целиком, операции крупнее — чтобы читались часы.
  function autoWidth() {
    const fit = fitWidth();
    return state.wide ? clamp(Math.round(fit * 2.4), 28, 60) : fit;
  }

  function layout() {
    if (matchMedia('(min-width: 1101px)').matches) {
      const top = workspace.getBoundingClientRect().top + window.scrollY;
      workspace.style.height = Math.max(540, window.innerHeight - top - 20) + 'px';
    } else {
      workspace.style.height = '';
    }
    if (state.fitted) state.width = autoWidth();
    render();
    // Полоса прокрутки могла появиться после отрисовки и сузить шкалу.
    if (state.fitted && autoWidth() !== state.width) {
      state.width = autoWidth();
      render();
    }
  }

  // ---- Панель управления ----
  function syncControls(rows) {
    const opened = model.packages.filter(isOpen).length;
    $('#handoffs').hidden = !rows.some(row => row.kind === 'operation');
    $('[data-level="packages"]').setAttribute('aria-pressed', String(opened === 0));
    $('[data-level="operations"]').setAttribute('aria-pressed', String(opened === model.packages.length));
    $('[data-lens="section"]').setAttribute('aria-pressed', String(state.lens === 'section'));
    $('[data-lens="owner"]').setAttribute('aria-pressed', String(state.lens === 'owner'));
    $('#critical').setAttribute('aria-pressed', String(state.critical));
    $('#links').setAttribute('aria-pressed', String(state.links));
    $('#handoffs').setAttribute('aria-pressed', String(state.handoffs));
    $('#zoom-in').disabled = state.width >= MAX_WIDTH;
    $('#zoom-out').disabled = state.width <= MIN_WIDTH;
    $('#zoom-fit').disabled = state.fitted;
  }

  function renderLegend() {
    const colors = state.lens === 'owner'
      ? model.team.map(item => [item.name, `var(--o${item.index})`])
      : model.sections.map(item => [`${item.wbs} · ${LEGEND_SECTION[item.wbs]}`, `var(--s${item.index})`]);
    const items = colors.map(([name, color]) => `<span><i class="sw" style="--c:${color}"></i>${esc(name)}</span>`);
    items.push(`<button type="button" class="legend-btn" data-action="critical" aria-pressed="${state.critical}"><i class="sw sw-crit"></i>без резерва до M4</button>`);
    items.push('<span><i class="dia"></i>веха</span>', '<span><i class="arrow"></i>передача результата</span>');
    if (todayPart !== null) items.push('<span><i class="vline"></i>сегодня</span>');
    legend.innerHTML = items.join('');
  }

  // ---- Панель деталей ----
  const ref = (wbs, text) => `<button type="button" class="ref" data-select="${wbs}">${text ?? `<b>${wbs}</b> ${esc(model.byWbs.get(wbs).title)}`}</button>`;
  const route = path => path.map(wbs => ref(wbs, `<b>${wbs}</b>`)).join('<span class="flow-arrow" aria-hidden="true">→</span>');
  const list = items => items.length ? `<ul class="list">${items.join('')}</ul>` : '';
  const actions = item => `<div class="actions">${item.issue ? `<a class="btn" href="${ISSUE}${item.issue}" target="_blank" rel="noopener">Карточка #${item.issue} ↗</a>` : ''}<button type="button" class="btn" data-action="copy">Скопировать ссылку</button></div>`;
  const card = (item, eyebrow, extra) => {
    const who = person(item.owner);
    return `<p class="eyebrow">${eyebrow}</p><h2>${esc(item.title)}</h2>
      <div class="owner"><span class="avatar" style="--o:var(--o${who.index})" aria-hidden="true">${initials(item.owner)}</span><span class="who">${esc(item.owner)}${who.role ? `<small>${esc(who.role)}</small>` : ''}</span></div>${extra}`;
  };

  function reserveHTML(item) {
    if (item.critical) return '<p class="pills"><span class="pill pill-crit">Без резерва до M4</span></p>';
    if (item.float === null) {
      return item.gates.length
        ? `<p class="pills"><span class="pill">Резерв до защиты не рассчитывается</span></p><p class="note">Пакет закрывается вехой ${item.gates.map(gate => gate.wbs).join(', ')} и в сеть до M4 не входит.</p>`
        : '<p class="pills"><span class="pill">Резерв не ограничен</span></p><p class="note">Зависимых работ в сети нет.</p>';
    }
    const note = item.first >= item.late
      ? 'Плановый старт уже использует весь запас: отложить пакет нельзя.'
      : 'Пакет можно сдвинуть на этот срок без ущерба для защиты.';
    return `<p class="pills"><span class="pill pill-ok">Резерв ${days(item.float)}</span></p><p class="note">${note}</p>`;
  }

  function itemHTML(item) {
    if (item.type === 'section') {
      return card(item, `Раздел ИСР ${item.wbs}`, `
        <dl class="facts"><dt>Срок</dt><dd>${span(item.first, item.last)}</dd><dt>Состав</dt><dd>${nouns(item.packages.length, ['пакет', 'пакета', 'пакетов'])} · ${hours(item.effort)}</dd></dl>
        <h3>Пакеты</h3>${list(item.packages.map(child => `<li>${ref(child.wbs)}<small>${esc(child.owner)} · ${span(child.first, child.last)}${child.critical ? ' · без резерва' : ''}</small></li>`))}
        ${actions(item)}`);
    }
    if (item.type === 'package') {
      const waiting = item.outgoing.filter(link => link.to.type === 'package');
      return card(item, `Пакет ${item.wbs} · ${SHORT_SECTION[item.parent]}`, `
        <dl class="facts"><dt>Срок</dt><dd>${span(item.first, item.last)} · ${days(item.length)}</dd><dt>Участники</dt><dd>${esc(item.participants || '—')}</dd><dt>Состав</dt><dd>${nouns(item.operations.length, ['операция', 'операции', 'операций'])} · ${hours(item.effort)}</dd></dl>
        ${reserveHTML(item)}
        <h3>Готово, когда</h3><p>${esc(item.result)}</p>
        <h3>Операции</h3>${list(item.operations.map(operation => `<li>${ref(operation.wbs)}<small>${when(operation)} МСК · ${esc(operation.owner)} · ${hours(operation.hours)}</small></li>`))}
        ${item.incoming.length ? `<h3>После каких работ</h3>${list(item.incoming.map(link => `<li>${ref(link.from.wbs)}</li>`))}` : ''}
        ${waiting.length ? `<h3>Что ждут</h3>${list(waiting.map(link => `<li>${ref(link.to.wbs)}</li>`))}` : ''}
        ${item.gates.length ? `<h3>Сдаётся на веху</h3>${list(item.gates.map(gate => `<li>${ref(gate.wbs, `<b>${gate.wbs}</b> ${esc(gate.title)}`)}<small>${longYear(gate.last)}</small></li>`))}` : ''}
        ${actions(item)}`);
    }
    if (item.type === 'milestone') {
      return card(item, `Веха приёмки · ${dmy(item.last)}`, `
        <dl class="facts"><dt>Дата</dt><dd>${longYear(item.last)}</dd><dt>Место в сети</dt><dd>${item.critical ? '<span class="text-crit">Конец критического пути</span>' : 'Не связана с M4'}</dd></dl>
        <h3>Предмет приёмки</h3><p>${esc(item.title)}</p>
        <h3>Проверяют результаты пакетов</h3>${list(item.checks.map(child => `<li>${ref(child.wbs)}<small>${span(child.first, child.last)} · ${esc(child.owner)}${child.critical ? ' · без резерва' : ''}</small></li>`))}
        ${actions(item)}`);
    }
    return card(item, `Операция ${item.wbs} · пакет ${item.parent}`, `
      <dl class="facts"><dt>Время</dt><dd>${when(item)} МСК</dd><dt>Оценка</dt><dd>${hours(item.hours)}</dd><dt>Резерв</dt><dd>${item.slack ? hours(item.slack) : '<span class="text-crit">0 — без запаса</span>'}</dd></dl>
      <h3>Результат</h3><p>${esc(item.result)}</p>
      <h3>Что получает на вход</h3>${item.pred.length ? list(item.pred.map(wbs => `<li>${ref(wbs)}<small>${esc(model.byWbs.get(wbs).result)}</small></li>`)) : '<p class="note">Входов нет — операция стартует сразу.</p>'}
      <h3>Кому передаёт результат</h3>${item.succ.length ? list(item.succ.map(wbs => ref(wbs))) : '<p class="note">Зависимых операций в реестре нет.</p>'}
      ${item.queue && !item.pred.includes(item.queue) ? `<h3>Очередь исполнителя</h3><p>Начинает после операции ${ref(item.queue)}: исполнитель один.</p>` : ''}
      ${actions(item)}`);
  }

  function overviewHTML() {
    const m = model.metrics;
    const next = todayInside ? model.milestones.find(item => item.last >= today.day) : null;
    const word = plural(m.routes, ['маршрут', 'маршрута', 'маршрутов']);
    return `
      <p class="eyebrow">Обзор</p>
      <h2>Как читать диаграмму</h2>
      <ul class="hints">
        <li><i class="sw" style="--c:var(--s4)"></i>Полоса — пакет работ, тонкая с засечками — раздел или раскрытый пакет. Цвет — ${state.lens === 'owner' ? 'исполнитель' : 'раздел'}.</li>
        <li><i class="sw sw-crit"></i>Красная обводка — нет резерва до защиты: задержка сдвигает M4.</li>
        <li><i class="dia"></i>Ромб — веха приёмки, пунктир — её дата. Стрелка — передача результата «финиш → старт».</li>
        <li><i class="caret-icon" aria-hidden="true">${CHEVRON}</i>Стрелка слева от названия раскрывает операции с часами и исполнителями.</li>
      </ul>
      <section class="block">
        <div class="block-head"><h3>Критический путь</h3><button type="button" class="chip" data-action="critical" aria-pressed="${state.critical}">${state.critical ? 'Скрыть' : 'Показать'}</button></div>
        <p><b>${days(m.criticalDays)}</b> от ${long(model.start)} до ${long(model.end)}. <b>${m.routes}</b> ${word} одинаковой длины: задержка любого пакета без резерва сдвигает защиту.</p>
        <p class="route">${route(model.routes[0] ?? [])}</p>
        <details class="routes"${state.showRoutes ? ' open' : ''}><summary>Все ${m.routes} ${word}</summary>
          <ol>${model.routes.map((path, index) => `<li><button type="button" class="route-btn${state.route === index ? ' is-active' : ''}" data-route="${index}">${route(path)}</button></li>`).join('')}</ol>
          <p class="note">Маршрут можно оставить на диаграмме один.</p>
        </details>
      </section>
      ${next ? `<section class="block"><h3>Ближайшая веха</h3><p>${ref(next.wbs, `<b>${next.wbs}</b>`)} · ${longYear(next.last)} · ${next.last === today.day ? 'сегодня' : 'через ' + days(next.last - today.day)}</p><p class="note">${esc(next.title)}</p></section>` : ''}
      <p class="note">Снимок реестров от ${dmy(dayIndex(data.meta.generated))}. Даты базовые и включительные, резерв рассчитан методом CPM от вехи M4.</p>`;
  }

  function renderInspector() {
    const item = state.selected ? model.byWbs.get(state.selected) : null;
    inspectorBody.innerHTML = item ? itemHTML(item) : overviewHTML();
    inspector.classList.toggle('is-open', !!item);
    inspector.scrollTop = 0;
  }

  // ---- Сводка над диаграммой и загрузка ----
  function renderSummary() {
    const m = model.metrics;
    $('#lede').textContent = `${longYear(model.start)} — ${longYear(model.end)} · ${days(model.days)} · базовый календарь`;
    const tiles = [
      [m.criticalDays, plural(m.criticalDays, ['день', 'дня', 'дней']), 'критический путь'],
      [m.routes, '', 'маршруты до M4'],
      [m.packages, '', 'пакеты работ'],
      [m.operations, '', `операции · ${m.hours} ч`]
    ];
    // Пятая плитка — где план находится сегодня: сколько дней до ближайшей вехи.
    const next = todayInside ? model.milestones.find(item => item.last >= today.day) : null;
    if (next) {
      const left = next.last - today.day;
      tiles.push(left ? [left, plural(left, ['день', 'дня', 'дней']), `до вехи ${next.wbs}`] : [next.wbs, '', `веха сегодня · ${dm(next.last)}`]);
    }
    $('#kpis').innerHTML = tiles.map(([value, unit, label], index) =>
      `<div class="kpi${next && index === tiles.length - 1 ? ' is-today' : ''}"><dd>${value}${unit ? `<small>${unit}</small>` : ''}</dd><dt>${label}</dt></div>`).join('');
    $('#gates').innerHTML = model.milestones.map(item => `<button type="button" class="gate${item.critical ? ' is-critical' : ''}" data-select="${item.wbs}" title="Веха ${item.wbs}, ${longYear(item.last)}: ${esc(item.title)}" aria-label="Веха ${item.wbs}, ${longYear(item.last)}: ${esc(item.title)}"><i aria-hidden="true"></i><b>${item.wbs}<span>${dm(item.last)}</span></b><span>${esc(item.title)}</span></button>`).join('');
    for (const who of model.team) ownerSelect.append(new Option(who.role ? `${who.name} · ${who.role}` : who.name, who.name));
    $('#footer-note').textContent = `Снимок реестров от ${dmy(dayIndex(data.meta.generated))}: ${m.packages} пакетов, ${m.operations} операций, ${m.hours} чел.-ч, ${m.links} связей «финиш → старт». Операции показаны в расчётном окне ${data.window.from}–${data.window.to} МСК.`;
  }

  function renderLoad() {
    const weeks = Math.ceil(model.days / 7);
    const capacity = (model.window.to - model.window.from) / 60 * 7;
    const load = new Map(model.team.map(who => [who.name, new Array(weeks).fill(0)]));
    for (const operation of model.operations) {
      const shares = dayHours(operation.start, operation.finish, model.window);
      const total = shares.reduce((sum, share) => sum + share.hours, 0);
      for (const { day, hours: part } of shares) load.get(operation.owner)[Math.floor((day - model.start) / 7)] += operation.hours * part / total;
    }
    const columns = [''].concat(Array.from({ length: weeks }, (_, week) => {
      const from = model.start + week * 7, to = Math.min(model.end, from + 6);
      return `${dm(from)} – ${dm(to)}`;
    }), ['всего']);
    let html = columns.map(text => `<span class="load-h">${text}</span>`).join('');
    for (const who of model.team) {
      const color = `var(--o${who.index})`;
      const values = load.get(who.name);
      html += `<span class="load-who"><span class="avatar" style="--o:${color}" aria-hidden="true">${initials(who.name)}</span><span>${esc(who.name)}</span></span>`;
      html += values.map(value => value < 0.5
        ? '<span class="load-cell is-empty"><span>—</span></span>'
        : `<span class="load-cell" style="--o:${color};--v:${Math.min(1, value / capacity).toFixed(3)}"><i></i><span>${Math.round(value)}</span></span>`).join('');
      html += `<span class="load-total">${Math.round(values.reduce((sum, value) => sum + value, 0))} ч</span>`;
    }
    const grid = $('#load');
    grid.innerHTML = html;
    grid.style.setProperty('--weeks', weeks);
    $('#load-note').textContent = `Человеко-часы за расчётную неделю: ${hours(capacity)} при окне ${data.window.from}–${data.window.to} МСК и включённых выходных.`;
  }

  // ---- Подсказка у курсора ----
  function tooltipHTML(item) {
    if (item.type === 'package') {
      const reserve = item.critical ? '<br><span class="crit">Без резерва до M4</span>' : item.float > 0 ? `<br>Резерв ${days(item.float)}` : '';
      return `<b>${item.wbs} · ${esc(item.title)}</b>${span(item.first, item.last)} · ${days(item.length)}<br>${esc(item.owner)}${reserve}`;
    }
    if (item.type === 'section') {
      return `<b>Раздел ${item.wbs} · ${esc(item.title)}</b>${span(item.first, item.last)}<br>${esc(item.owner)} · ${nouns(item.packages.length, ['пакет', 'пакета', 'пакетов'])}`;
    }
    if (item.type === 'milestone') {
      return `<b>${item.wbs} · ${esc(item.title)}</b>${longYear(item.last)}<br>Приёмка: ${item.checks.map(child => child.wbs).join(', ')}`;
    }
    return `<b>${item.wbs} · ${esc(item.title)}</b>${when(item)} МСК · ${hours(item.hours)}<br>${esc(item.owner)} · резерв ${item.slack ? hours(item.slack) : '0'}`;
  }

  function moveTooltip(event) {
    if (tooltip.hidden) return;
    const gap = 14, box = tooltip.getBoundingClientRect();
    let left = event.clientX + gap, top = event.clientY + gap;
    if (left + box.width > window.innerWidth - 8) left = event.clientX - box.width - gap;
    if (top + box.height > window.innerHeight - 8) top = event.clientY - box.height - gap;
    tooltip.style.left = Math.max(8, left) + 'px';
    tooltip.style.top = Math.max(8, top) + 'px';
  }

  // ---- Действия ----
  function syncHash() {
    const hash = state.selected ? '#' + encodeURIComponent(state.selected) : '';
    try { history.replaceState(null, '', location.pathname + location.search + hash); } catch { /* часть браузеров запрещает замену адреса для file:// */ }
  }

  function reveal(key) {
    const item = model.byWbs.get(key);
    const element = body.querySelector(`.crow[data-wbs="${CSS.escape(key)}"]`);
    if (element) {
      const box = element.getBoundingClientRect(), view = scroll.getBoundingClientRect();
      if (box.top < view.top + HEAD || box.bottom > view.bottom) scroll.scrollTop += box.top - view.top - HEAD - 4;
    }
    const first = item.type === 'milestone' ? xEnd(item.last) : item.type === 'operation' ? xStamp(item.start) : xDay(item.first);
    const last = item.type === 'milestone' ? first : item.type === 'operation' ? xStamp(item.finish) : xEnd(item.last);
    const from = scroll.scrollLeft + railWidth(), to = scroll.scrollLeft + scroll.clientWidth;
    if (first < from + 24 || last > to - 24) scroll.scrollLeft = Math.max(0, first - railWidth() - 80);
  }

  function select(key, { toggle = true, reveal: show = false } = {}) {
    const item = model.byWbs.get(key);
    if (!item) return;
    if (toggle && state.selected === key) return clear();
    const section = item.type === 'operation' ? model.byWbs.get(item.parent).parent : item.parent;
    if (item.type === 'operation') state.expanded.add(item.parent);
    // Фильтр мешает показать строку — снимаем его.
    if (state.owner && (item.type === 'section' ? !item.packages.some(showsOwner) : !showsOwner(item))) setOwner('');
    if (section) state.hidden.delete(section);
    state.selected = key;
    state.route = null;
    render();
    syncHash();
    if (show) reveal(key);
  }

  function clear() {
    if (state.selected === null) return;
    state.selected = null;
    render();
    syncHash();
  }

  function toggle(key) {
    const item = model.byWbs.get(key);
    if (!item) return;
    const set = item.type === 'section' ? state.hidden : state.expanded;
    if (set.has(key)) set.delete(key); else set.add(key);
    render();
  }

  function setLevel(level) {
    const operations = level === 'operations';
    state.expanded = operations ? new Set(model.packages.map(item => item.wbs)) : new Set();
    state.wide = operations;
    if (state.fitted) state.width = autoWidth();
    render();
  }

  function setLens(lens) {
    state.lens = lens;
    savePrefs();
    render();
  }

  function setOwner(name) {
    state.owner = name;
    ownerSelect.value = name;
    render();
  }

  function setCritical(on) {
    state.critical = on;
    if (on) state.route = null;
    render();
  }

  function setRoute(index) {
    state.route = state.route === index ? null : index;
    if (state.route !== null) state.critical = false;
    render();
  }

  function zoom(next) {
    state.width = clamp(Math.round(next), MIN_WIDTH, MAX_WIDTH);
    state.fitted = false;
    render();
  }

  function copyLink(button) {
    const url = `${location.href.split('#')[0]}#${encodeURIComponent(state.selected)}`;
    const done = () => {
      const text = button.textContent;
      button.textContent = 'Ссылка скопирована';
      button.disabled = true;
      setTimeout(() => { button.textContent = text; button.disabled = false; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, () => window.prompt('Скопируйте ссылку', url));
    } else {
      window.prompt('Скопируйте ссылку', url);
    }
  }

  function applyTheme() {
    root.dataset.theme = state.theme;
    $('#theme').innerHTML = state.theme === 'dark' ? SUN : MOON;
    $('#theme').setAttribute('aria-label', state.theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему');
  }

  // ---- События ----
  scroll.addEventListener('click', event => {
    const control = event.target.closest('[data-toggle], [data-select]');
    if (!control) return clear();
    if (control.hasAttribute('data-toggle')) toggle(control.dataset.toggle);
    else select(control.dataset.select, { reveal: true });
  });

  scroll.addEventListener('pointerover', event => {
    const tip = event.target.closest('[data-tip]');
    if (tip && model.byWbs.has(tip.dataset.tip)) showTooltip(model.byWbs.get(tip.dataset.tip), event);
    else tooltip.hidden = true;
    const row = event.target.closest('.crow, .ms');
    const key = row ? row.dataset.wbs : null;
    if (key !== state.hovered) {
      state.hovered = key;
      applyEmphasis();
    }
  });
  scroll.addEventListener('pointermove', moveTooltip);
  scroll.addEventListener('pointerleave', () => {
    tooltip.hidden = true;
    if (state.hovered !== null) {
      state.hovered = null;
      applyEmphasis();
    }
  });

  function showTooltip(item, event) {
    tooltip.innerHTML = tooltipHTML(item);
    tooltip.hidden = false;
    moveTooltip(event);
  }

  scroll.addEventListener('keydown', event => {
    if (event.key === 'Escape') return clear();
    const vertical = event.key === 'ArrowDown' || event.key === 'ArrowUp';
    const horizontal = event.key === 'ArrowRight' || event.key === 'ArrowLeft';
    const item = state.selected ? model.byWbs.get(state.selected) : null;
    if (vertical) {
      const rows = visibleRows().map(row => row.item.wbs);
      if (!rows.length) return;
      event.preventDefault();
      const index = rows.indexOf(state.selected);
      const next = index === -1
        ? (event.key === 'ArrowDown' ? rows[0] : rows[rows.length - 1])
        : rows[clamp(index + (event.key === 'ArrowDown' ? 1 : -1), 0, rows.length - 1)];
      return select(next, { toggle: false, reveal: true });
    }
    if (item && item.type === 'package' && (horizontal || event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      if (!horizontal || (event.key === 'ArrowRight') !== isOpen(item)) toggle(item.wbs);
    }
  });

  document.addEventListener('click', event => {
    if (scroll.contains(event.target)) return;
    const button = event.target.closest('[data-select], [data-action], [data-route]');
    if (!button) return;
    if (button.dataset.select) select(button.dataset.select, { toggle: false, reveal: true });
    else if (button.dataset.route !== undefined) setRoute(Number(button.dataset.route));
    else if (button.dataset.action === 'critical') setCritical(!state.critical);
    else if (button.dataset.action === 'copy') copyLink(button);
  });

  inspector.addEventListener('toggle', event => {
    if (event.target.classList.contains('routes')) state.showRoutes = event.target.open;
  }, true);
  $('#inspector-close').addEventListener('click', clear);

  for (const button of document.querySelectorAll('[data-level]')) button.addEventListener('click', () => setLevel(button.dataset.level));
  for (const button of document.querySelectorAll('[data-lens]')) button.addEventListener('click', () => setLens(button.dataset.lens));
  ownerSelect.addEventListener('change', () => setOwner(ownerSelect.value));
  $('#critical').addEventListener('click', () => setCritical(!state.critical));
  $('#links').addEventListener('click', () => { state.links = !state.links; render(); });
  $('#handoffs').addEventListener('click', () => { state.handoffs = !state.handoffs; render(); });
  $('#zoom-in').addEventListener('click', () => zoom(state.width * 1.3 + 1));
  $('#zoom-out').addEventListener('click', () => zoom(state.width / 1.3 - 1));
  $('#zoom-fit').addEventListener('click', () => { state.fitted = true; layout(); });
  $('#theme').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    savePrefs();
  });
  // На бумаге тёмная тема не читается: печать всегда светлая.
  let printed = null;
  window.addEventListener('beforeprint', () => {
    printed = state.theme;
    state.theme = 'light';
    applyTheme();
  });
  window.addEventListener('afterprint', () => {
    if (printed === null) return;
    state.theme = printed;
    printed = null;
    applyTheme();
  });

  let frame = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(layout);
  });

  // ---- Запуск ----
  const readHash = () => {
    try { return decodeURIComponent(location.hash.slice(1)); } catch { return ''; }
  };
  applyTheme();
  renderSummary();
  renderLoad();
  chart.classList.add('is-intro');
  setTimeout(() => chart.classList.remove('is-intro'), 1400);
  layout();
  const openFromHash = () => {
    const key = readHash();
    if (key === state.selected) return;
    if (key && model.byWbs.has(key)) select(key, { toggle: false, reveal: true });
    else clear();
  };
  openFromHash();
  window.addEventListener('hashchange', openFromHash);
})();
