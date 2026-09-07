"""Fixture tests for goalkeeper.py.

Every path here is built under tempfile.mkdtemp(); no test reads the live ~/.claude tree
(TestNoLivePaths asserts it), no test makes a network call, and every sweep passes
--no-fetch so the broker token is never minted.

    python3 -m unittest discover -s mac/claude-home/skills/goalkeeper/tests -v
"""

import contextlib
import datetime as dt
import importlib.util
import io
import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(os.path.dirname(HERE), "goalkeeper.py")

_spec = importlib.util.spec_from_file_location("goalkeeper", SCRIPT)
gk = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gk)

NOW = dt.datetime.now(dt.timezone.utc)
SINCE = gk.iso_z(NOW - dt.timedelta(days=1))
OLD = "2026-08-01T00:00:00Z"


def git(repo, *args, **env):
    full = dict(os.environ)
    full.update({"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
                 "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"})
    full.update(env)
    proc = subprocess.run(["git", "-C", repo] + list(args), env=full,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          universal_newlines=True)
    if proc.returncode != 0:
        raise AssertionError("git %s failed: %s" % (" ".join(args), proc.stdout))
    return proc.stdout


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def dead_pid():
    proc = subprocess.Popen(["/usr/bin/true"])
    proc.wait()
    return proc.pid


def audit_path(out):
    """`audit` prints `<path>  (<n> lines, <n> KB)`."""
    return out.strip().split("  (")[0]


def run_cli(argv, env):
    """Call goalkeeper.main() with the fixture environment. Returns (code, stdout)."""
    old = dict(os.environ)
    os.environ.update(env)
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            code = gk.main(argv)
    finally:
        os.environ.clear()
        os.environ.update(old)
    return code, buf.getvalue()


class Fixture(unittest.TestCase):
    """A data repo, one project repo, a sessions dir, transcripts and a fake mark.sh."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="gk-test-")
        self.addCleanup(shutil.rmtree, self.root, True)
        self.home = os.path.join(self.root, "home")
        self.proj = os.path.join(self.root, "proj")
        self.sessions = os.path.join(self.root, "sessions")
        self.projects = os.path.join(self.root, "projects")
        for path in (self.home, self.proj, self.sessions, self.projects):
            os.makedirs(path)
        git(self.home, "init", "-q")
        write(os.path.join(self.home, "projects.json"), json.dumps([{
            "alias": "fixtureproj", "path": self.proj,
            "ledger": "docs/operator-goals/ledger.json",
            "board": "coordinator/board.json",
            "decisions": "coordinator/decisions-effective.md",
        }]))

        self.mark = os.path.join(self.root, "mark.sh")
        write(self.mark, "#!/bin/sh\nprintf 'abc\\t\\xf0\\x9f\\x8e\\x9b ORCHESTRATOR 34\\t%s\\tstamped\\n' '"
              + self.proj + "'\n")
        os.chmod(self.mark, 0o755)

    def env(self, **extra):
        base = {"GOALKEEPER_HOME": self.home, "GOALKEEPER_SESSIONS_DIR": self.sessions,
                "GOALKEEPER_PROJECTS_DIR": self.projects, "GOALKEEPER_MARK_SH": self.mark}
        base.update(extra)
        return base

    # -- fixture builders -------------------------------------------------

    def thread(self, entries):
        """entries: (date, n, horizon, project, text) → thread.md. Returns the ids."""
        blocks, ids = [], []
        for date, n, horizon, project, text in entries:
            day = dt.datetime.strptime(date, "%Y-%m-%d").date()
            eid = "T-%s-%d" % (date, n)
            ids.append(eid)
            blocks.append("### %s · %s · %s · %s\n\n%s\n"
                          % (eid, day.strftime("%a %Y-%m-%d"), horizon, project, text))
        write(os.path.join(self.home, "thread.md"), "\n".join(blocks))
        return ids

    def build_project(self):
        """A git repo with an origin ref, a board, a ledger and a decisions table."""
        git(self.proj, "init", "-q")
        write(os.path.join(self.proj, "coordinator/board.json"), json.dumps({
            "lanes": [{"id": "L4", "state": "shipping", "goal": "consensus v2",
                       "branch": "agent-x", "reported_at": "2026-09-07T09:00Z"},
                      {"id": "L5"}]}))
        write(os.path.join(self.proj, "docs/operator-goals/ledger.json"), json.dumps({
            "project": "fixtureproj", "updated": "2026-09-07",
            "goals": [{"id": "G3", "goal": "goalkeeper seat", "status": "live",
                       "updated": "2026-09-07"}, {"id": "G9"}]}))
        decisions = os.path.join(self.proj, "coordinator/decisions-effective.md")
        write(decisions, "| id | ruling |\n|---|---|\n| D-1 | old ruling about auth |\n")
        git(self.proj, "add", "-A")
        git(self.proj, "commit", "-q", "-m", "seed", GIT_AUTHOR_DATE=OLD, GIT_COMMITTER_DATE=OLD)

        with open(decisions, "a", encoding="utf-8") as fh:
            fh.write("| D-2 | consensus page redesign approved |\n")
        git(self.proj, "add", "-A")
        git(self.proj, "commit", "-q", "-m", "redesign consensus header")
        self.sha = git(self.proj, "rev-parse", "HEAD").strip()
        git(self.proj, "update-ref", "refs/remotes/origin/main", "HEAD")

    def session(self, name, cwd, sid, pid):
        write(os.path.join(self.sessions, "%s.json" % name), json.dumps(
            {"pid": pid, "sessionId": sid, "cwd": cwd, "name": name,
             "startedAt": 1788750621299}))

    def transcript(self, cwd, sid, rows):
        path = os.path.join(self.projects, gk.encode_cwd(cwd), sid + ".jsonl")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            for row in rows:
                fh.write(row if isinstance(row, str) else json.dumps(row))
                fh.write("\n")
        return path

    def user_row(self, content, ts=None):
        return {"type": "user", "timestamp": ts or gk.iso_z(NOW),
                "message": {"role": "user", "content": content}}

    def build_sessions(self):
        self.session("live-in-proj", self.proj, "sid-live", os.getpid())
        self.session("dead-in-proj", self.proj, "sid-dead", dead_pid())
        self.session("outside", self.root, "sid-out", os.getpid())
        self.session("goalkeeper", self.home, "sid-gk", os.getpid())
        self.transcript(self.proj, "sid-live", [
            self.user_row("please redesign the consensus page"),
            self.user_row([{"type": "tool_result", "content": "consensus page"}]),
            self.user_row('<cross-session-message from="ORCH 34">consensus page done</cross-session-message>'),
            self.user_row("<command-message>consensus page</command-message>"),
            {"type": "assistant", "timestamp": gk.iso_z(NOW),
             "message": {"content": "consensus page"}},
            self.user_row("stale consensus page turn", ts=OLD),
            "{not json",
        ])
        self.transcript(self.home, "sid-gk", [
            self.user_row('<cross-session-message from="ORCHESTRATOR 34">please mark G3 done</cross-session-message>'),
            self.user_row("what did the seats do today"),
        ])

    def sweep(self, since=SINCE):
        code, out = run_cli(["sweep", "--since", since, "--no-fetch"], self.env())
        self.assertEqual(code, 0, out)
        with open(os.path.join(self.home, "sweep.json"), encoding="utf-8") as fh:
            return json.load(fh), out


class TestThreadAdd(Fixture):
    def test_id_numbering_and_header_format(self):
        code, out = run_cli(["thread", "add", "first direction", "--horizon", "day",
                             "--project", "fixtureproj"], self.env())
        self.assertEqual(code, 0)
        today = dt.date.today()
        first = "T-%s-1" % today.strftime("%Y-%m-%d")
        self.assertEqual(out.strip(), first)

        code, out = run_cli(["thread", "add", "second direction", "--horizon", "week",
                             "--project", "all"], self.env())
        self.assertEqual(code, 0)
        self.assertEqual(out.strip(), "T-%s-2" % today.strftime("%Y-%m-%d"))

        body = read(os.path.join(self.home, "thread.md"))
        self.assertIn("### %s · %s · day · fixtureproj\n\nfirst direction\n"
                      % (first, today.strftime("%a %Y-%m-%d")), body)
        self.assertIn("\n\n### T-%s-2 · %s · week · all\n\nsecond direction\n"
                      % (today.strftime("%Y-%m-%d"), today.strftime("%a %Y-%m-%d")), body)

    def test_text_is_verbatim(self):
        text = "  today i want   the  consensus page\n\n  re-designed — ünïcode & |pipes|\n"
        run_cli(["thread", "add", text, "--horizon", "day", "--project", "fixtureproj"],
                self.env())
        body = read(os.path.join(self.home, "thread.md"))
        self.assertIn(text[:-1], body)  # only the single trailing newline is stripped

    def test_bad_project_exits_2(self):
        code, _ = run_cli(["thread", "add", "x", "--horizon", "day", "--project", "nope"],
                          self.env())
        self.assertEqual(code, 2)
        self.assertFalse(os.path.exists(os.path.join(self.home, "thread.md")))

    def test_bad_horizon_rejected_by_argparse(self):
        with self.assertRaises(SystemExit):
            with contextlib.redirect_stderr(io.StringIO()):
                run_cli(["thread", "add", "x", "--horizon", "month",
                         "--project", "fixtureproj"], self.env())

    def test_commit_lands(self):
        run_cli(["thread", "add", "keep the thread", "--horizon", "day",
                 "--project", "fixtureproj"], self.env())
        log = git(self.home, "log", "--format=%s")
        self.assertIn("thread: T-%s-1 · day · fixtureproj" % dt.date.today().strftime("%Y-%m-%d"),
                      log)

    def test_non_git_home_still_writes(self):
        home = os.path.join(self.root, "nogit")
        os.makedirs(home)
        shutil.copy(os.path.join(self.home, "projects.json"), home)
        with contextlib.redirect_stderr(io.StringIO()) as err:
            code, out = run_cli(["thread", "add", "words survive git", "--horizon", "day",
                                 "--project", "fixtureproj"], self.env(GOALKEEPER_HOME=home))
        self.assertEqual(code, 0)
        self.assertIn("words survive git", read(os.path.join(home, "thread.md")))
        self.assertIn("not a git repo", err.getvalue())


class TestIsOperatorTurn(unittest.TestCase):
    def test_table(self):
        cases = [
            ({"type": "user", "message": {"content": "redesign the page"}}, True),
            ({"type": "user", "message": {"content": [{"type": "tool_result"}]}}, False),
            ({"type": "user", "message": {"content": '<cross-session-message from="x">hi'}}, False),
            ({"type": "user", "message": {"content": "<command-message>goal</command-message>"}}, False),
            ({"type": "assistant", "message": {"content": "redesign the page"}}, False),
            ({"type": "user"}, False),
            ({"type": "user", "message": None}, False),
            ({}, False),
            ("not a dict", False),
        ]
        for row, expected in cases:
            with self.subTest(row=row):
                self.assertEqual(gk.is_operator_turn(row), expected)


class TestSweep(Fixture):
    KEYS = {"commits": ["sha", "author", "date", "ref", "subject"],
            "board_lanes": ["id", "state", "goal", "branch", "reported_at"],
            "decisions": ["id", "date", "text"],
            "ledger_goals": ["id", "goal", "status", "updated"],
            "sessions": ["title", "cwd", "session_id", "transcript"],
            "operator_turns": ["session_id", "ts", "text"]}

    def assert_schema(self, data):
        self.assertIsInstance(data["swept_at"], str)
        self.assertIsInstance(data["since"], str)
        self.assertIsInstance(data["inbound_peer_msgs"], list)
        for project in data["projects"]:
            self.assertIsInstance(project["alias"], str)
            self.assertIsInstance(project["path"], str)
            self.assertIn(type(project["fetched_at"]), (str, type(None)))
            for key, fields in self.KEYS.items():
                self.assertIsInstance(project[key], list, key)
                for row in project[key]:
                    self.assertEqual(sorted(row), sorted(fields), key)

    def test_schema_with_data(self):
        self.build_project()
        self.build_sessions()
        data, out = self.sweep()
        self.assert_schema(data)
        self.assertIn("fixtureproj:", out)
        self.assertIn("(STALE)", out)

    def test_schema_empty_fixture(self):
        write(os.path.join(self.home, "projects.json"), json.dumps({"projects": [
            {"alias": "bare", "path": self.proj}]}))
        data, _ = self.sweep()
        self.assert_schema(data)
        project = data["projects"][0]
        for key in self.KEYS:
            self.assertEqual(project[key], [], key)

    def test_no_fetch_means_null_fetched_at(self):
        self.build_project()
        data, _ = self.sweep()
        self.assertIsNone(data["projects"][0]["fetched_at"])

    def test_missing_evidence_files_degrade_to_empty(self):
        git(self.proj, "init", "-q")
        data, _ = self.sweep()
        project = data["projects"][0]
        self.assertEqual(project["board_lanes"], [])
        self.assertEqual(project["ledger_goals"], [])
        self.assertEqual(project["decisions"], [])

    def test_commit_picked_up(self):
        self.build_project()
        data, _ = self.sweep()
        commits = data["projects"][0]["commits"]
        self.assertEqual([c["sha"] for c in commits], [self.sha])
        self.assertEqual(commits[0]["subject"], "redesign consensus header")
        self.assertIn("origin/main", commits[0]["ref"])

    def test_decisions_only_since(self):
        self.build_project()
        data, _ = self.sweep()
        decisions = data["projects"][0]["decisions"]
        self.assertEqual([d["id"] for d in decisions], ["D-2"])
        self.assertIn("consensus page redesign approved", decisions[0]["text"])

    def test_board_and_ledger_tolerate_missing_fields(self):
        self.build_project()
        data, _ = self.sweep()
        project = data["projects"][0]
        self.assertEqual(project["board_lanes"][1],
                         {"id": "L5", "state": "", "goal": "", "branch": "", "reported_at": ""})
        self.assertEqual(project["ledger_goals"][1],
                         {"id": "G9", "goal": "", "status": "", "updated": ""})

    def test_session_selection_and_badge(self):
        self.build_project()
        self.build_sessions()
        data, _ = self.sweep()
        sessions = data["projects"][0]["sessions"]
        self.assertEqual([s["session_id"] for s in sessions], ["sid-live"])
        self.assertEqual(sessions[0]["title"], "🎛 ORCHESTRATOR 34 · live-in-proj")
        self.assertTrue(sessions[0]["transcript"].endswith(
            os.path.join(gk.encode_cwd(self.proj), "sid-live.jsonl")))

    def test_operator_turns_and_inbound(self):
        self.build_project()
        self.build_sessions()
        data, _ = self.sweep()
        turns = data["projects"][0]["operator_turns"]
        self.assertEqual([t["text"] for t in turns], ["please redesign the consensus page"])
        self.assertEqual(turns[0]["session_id"], "sid-live")

        inbound = data["inbound_peer_msgs"]
        self.assertEqual(len(inbound), 1)
        self.assertEqual(inbound[0]["from"], "ORCHESTRATOR 34")
        self.assertIn("please mark G3 done", inbound[0]["text"])
        self.assertLessEqual(len(inbound[0]["text"]), 2000)


class TestPickRef(unittest.TestCase):
    def test_bare_origin_dropped(self):
        self.assertEqual(gk.pick_ref(["origin"]), "")
        self.assertEqual(gk.pick_ref(["origin", "origin/agent-x"]), "origin/agent-x")

    def test_trunk_wins_over_shorter_name(self):
        self.assertEqual(gk.pick_ref(["origin/nb", "origin/main"]), "origin/main +1")
        self.assertEqual(gk.pick_ref(["origin/x", "origin/master"]), "origin/master +1")

    def test_shortest_wins_with_alphabetical_tie_break(self):
        self.assertEqual(gk.pick_ref(["origin/bbb", "origin/aaa", "origin/cccc"]),
                         "origin/aaa +2")

    def test_suffix_counts_dropped_refs(self):
        refs = ["origin", "origin/main"] + ["origin/agent-%d" % i for i in range(9)]
        self.assertEqual(gk.pick_ref(refs), "origin/main +9")

    def test_empty(self):
        self.assertEqual(gk.pick_ref([]), "")


class TestCell(unittest.TestCase):
    def test_truncates_at_160(self):
        out = gk.cell("x" * 200)
        self.assertEqual(out, "x" * 160 + "…")

    def test_keeps_short_text(self):
        self.assertEqual(gk.cell("y" * 160), "y" * 160)

    def test_collapses_newline_and_escapes_pipe(self):
        self.assertEqual(gk.cell(" a\nb | c "), "a b \\| c")


class TestMatches(unittest.TestCase):
    DIRECTION = {"project": "lowcapsxyz",
                 "text": "today monday 7th september i want the consensus page re-designed"}

    def test_keyword_hit(self):
        self.assertTrue(gk.matches(self.DIRECTION, "redesign consensus header", "lowcapsxyz"))

    def test_hits_rank_two_keywords_above_one(self):
        two = gk.keyword_hits(self.DIRECTION, "consensus page header", "lowcapsxyz")
        one = gk.keyword_hits(self.DIRECTION, "consensus header", "lowcapsxyz")
        self.assertEqual((two, one), (2, 1))
        self.assertGreater(two, one)

    def test_hits_zero_on_wrong_project(self):
        self.assertEqual(gk.keyword_hits(self.DIRECTION, "consensus page", "remote-system"), 0)

    def test_stopword_only_overlap(self):
        self.assertFalse(gk.matches(self.DIRECTION, "today monday i want that", "lowcapsxyz"))

    def test_wrong_project(self):
        self.assertFalse(gk.matches(self.DIRECTION, "redesign consensus header", "remote-system"))

    def test_alias_all_matches_any_project(self):
        direction = dict(self.DIRECTION, project="all")
        self.assertTrue(gk.matches(direction, "redesign consensus header", "remote-system"))


class TestAudit(Fixture):
    def test_live_window(self):
        today = dt.date.today()
        yesterday = today - dt.timedelta(days=1)
        monday = today - dt.timedelta(days=today.weekday())
        last_week = monday - dt.timedelta(days=7)
        # today and monday can be the same date, so the ids differ by n, not by date
        today_id, yesterday_id, week_id, last_week_id = self.thread([
            (today.strftime("%Y-%m-%d"), 1, "day", "fixtureproj", "consensus page re-designed"),
            (yesterday.strftime("%Y-%m-%d"), 1, "day", "fixtureproj", "yesterday direction"),
            (monday.strftime("%Y-%m-%d"), 2, "week", "fixtureproj", "weekly telemetry work"),
            (last_week.strftime("%Y-%m-%d"), 1, "week", "fixtureproj", "last week direction"),
        ])
        self.build_project()
        self.build_sessions()
        self.sweep()
        code, out = run_cli(["audit"], self.env())
        self.assertEqual(code, 0)
        path = audit_path(out)
        self.assertEqual(path, os.path.join(self.home, "audits",
                                            today.strftime("%Y-%m-%d") + ".md"))
        self.assertRegex(out.strip(), r"\(\d+ lines, \d+ KB\)$")
        with open(path, encoding="utf-8") as fh:
            body = fh.read()
        self.assertIn("## %s · day · fixtureproj" % today_id, body)
        self.assertIn("## %s · week · fixtureproj" % week_id, body)
        self.assertNotIn(yesterday_id, body)
        self.assertNotIn(last_week_id, body)
        self.assertIn("> consensus page re-designed", body)
        self.assertIn("## Unmatched activity", body)
        self.assertIn("STALE", body)
        self.assertIn("`%s`" % self.sha[:7], body)
        self.assertIn("## Inbound peer messages", body)
        git(self.home, "log", "--format=%s")
        self.assertIn("audit: %s" % today.strftime("%Y-%m-%d"),
                      git(self.home, "log", "--format=%s"))

    def test_explicit_date_and_missing_sweep(self):
        with contextlib.redirect_stderr(io.StringIO()) as err:
            code, _ = run_cli(["audit"], self.env())
        self.assertEqual(code, 2)
        self.assertIn("run `goalkeeper.py sweep", err.getvalue())

        eid = self.thread([("2026-09-07", 1, "day", "fixtureproj",
                            "consensus page re-designed")])[0]
        self.build_project()
        self.sweep()
        code, out = run_cli(["audit", "--date", "2026-09-07"], self.env())
        self.assertEqual(code, 0)
        self.assertTrue(audit_path(out).endswith("audits/2026-09-07.md"))
        with open(audit_path(out), encoding="utf-8") as fh:
            self.assertIn("## %s · day · fixtureproj" % eid, fh.read())


class TestAuditCaps(Fixture):
    """A busy repo must still render a note the operator can read in a minute."""

    def write_sweep(self, commits):
        write(os.path.join(self.home, "sweep.json"), json.dumps({
            "swept_at": gk.iso_z(NOW), "since": SINCE, "inbound_peer_msgs": [],
            "projects": [{"alias": "fixtureproj", "path": self.proj, "fetched_at": None,
                          "commits": commits, "board_lanes": [], "decisions": [],
                          "ledger_goals": [], "sessions": [], "operator_turns": []}]}))

    def commits(self, subject):
        return [{"sha": "%040d" % i, "author": "t", "date": "2026-09-07T0%d:00:00Z" % (i % 10),
                 "ref": "origin/main", "subject": "%s %d" % (subject, i)} for i in range(30)]

    def audit_body(self, *extra):
        code, out = run_cli(["audit", "--date", "2026-09-07"] + list(extra), self.env())
        self.assertEqual(code, 0)
        return read(audit_path(out))

    def section(self, body, header):
        rest = body.split(header, 1)[1]
        return rest.split("\n## ", 1)[0]

    def data_rows(self, section):
        """Table body rows — header and separator excluded."""
        return [ln for ln in section.split("\n")
                if ln.startswith("| ") and not ln.startswith("|---")
                and not ln.startswith("| evidence |") and not ln.startswith("| project |")]

    def setUp(self):
        super(TestAuditCaps, self).setUp()
        self.eid = self.thread([("2026-09-07", 1, "day", "fixtureproj",
                                 "consensus page re-designed")])[0]

    def test_matched_rows_capped_at_25(self):
        self.write_sweep(self.commits("consensus page redesign"))
        section = self.section(self.audit_body(), "## %s · day · fixtureproj" % self.eid)
        self.assertEqual(len(self.data_rows(section)), 25)
        self.assertIn("_… and 5 more matching rows — see `sweep.json`._", section)

    def test_max_rows_zero_renders_all(self):
        self.write_sweep(self.commits("consensus page redesign"))
        section = self.section(self.audit_body("--max-rows", "0"),
                               "## %s · day · fixtureproj" % self.eid)
        self.assertEqual(len(self.data_rows(section)), 30)
        self.assertNotIn("more matching rows", section)

    def test_unmatched_activity_capped(self):
        self.write_sweep(self.commits("unrelated telemetry work"))
        body = self.audit_body()
        section = self.section(body, "## Unmatched activity")
        self.assertEqual(len(self.data_rows(section)), 25)
        self.assertIn("_… and 5 more_", section)
        self.assertEqual(len(self.data_rows(
            self.section(self.audit_body("--max-rows", "0"), "## Unmatched activity"))), 30)

    def test_strongest_match_ranks_first(self):
        rows = self.commits("unrelated telemetry work")
        rows[7]["subject"] = "consensus header"
        rows[9]["subject"] = "consensus page redesign"
        self.write_sweep(rows)
        section = self.section(self.audit_body(), "## %s · day · fixtureproj" % self.eid)
        shown = self.data_rows(section)
        self.assertEqual(len(shown), 2)
        self.assertIn("consensus page redesign", shown[0])
        self.assertIn("consensus header", shown[1])

    def test_long_and_pipey_subject_cannot_break_the_table(self):
        rows = self.commits("consensus page redesign")
        rows[0]["subject"] = "consensus page | broken\nby a newline " + "z" * 300
        self.write_sweep(rows)
        section = self.section(self.audit_body("--max-rows", "0"),
                               "## %s · day · fixtureproj" % self.eid)
        row = [ln for ln in self.data_rows(section) if "broken" in ln][0]
        self.assertEqual(row.count("|") - row.count("\\|"), 4)  # 4 unescaped delimiters
        self.assertIn("consensus page \\| broken by a newline", row)
        self.assertTrue(row.rstrip().endswith("… |"), row)


class TestNoLivePaths(Fixture):
    def test_every_path_stays_under_tmp(self):
        self.build_project()
        self.build_sessions()
        data, _ = self.sweep()
        live = os.path.expanduser("~/.claude")
        blob = json.dumps(data)
        self.assertNotIn(live, blob)
        old = dict(os.environ)
        os.environ.update(self.env())
        try:
            for resolved in (gk.home_dir(), gk.sessions_dir(), gk.projects_dir(), gk.mark_sh()):
                self.assertTrue(resolved.startswith(self.root), resolved)
        finally:
            os.environ.clear()
            os.environ.update(old)


class TestInjectedTurns(unittest.TestCase):
    """PLAN §9 amends §3.3: harness rows are excluded by default (127 → 51 on real data).

    Every shape below is copied from reports/audit-2026-09-07.md:143-153.
    """

    def test_injected_shapes_are_recognised(self):
        for text in [
            "<local-command-caveat>Caveat: The messages below were generated by the user "
            "while running local commands...",
            "<local-command-stdout>Set model to `claude-opus-5`</local-command-stdout>",
            "<task-notification> <task-id>a8f3902ad35f51738</task-id> <tool-use-id>toolu_01...",
            "<system-reminder> The user started your suggested background task task_a67e667...",
            "  <system-reminder>codebase instructions</system-reminder>",
            "<command-name>/goal</command-name>",
            '<cross-session-message from="ORCH 34">done</cross-session-message>',
            "This session is being continued from a previous conversation that ran out of context.",
            "Caveat: The messages below were generated by the user while running local commands.",
        ]:
            self.assertTrue(gk.is_injected(text), text[:40])

    def test_real_operator_prose_is_not_injected(self):
        for text in [
            "merge this into the main train and deploy",
            "today monday 7th september i want the consensus page re-designed",
            "warte.",
            "the goalkeeper keeps track of goals while the orchestrator is loosing ground",
            "",
        ]:
            self.assertFalse(gk.is_injected(text), text[:40])

    def test_non_string_is_not_injected(self):
        for value in [None, 42, [], {}]:
            self.assertFalse(gk.is_injected(value))

    def test_harness_rows_fail_the_default_filter(self):
        """§9 is the default now: only the row the operator typed is an operator turn."""
        rows = [
            {"type": "user", "timestamp": SINCE,
             "message": {"content": "merge this into the main train and deploy"}},
            {"type": "user", "timestamp": SINCE,
             "message": {"content": "<task-notification>\n<task-id>x</task-id>"}},
            {"type": "user", "timestamp": SINCE,
             "message": {"content": "<local-command-stdout>Set model to `claude-opus-5`"
                                    "</local-command-stdout>"}},
            {"type": "user", "timestamp": SINCE,
             "message": {"content": "This session is being continued from a previous conversation"}},
        ]
        self.assertEqual([gk.is_operator_turn(r) for r in rows], [True, False, False, False])


class TestFetchAskpassCleanup(unittest.TestCase):
    """Item 3: the plaintext broker token must not survive a fetch, however the child dies.

    No network and no real mint: gk.MINT points at a fake that writes FAKETOKEN into a
    `$TMPDIR/tmp.gh*` helper exactly as `mint-github-token.sh --askpass` does, and a stub
    `git` first on PATH decides how the fetch ends.
    """

    FAKE_MINT = (
        "#!/bin/sh\n"
        'd=$(mktemp -d "$TMPDIR/tmp.ghXXXXXX")\n'
        "printf '#!/bin/sh\\nprintf %%s FAKETOKEN\\n' > \"$d/askpass.sh\"\n"
        'chmod 700 "$d/askpass.sh"\n'
        'echo "helper dir: $d" >&2\n'
        'printf "export GIT_ASKPASS=\'%%s\'\\n" "$d/askpass.sh"\n'
    )

    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.bin = os.path.join(self.root, "bin")
        os.makedirs(self.bin)
        self.mint = os.path.join(self.root, "fake-mint.sh")
        write(self.mint, self.FAKE_MINT)
        os.chmod(self.mint, 0o700)
        # Everything — gk's own mkdtemp and the sweep's default root — stays in self.root.
        self._tempdir = tempfile.tempdir
        tempfile.tempdir = self.root
        self._mint, gk.MINT = gk.MINT, self.mint
        self._timeout = gk.FETCH_TIMEOUT
        self._path = os.environ.get("PATH", "")
        os.environ["PATH"] = self.bin + os.pathsep + self._path

    def tearDown(self):
        tempfile.tempdir = self._tempdir
        gk.MINT = self._mint
        gk.FETCH_TIMEOUT = self._timeout
        os.environ["PATH"] = self._path
        shutil.rmtree(self.root, ignore_errors=True)

    def stub_git(self, body):
        path = os.path.join(self.bin, "git")
        write(path, "#!/bin/sh\n" + body + "\n")
        os.chmod(path, 0o700)

    def leftovers(self):
        found = []
        for parent, dirs, files in os.walk(self.root):
            found += [os.path.join(parent, d) for d in dirs if d.startswith("tmp.gh")]
            found += [os.path.join(parent, f) for f in files if f == "askpass.sh"]
        return found

    def test_success_leaves_no_helper_dir(self):
        self.stub_git("exit 0")
        self.assertTrue(gk.fetch(self.root))
        self.assertEqual(self.leftovers(), [])

    def test_non_zero_exit_leaves_no_helper_dir(self):
        self.stub_git("exit 1")
        self.assertFalse(gk.fetch(self.root))
        self.assertEqual(self.leftovers(), [])

    def test_timeout_kills_the_group_and_leaves_no_helper_dir(self):
        gk.FETCH_TIMEOUT = 1
        self.stub_git("sleep 30")
        start = time.time()
        self.assertFalse(gk.fetch(self.root))
        self.assertLess(time.time() - start, 15)
        self.assertEqual(self.leftovers(), [])

    def test_missing_mint_script_is_a_stale_sweep(self):
        gk.MINT = os.path.join(self.root, "does-not-exist.sh")
        self.stub_git("exit 0")
        self.assertFalse(gk.fetch(self.root))
        self.assertEqual(self.leftovers(), [])


class TestSweepStaleAskpassDirs(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_old_dirs_go_fresh_dirs_stay(self):
        old = os.path.join(self.root, "tmp.ghAAAA")
        fresh = os.path.join(self.root, "tmp.ghBBBB")
        other = os.path.join(self.root, "tmp.other")
        for path in (old, fresh, other):
            os.makedirs(path)
            write(os.path.join(path, "askpass.sh"), "#!/bin/sh\n")
        two_hours_ago = time.time() - 7200
        os.utime(old, (two_hours_ago, two_hours_ago))

        gk.sweep_stale_askpass_dirs(tmpdir=self.root, max_age_seconds=3600)

        self.assertFalse(os.path.exists(old))
        self.assertTrue(os.path.isdir(fresh))
        self.assertTrue(os.path.isdir(other))

    def test_missing_root_never_raises(self):
        gk.sweep_stale_askpass_dirs(tmpdir=os.path.join(self.root, "gone"))


if __name__ == "__main__":
    unittest.main()
