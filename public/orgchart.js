(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FleetOrgChart = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const SESSION_FIELDS = [
    'host',
    'name',
    'label',
    'role',
    'worker',
    'status',
    'note',
    'group',
    'task',
    'last_seen_at',
    'active_at',
    'msg_at',
    'live',
    'pid',
    'parent_host',
    'parent_name',
    'epoch',
    'lease_state',
    'expires_at',
    'suspect_at',
    'pinger_dead',
  ];
  const SEAT_FIELDS = [
    'seat',
    'owner_host',
    'owner_name',
    'epoch',
    'expires_at',
    'suspect_at',
  ];

  const sessionKey = (row) => row.host + '\0' + row.name;
  const seatKey = (seat) => 'seat\0' + seat;
  const textCompare = (a, b) => String(a || '').localeCompare(String(b || ''), 'en', {
    numeric: true,
    sensitivity: 'base',
  });

  function copyShape(row, fields) {
    const out = {};
    for (const field of fields) out[field] = row?.[field] ?? null;
    return out;
  }

  function sessionRow(row) {
    return copyShape(row, SESSION_FIELDS);
  }

  function seatRow(row) {
    return copyShape(row, SEAT_FIELDS);
  }

  // M11 liveness is deliberately separate from the legacy `live` field. The latter
  // means tmux-live and must remain the gate for opening a terminal in the Windows view.
  function isLive(row) {
    return row?.live === true || row?.lease_state === 'active';
  }

  function stateOf(row) {
    if (row?.lease_state === 'reaped') return row.host === 'mac' ? 'tombstone' : 'reaped';
    if (row?.lease_state === 'suspect') return 'suspect';
    return isLive(row) ? 'active' : 'offline';
  }

  function needsAttention(row, now = Date.now()) {
    const stamp = Date.parse(row?.active_at || row?.last_seen_at || '');
    return Number.isFinite(stamp) && now - stamp >= 15 * 60 * 1000;
  }

  const childSort = (a, b) =>
    textCompare(a.row?.worker || a.row?.name || a.label, b.row?.worker || b.row?.name || b.label) ||
    textCompare(a.row?.host, b.row?.host);

  function buildTree(sessionRows, seatRows) {
    const sessions = (sessionRows || []).map(sessionRow);
    const seats = (seatRows || []).map(seatRow);
    const nodes = new Map(
      sessions.map((row) => [
        sessionKey(row),
        { type: 'session', key: sessionKey(row), row, seat: null, children: [] },
      ])
    );
    const roots = [];
    const unattached = [];
    const assigned = new Set();
    const rootKeys = new Set();

    // A host is a label on a node, never a container: the only roots are seats, and a
    // seat root is the owner session itself once that row exists.
    const seatOrder = { coordinator: 0, orchestrator: 1 };
    seats.sort(
      (a, b) =>
        (seatOrder[a.seat] ?? 99) - (seatOrder[b.seat] ?? 99) || textCompare(a.seat, b.seat)
    );
    for (const row of seats) {
      const owner = nodes.get(sessionKey({ host: row.owner_host, name: row.owner_name }));
      if (owner && !assigned.has(owner.key)) {
        owner.seat = row;
        assigned.add(owner.key);
        rootKeys.add(owner.key);
        roots.push(owner);
      } else if (!owner) {
        roots.push({ type: 'seat-vacant', key: seatKey(row.seat), row: null, seat: row, children: [] });
      } else {
        // Two seat rows naming one owner is a real transient during a handoff. Show the
        // second seat as a conflict rather than dropping it out of the chart.
        roots.push({
          type: 'seat-vacant',
          key: seatKey(row.seat),
          row: null,
          seat: row,
          conflict: true,
          children: [],
        });
      }
    }

    // A cycle member is never attached, so every node in a malformed loop lands in the
    // unattached strip instead of disappearing from the chart. The walk stops at a seat
    // root: a root's own parent edge is not part of the built tree, so a stale pointer
    // from a root into a cycle must not disown that root's real children.
    const wouldCycle = (childKey, parentKey) => {
      const seen = new Set([childKey]);
      let cursor = parentKey;
      while (cursor && nodes.has(cursor)) {
        if (rootKeys.has(cursor)) return false;
        if (seen.has(cursor)) return true;
        seen.add(cursor);
        const row = nodes.get(cursor).row;
        cursor = row.parent_host && row.parent_name
          ? sessionKey({ host: row.parent_host, name: row.parent_name })
          : null;
      }
      return false;
    };

    const ordered = [...nodes.values()].sort(childSort);
    for (const node of ordered) {
      if (assigned.has(node.key)) continue;
      const row = node.row;
      const parentKey = row.parent_host && row.parent_name
        ? sessionKey({ host: row.parent_host, name: row.parent_name })
        : null;
      const parent = parentKey && nodes.get(parentKey);
      if (parent && parent.key !== node.key && !wouldCycle(node.key, parent.key)) {
        parent.children.push(node);
        assigned.add(node.key);
      } else {
        unattached.push(node);
        assigned.add(node.key);
      }
    }

    const sortChildren = (node) => {
      node.children.sort(childSort);
      for (const child of node.children) sortChildren(child);
    };
    for (const rootNode of roots) sortChildren(rootNode);
    unattached.sort(childSort);
    return { roots, unattached };
  }

  // The committed fixture carries exact integer timestamps. Rebase it at preview time
  // so countdown and idle-state evidence stays meaningful long after it was committed.
  function rebaseFixture(fixture, now = Date.now()) {
    const captured = Number(fixture?.captured_at);
    if (!Number.isFinite(captured)) return fixture;
    const shift = now - captured;
    const moveMs = (value) => (Number.isFinite(value) ? value + shift : value);
    const moveIso = (value) => {
      const stamp = Date.parse(value || '');
      return Number.isFinite(stamp) ? new Date(stamp + shift).toISOString() : value;
    };
    return {
      ...fixture,
      sessions: (fixture.sessions || []).map((row) => ({
        ...row,
        expires_at: moveMs(row.expires_at),
        suspect_at: moveMs(row.suspect_at),
        last_seen_at: moveIso(row.last_seen_at),
        active_at: moveIso(row.active_at),
        msg_at: moveIso(row.msg_at),
      })),
      seats: (fixture.seats || []).map((row) => ({
        ...row,
        expires_at: moveMs(row.expires_at),
        suspect_at: moveMs(row.suspect_at),
      })),
    };
  }

  return {
    SESSION_FIELDS,
    SEAT_FIELDS,
    buildTree,
    isLive,
    needsAttention,
    rebaseFixture,
    sessionKey,
    stateOf,
  };
});
