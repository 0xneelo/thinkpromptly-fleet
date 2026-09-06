// A page-local script like machines.js. Metadata reaches the DOM only through textContent.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };
  const filters = { search: $('sessions-search'), account: $('sessions-account'), machine: $('sessions-machine'),
    live: $('sessions-live'), archived: $('sessions-archived') };
  const groupsEl = $('desktop-session-groups');
  const refresh = $('sessions-refresh');
  const composer = $('session-composer');
  const send = $('composer-send');
  let data = { groups: [], machines: [] }, loaded = false, loading = false, sending = false;
  let recipient = null;
  let focusReturn = null;
  const accountKey = (g) => g.accountUuid + ':' + g.orgUuid;
  const rowKey = (g, s) => [g.machine, g.accountUuid, g.orgUuid, s.id].join(':');
  const statusText = {
    no_report: 'Waiting for a first collection.',
    not_found: 'No Desktop session directory found.',
    unavailable: 'Collection failed. Previously collected sessions are still shown.',
    partial: 'Some session files could not be read. Previously collected sessions are still shown.',
  };

  let theme = 'dark';
  try {
    const query = new URLSearchParams(location.search).get('theme');
    const saved = localStorage.getItem('fleetTheme');
    theme = query === 'light' || query === 'dark' ? query : saved === 'light' ? 'light' : 'dark';
  } catch { /* Storage can be disabled without disabling the page. */ }
  function applyTheme() {
    document.documentElement.dataset.theme = theme;
    $('sessions-theme').textContent = theme === 'dark' ? 'Light theme' : 'Dark theme';
    $('sessions-theme').setAttribute('aria-pressed', String(theme === 'light'));
  }
  $('sessions-theme').onclick = () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('fleetTheme', theme); } catch {}
    applyTheme();
  };
  applyTheme();

  function age(stamp) {
    if (!stamp) return 'Unknown';
    const date = typeof stamp === 'number' ? stamp : Date.parse(stamp);
    if (!Number.isFinite(date)) return 'Unknown';
    const minutes = Math.floor(Math.max(0, Date.now() - date) / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return minutes + 'm ago';
    if (minutes < 1440) return Math.floor(minutes / 60) + 'h ago';
    return Math.floor(minutes / 1440) + 'd ago';
  }

  function options(select, entries, allLabel) {
    const previous = select.value;
    const blank = el('option', '', allLabel);
    blank.value = '';
    select.replaceChildren(blank, ...entries.map(([value, label]) => {
      const option = el('option', '', label);
      option.value = value;
      return option;
    }));
    // Preserve a now-missing selection so refresh cannot silently widen the user's view.
    if (previous && !entries.some(([value]) => value === previous)) {
      const missing = el('option', '', 'Previously selected (unavailable)');
      missing.value = previous;
      select.append(missing);
    }
    select.value = previous;
  }

  function updateOptions() {
    const accounts = new Map();
    for (const group of data.groups)
      accounts.set(accountKey(group), group.label + ' · ' + group.accountUuid.slice(0, 8));
    options(filters.account, [...accounts].sort((a, b) => a[1].localeCompare(b[1])), 'All accounts');
    options(filters.machine, data.machines.map((m) => [m.id, m.label]), 'All machines');
  }

  function matches(group, session) {
    if (filters.account.value && accountKey(group) !== filters.account.value) return false;
    if (filters.machine.value && group.machine !== filters.machine.value) return false;
    if (filters.live.value && session.liveState !== filters.live.value) return false;
    if (filters.archived.value && session.isArchived !== (filters.archived.value === 'archived')) return false;
    const query = filters.search.value.trim().toLocaleLowerCase();
    return !query || [session.title, session.cwd, session.worktree, session.branch, session.model]
      .some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(query));
  }

  function currentRecipient() {
    if (!recipient) return null;
    for (const group of data.groups) {
      const session = group.sessions.find((s) => rowKey(group, s) === recipient.key);
      if (session) return { group, session };
    }
    return null;
  }

  function updateComposer() {
    if (!recipient) return;
    const current = currentRecipient();
    const live = current?.session.live && current.session.messageTarget &&
      current.session.messageTarget.session === recipient.target.session;
    send.disabled = sending || !live;
    // Availability may change during a send. Keep it separate from the delivery outcome,
    // which must stay visible even if the recipient exits before the POST returns.
    $('composer-availability').textContent = live ? '' : 'This session is no longer available to message.';
  }

  function openComposer(group, session, button) {
    // A new recipient must never inherit a draft intended for someone else.
    const key = rowKey(group, session);
    if (recipient && recipient.key !== key) $('composer-text').value = '';
    recipient = { key, target: session.messageTarget };
    focusReturn = button;
    composer.hidden = false;
    $('composer-title').textContent = 'Message ' + (session.title || 'Untitled session');
    const machine = data.machines.find((m) => m.id === group.machine);
    $('composer-recipient').textContent = [group.label, machine?.label || group.machine, session.liveName].filter(Boolean).join(' · ');
    $('composer-status').textContent = '';
    updateComposer();
    $('composer-text').focus();
    composer.scrollIntoView({ block: 'nearest' });
  }

  $('composer-close').onclick = () => {
    if (sending) return;
    composer.hidden = true;
    if (focusReturn?.isConnected) focusReturn.focus();
    else refresh.focus();
  };

  $('composer-form').onsubmit = async (event) => {
    event.preventDefault();
    const current = currentRecipient();
    if (sending || !current?.session.live || !current.session.messageTarget ||
      current.session.messageTarget.session !== recipient?.target.session) return updateComposer();
    const text = $('composer-text').value.trim();
    if (!text) return;
    sending = true;
    send.disabled = true;
    $('composer-close').disabled = true;
    $('composer-text').disabled = true;
    $('composer-status').textContent = 'Sending…';
    try {
      const response = await fetch('/api/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'desktop-sessions-page', target: recipient.target, text }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error('delivery');
      $('composer-status').textContent = 'Message delivered.';
      $('composer-text').value = '';
    } catch {
      $('composer-status').textContent = 'Message could not be delivered. Your draft is kept; check the Bus before retrying.';
    } finally {
      sending = false;
      $('composer-close').disabled = false;
      $('composer-text').disabled = false;
      updateComposer();
    }
  };

  function sessionContext(group, session) {
    const machine = data.machines.find((m) => m.id === group.machine);
    const lines = [
      ['Title', session.title || 'Untitled session'],
      ['Account', [group.label, group.email, group.accountUuid].filter(Boolean).join(' \u00b7 ')],
      ['Machine', machine?.label || group.machine],
      ['Directory', session.cwd], ['Worktree', session.worktree], ['Branch', session.branch], ['Model', session.model],
      ['Created', session.createdAt], ['Last activity', session.lastActivityAt], ['Turns', session.completedTurns],
      ['Status', session.liveState + (session.isArchived ? ', archived' : '')],
      ['CLI session', session.cliSessionId], ['Session', session.id],
    ];
    return lines.filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([label, value]) => label + ': ' + value).join('\n') + '\n';
  }

  function copyPending(text) {
    // The write starts inside the click, so the user activation the clipboard needs is still
    // live when the text arrives from the fetch. Without ClipboardItem the plain path remains.
    const write = typeof ClipboardItem === 'function'
      ? navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })) })])
      : text.then((t) => navigator.clipboard.writeText(t));
    return write.then(() => true, () => false);
  }

  function sessionElement(group, session) {
    const tr = el('tr');
    const title = el('td', 'desktop-title-cell');
    title.append(el('div', 'desktop-title', session.title || 'Untitled session'));
    if (session.cwd) title.append(el('div', 'desktop-path mono muted', session.cwd));
    const details = el('details', 'desktop-details');
    details.append(el('summary', '', 'Session details'));
    const list = el('dl');
    for (const [label, value] of [['Worktree', session.worktree], ['Created', session.createdAt],
      ['CLI session', session.cliSessionId], ['Session', session.id]]) {
      if (value) list.append(el('dt', 'muted', label), el('dd', 'mono', value));
    }
    const copy = el('button', 'ghost desktop-copy', 'Copy conversation');
    copy.type = 'button';
    copy.setAttribute('aria-label', 'Copy conversation of ' + (session.title || 'Untitled session'));
    copy.onclick = async () => {
      // Not disabled while busy: a disabled button drops keyboard focus.
      if (copy.dataset.busy) return;
      copy.dataset.busy = '1';
      copy.textContent = 'Copying…';
      const params = new URLSearchParams({ machine: group.machine, account: group.accountUuid, org: group.orgUuid, id: session.id });
      const response = fetch('/api/desktop-sessions/transcript?' + params);
      const text = response.then((r) => r.ok ? r.text() : Promise.reject(r.status))
        .then((t) => sessionContext(group, session) + '\n' + t);
      let label = await copyPending(text) ? 'Copied' : 'Copy failed';
      if (label !== 'Copied' && (await response.catch(() => null))?.status === 404) label = 'No transcript';
      copy.textContent = label;
      copy.focus();
      setTimeout(() => { copy.textContent = 'Copy conversation'; delete copy.dataset.busy; }, 1500);
    };
    details.append(list, copy);
    title.append(details);
    const context = el('td', 'desktop-context-cell');
    context.append(el('div', 'mono', session.branch || 'No branch'), el('div', 'muted', session.model || 'Model unknown'));
    const activity = el('td');
    const time = el('time', '', age(session.lastActivityAt));
    if (session.lastActivityAt) { time.dateTime = session.lastActivityAt; time.title = session.lastActivityAt; }
    activity.append(time, el('div', 'muted', session.completedTurns === null ? 'Turns unknown' : session.completedTurns + ' turns'));
    const state = el('td');
    const badges = el('div', 'desktop-badges');
    const live = session.liveState === 'live';
    badges.append(el('span', 'chip' + (live ? ' desktop-live' : ''), live ? 'Live' : session.liveState === 'unknown' ? 'Live unknown' : 'Offline'));
    if (session.isArchived) badges.append(el('span', 'chip', 'Archived'));
    if (session.stale) badges.append(el('span', 'chip desktop-stale', 'Cached'));
    state.append(badges);
    const action = el('td', 'desktop-action-cell');
    if (session.live && session.messageTarget) {
      const button = el('button', 'ghost', 'Message');
      button.type = 'button';
      button.disabled = sending;
      button.setAttribute('aria-label', 'Message ' + (session.title || 'Untitled session'));
      button.onclick = () => { if (!sending) openComposer(group, session, button); };
      action.append(button);
    } else {
      action.append(el('span', 'muted', session.liveState === 'unknown' ? 'Live check unavailable' : 'Not running'));
    }
    tr.append(title, context, activity, state, action);
    return tr;
  }

  function render() {
    const fragment = document.createDocumentFragment();
    let shown = 0, total = 0, live = 0;
    for (const group of data.groups) {
      total += group.sessions.length;
      const sessions = group.sessions.filter((session) => matches(group, session));
      if (!sessions.length) continue;
      shown += sessions.length;
      live += sessions.filter((session) => session.live).length;
      const section = el('section', 'desktop-group');
      const heading = el('header', 'desktop-group-heading');
      const identity = el('div');
      identity.append(el('h2', '', group.label));
      identity.append(el('div', 'muted', [group.email, 'Account ' + group.accountUuid.slice(0, 8)].filter(Boolean).join(' · ')));
      const machine = data.machines.find((m) => m.id === group.machine);
      heading.append(identity, el('span', 'chip', machine?.label || group.machine), el('span', 'muted', sessions.length + ' sessions'));
      const wrap = el('div', 'desktop-table-wrap');
      wrap.tabIndex = 0;
      wrap.setAttribute('role', 'region');
      wrap.setAttribute('aria-label', group.label + ' on ' + (machine?.label || group.machine));
      const table = el('table', 'desktop-table');
      const head = el('thead'), tr = el('tr');
      for (const label of ['Conversation', 'Branch / model', 'Last activity', 'Status', 'Action']) {
        const th = el('th', '', label);
        th.scope = 'col';
        tr.append(th);
      }
      head.append(tr);
      const body = el('tbody');
      for (const session of sessions) body.append(sessionElement(group, session));
      table.append(head, body);
      wrap.append(table);
      section.append(heading, wrap);
      fragment.append(section);
    }
    if (!shown) fragment.append(el('div', 'desktop-empty muted', total
      ? 'No sessions match these filters. Reset filters to see all conversations.'
      : 'No Desktop sessions collected yet. Open a Code tab on a configured machine, then refresh.'));
    groupsEl.replaceChildren(fragment);
    $('sessions-count').textContent = shown + ' of ' + total + ' sessions · ' + live + ' live';
    const last = Math.max(0, ...data.machines.map((m) => m.collected_at || 0));
    $('sessions-updated').textContent = last ? 'Last collection: ' + age(last) : 'No completed collection';
    updateComposer();
  }

  function renderErrors() {
    $('sessions-errors').replaceChildren();
    for (const machine of data.machines) {
      if (machine.state === 'ok' && !machine.stale) continue;
      $('sessions-errors').append(el('p', 'desktop-collection-note', machine.label + ': ' +
        (statusText[machine.state] || 'Cached metadata. Refresh to collect the latest sessions.')));
    }
  }

  async function load(force = false) {
    if (loading) return;
    loading = true;
    refresh.disabled = true;
    refresh.textContent = 'Collecting…';
    groupsEl.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch('/api/desktop-sessions' + (force ? '?refresh=1' : ''));
      if (!response.ok) throw new Error('request');
      const next = await response.json();
      if (!Array.isArray(next.groups) || !Array.isArray(next.machines) ||
        next.groups.some((g) => !g || !Array.isArray(g.sessions))) throw new Error('shape');
      data = next;
      loaded = true;
      updateOptions();
      render();
      renderErrors();
    } catch {
      $('sessions-errors').replaceChildren(el('p', 'desktop-collection-note',
        'Sessions could not be refreshed.' + (loaded ? ' The last view is still shown.' : ' Try Refresh to reconnect.')));
      if (!loaded) {
        $('sessions-count').textContent = 'Sessions unavailable';
        groupsEl.replaceChildren(el('div', 'desktop-empty muted', 'Could not load desktop sessions.'));
      }
    } finally {
      loading = false;
      refresh.disabled = false;
      refresh.textContent = 'Refresh';
      groupsEl.setAttribute('aria-busy', 'false');
    }
  }

  $('sessions-filters').onsubmit = (event) => event.preventDefault();
  for (const [name, filter] of Object.entries(filters)) filter.addEventListener(name === 'search' ? 'input' : 'change', render);
  $('sessions-reset').onclick = () => { for (const filter of Object.values(filters)) filter.value = ''; render(); };
  refresh.onclick = () => load(true);
  setInterval(() => { if (!document.hidden) load(); }, 30000);
  load();
})();
