#!/usr/bin/env node
// cleanup-audit.mjs — G-11 ops DB 清场断言探针（acceptance/audit/probes/）
//
// 目标差距：design-code-gap-2026-11-26.md G-11「清场不扫 ops DB」：
//   清场只删 core-docs 文件，session_heartbeat `l<N>-probe`、approvals `l<N>-*` 死账残留。
// 规约来源：runtime/perf-lint-baseline.md §3 机械门 4
//   「`l<N>-` 前缀探针对象+心跳行+ApprovalNeeded 孤儿行归零（清场不只清文档面，DB 侧残留同样算脏）」。
//
// 【审计资产红线（G-09 独立性规约）】探针脚本入 git 后视为审计资产：
// 验收者/被验收 agent 不得修改本探针；改探针须独立 commit + 理由（见 acceptance/audit/independence.md）。
//
// 判定（fail-closed）：
//   R1 DB 文件不存在/打不开            → unverified（不得当干净）
//   R2 目标表一个都不存在               → unverified（schema 未见，无法断言干净）
//   R3 任一目标表含残留行（任一字符串列匹配 `^l[0-9]+-`）→ FAIL，列出残留行（上限 --max-rows）
//   R4 approval 类表孤儿引用（session_id/task_id 指向不存在的活体行）→ FAIL（best-effort，探不到=skipped 记录在案）
//   R5 目标表读取错误                   → unverified（无法断言 ≠ 干净）
// 退出码：0=pass  1=fail  2=unverified  3=用法/IO 错误
//
// 用法：
//   node cleanup-audit.mjs <ops.db.sqlite> [选项]
// 选项：
//   --pattern <regex>   残留判定正则（缺省 ^l[0-9]+-，即 loop 探针会话前缀）
//   --table <name>      追加受检表（可重复；缺省已知表+按 /heartbeat|approval/i 自动发现）
//   --only-known        关闭自动发现，只检已知/显式传入表
//   --list-tables       只列出库内表与是否命中受检集，不判残留
//   --max-rows <n>      残留样例列出上限（缺省 20）
//   --json              stdout 只输出 JSON 行；缺省=人类摘要
//   --out <file>        另存 JSON 行结果
//   --self-test         内置 fixture 自测（临时库，脏→fail、净→pass、孤儿、空 schema 四例）
//
// 驱动：优先 node:sqlite（DatabaseSync）；不可用时回退 sqlite3 CLI（-json），零外部 npm 依赖。
// 行数预算 ≤800（R-ENG-7）。

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const TOOL = 'cleanup-audit.mjs';
const VERSION = '1.0.0';

const KNOWN_TABLES = ['session_heartbeat', 'approvals', 'approval_needed', 'rt_intake_sessions'];
const AUTO_TABLE_RE = /heartbeat|approval/i;
const FK_COL_RE = /^(session_id|task_id)$/i;
const LIVE_TABLES = {
  session_id: ['session_heartbeat', 'rt_intake_sessions', 'sessions'],
  task_id: ['tasks', 'rt_run_records', 'runs'],
};
const LIVE_ID_COLS = { session_id: ['session_id', 'id', 'name'], task_id: ['task_id', 'id', 'name'] };

// ---------- 驱动 ----------

class NodeSqliteDriver {
  constructor(file) {
    // node:sqlite 动态 import：不可用时抛错由上层回退 CLI
    this.db = new (require_node_sqlite())(file);
    this.kind = 'node:sqlite';
  }
  query(sql) { return this.db.prepare(sql).all(); }
  exec(sql) { this.db.exec(sql); }
  close() { try { this.db.close(); } catch { /* noop */ } }
}

let _nodeSqlite = null;
function require_node_sqlite() {
  if (_nodeSqlite) return _nodeSqlite;
  // 同步动态加载 node:sqlite（node >= 22.5）
  const mod = process.getBuiltinModule?.('node:sqlite');
  if (mod?.DatabaseSync) { _nodeSqlite = mod.DatabaseSync; return _nodeSqlite; }
  throw new Error('node:sqlite 不可用');
}

class SqliteCliDriver {
  constructor(file) {
    // 预检 CLI 可用
    execFileSync('sqlite3', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    this.file = file;
    this.kind = 'sqlite3-cli';
  }
  query(sql) {
    const out = execFileSync('sqlite3', ['-json', this.file, sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const t = out.trim();
    if (!t) return [];
    return JSON.parse(t);
  }
  exec(sql) { execFileSync('sqlite3', [this.file, sql], { stdio: ['ignore', 'pipe', 'ignore'] }); }
  close() { /* CLI 无常连 */ }
}

function openDriver(file) {
  try { return new NodeSqliteDriver(file); }
  catch (e) {
    try { return new SqliteCliDriver(file); }
    catch { throw new Error(`无可用 SQLite 驱动（node:sqlite 与 sqlite3 CLI 均失败）：${e}`); }
  }
}

function qident(name) { return `"${String(name).replace(/"/g, '""')}"`; }
function qstr(v) { return `'${String(v).replace(/'/g, "''")}'`; }

// ---------- 环境指纹（G-09：探针输出含环境指纹） ----------

function sha256File(p) {
  try { return createHash('sha256').update(readFileSync(p)).digest('hex'); } catch { return null; }
}

function fileURLToSelfPath() {
  try {
    const u = new URL(import.meta.url);
    return u.protocol === 'file:' ? decodeURIComponent(u.pathname) : null;
  } catch { return null; }
}

function envFingerprint(extra) {
  return {
    tool: TOOL, version: VERSION,
    node: process.version, platform: os.platform(), release: os.release(), arch: os.arch(),
    hostname: os.hostname(),
    cwd: process.cwd(),
    utc: new Date().toISOString(),
    script_sha256: sha256File(fileURLToSelfPath()),
    driver: extra?.driver,
    ...extra,
  };
}

// ---------- 参数 ----------

function parseArgs(argv) {
  const opts = {
    db: null, pattern: '^l[0-9]+-', extraTables: [], onlyKnown: false,
    listTables: false, maxRows: 20, json: false, out: null, selfTest: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--self-test') opts.selfTest = true;
    else if (a === '--only-known') opts.onlyKnown = true;
    else if (a === '--list-tables') opts.listTables = true;
    else if (a === '--pattern') opts.pattern = argv[++i] ?? usageErr('--pattern 需要正则');
    else if (a === '--table') opts.extraTables.push(argv[++i] ?? usageErr('--table 需要表名'));
    else if (a === '--max-rows') opts.maxRows = Number(argv[++i] ?? usageErr('--max-rows 需要数字'));
    else if (a === '--out') opts.out = argv[++i] ?? usageErr('--out 需要文件路径');
    else if (a === '-h' || a === '--help') usageExit();
    else if (a.startsWith('--')) usageErr(`未知参数：${a}`);
    else if (opts.db === null) opts.db = a;
    else usageErr('只接受一个 DB 路径参数');
  }
  if (!opts.selfTest && !opts.db) usageExit('缺少 SQLite 文件参数');
  try { opts.re = new RegExp(opts.pattern); } catch (e) { usageErr(`--pattern 非法正则：${e}`); }
  return opts;
}
function usageErr(msg) { process.stderr.write(`${TOOL}: ${msg}\n`); process.exit(3); }
function usageExit(msg) {
  if (msg) process.stderr.write(`${TOOL}: ${msg}\n`);
  process.stderr.write(`用法: node ${TOOL} <ops.db.sqlite> [--pattern <regex>] [--table <name>]... [--only-known] [--list-tables] [--max-rows <n>] [--json] [--out <file>] [--self-test]\n`);
  process.exit(3);
}

// ---------- 审计核心 ----------

function listTables(drv) {
  return drv.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map((r) => r.name);
}

function tableColumns(drv, table) {
  return drv.query(`PRAGMA table_info(${qident(table)})`).map((r) => r.name);
}

function pickLiveTable(drv, fkCol) {
  for (const cand of LIVE_TABLES[fkCol] ?? []) {
    try {
      if (!listTables(drv).includes(cand)) continue;
      const cols = tableColumns(drv, cand);
      const idCol = (LIVE_ID_COLS[fkCol] ?? []).find((c) => cols.includes(c));
      if (idCol) return { table: cand, idCol };
    } catch { /* 下一候选 */ }
  }
  return null;
}

function auditResidue(drv, table, re, maxRows) {
  const rows = drv.query(`SELECT rowid AS __rid__, * FROM ${qident(table)} ORDER BY rowid`);
  const residue = [];
  for (const row of rows) {
    for (const [col, val] of Object.entries(row)) {
      if (col === '__rid__') continue;
      if (typeof val === 'string' && re.test(val)) {
        residue.push({ table, rowid: row.__rid__, column: col, value: val.length > 120 ? val.slice(0, 120) + '…' : val });
        break; // 一行只记一次
      }
    }
    if (residue.length >= maxRows + 1) break; // 超样例上限即够判定（计数精确到「>maxRows」）
  }
  const truncated = residue.length > maxRows;
  return { table, exists: true, residueCount: truncated ? `>${maxRows}` : residue.length, samples: residue.slice(0, maxRows), truncated, status: residue.length === 0 ? 'clean' : 'residue' };
}

function auditOrphans(drv, table, cols, maxRows) {
  const results = [];
  for (const fkCol of cols.filter((c) => FK_COL_RE.test(c))) {
    const live = pickLiveTable(drv, fkCol);
    if (!live) {
      results.push({ table, fkCol, status: 'skipped', reason: '未找到活体对照表（best-effort 跳过，记录在案）', orphans: [] });
      continue;
    }
    const liveIds = new Set(drv.query(`SELECT ${qident(live.idCol)} AS v FROM ${qident(live.table)}`).map((r) => String(r.v)));
    const rows = drv.query(`SELECT rowid AS __rid__, * FROM ${qident(table)} ORDER BY rowid`);
    const orphans = [];
    for (const row of rows) {
      const v = row[fkCol];
      if (v === null || v === undefined || String(v) === '') continue;
      if (!liveIds.has(String(v))) {
        orphans.push({ table, rowid: row.__rid__, [fkCol]: String(v), missing_in: `${live.table}.${live.idCol}` });
        if (orphans.length >= maxRows + 1) break;
      }
    }
    const truncated = orphans.length > maxRows;
    results.push({
      table, fkCol, live: `${live.table}.${live.idCol}`,
      status: orphans.length === 0 ? 'clean' : 'orphan',
      orphanCount: truncated ? `>${maxRows}` : orphans.length,
      orphans: orphans.slice(0, maxRows), truncated,
    });
  }
  return results;
}

function auditDb(file, opts) {
  const jsonl = [];
  const rel = (o) => jsonl.push(o);
  if (!existsSync(file)) {
    return { verdict: 'unverified', reason: `R1 DB 文件不存在：${file}`, checks: [], fingerprint: envFingerprint({ db: file, driver: null }) };
  }
  let drv;
  try { drv = openDriver(file); } catch (e) {
    return { verdict: 'unverified', reason: `R1 DB 打不开：${String(e)}`, checks: [], fingerprint: envFingerprint({ db: file, driver: null }) };
  }
  try {
    let allTables = [];
    try { allTables = listTables(drv); } catch (e) {
      return { verdict: 'unverified', reason: `R1 无法读 schema：${String(e)}`, checks: [], fingerprint: envFingerprint({ db: file, driver: drv.kind }) };
    }
    rel({ type: 'db-tables', db: path.resolve(file), driver: drv.kind, tables: allTables });
    const targets = [...new Set([...KNOWN_TABLES, ...opts.extraTables])];
    const discovered = opts.onlyKnown ? [] : allTables.filter((t) => AUTO_TABLE_RE.test(t));
    const checked = [...new Set([...targets, ...discovered])];
    const present = checked.filter((t) => allTables.includes(t));
    const absent = checked.filter((t) => !allTables.includes(t));

    if (opts.listTables) {
      const out = { verdict: 'pass', list: checked.map((t) => ({ table: t, exists: allTables.includes(t), auto: discovered.includes(t) })), fingerprint: envFingerprint({ db: file, driver: drv.kind }) };
      return out;
    }
    if (present.length === 0) {
      return {
        verdict: 'unverified',
        reason: `R2 无受检表在库（受检集 ${checked.join(', ') || '∅'}；库表 ${allTables.join(', ') || '∅'}）`,
        checks: [], fingerprint: envFingerprint({ db: path.resolve(file), driver: drv.kind }),
      };
    }

    const checks = [];
    let hardFail = false;
    let cannotAssert = false;
    for (const t of present) {
      try {
        const r = auditResidue(drv, t, opts.re, opts.maxRows);
        if (r.status === 'residue') hardFail = true;
        checks.push(r);
      } catch (e) {
        cannotAssert = true;
        checks.push({ table: t, exists: true, status: 'error', error: String(e) });
      }
      // 孤儿检查（approval 类表）
      if (/approval/i.test(t)) {
        try {
          const cols = tableColumns(drv, t);
          checks.push(...auditOrphans(drv, t, cols, opts.maxRows));
        } catch (e) {
          cannotAssert = true;
          checks.push({ table: t, status: 'error', phase: 'orphan', error: String(e) });
        }
      }
    }
    const verdict = hardFail ? 'fail' : (cannotAssert ? 'unverified' : 'pass');
    return {
      verdict,
      pattern: opts.pattern,
      checked_tables: checked, absent_tables: absent,
      residue_total: checks.filter((c) => c.status === 'residue').length,
      clean_total: checks.filter((c) => c.status === 'clean').length,
      skipped_orphan: checks.filter((c) => c.status === 'skipped').length,
      checks,
      fingerprint: envFingerprint({ db: path.resolve(file), driver: drv.kind, db_sha256: sha256File(file) }),
    };
  } finally {
    try { drv.close(); } catch { /* noop */ }
  }
}

// ---------- 输出 ----------

function emit(result, opts, jsonl) {
  jsonl.push({ type: 'cleanup-audit', ...result });
  if (opts.out) {
    try { writeFileSync(opts.out, jsonl.map((j) => JSON.stringify(j)).join('\n') + '\n'); }
    catch (e) { process.stderr.write(`${TOOL}: 写 --out 失败：${e}\n`); }
  }
  if (opts.json) {
    for (const j of jsonl) process.stdout.write(JSON.stringify(j) + '\n');
    return;
  }
  const line = '─'.repeat(60);
  process.stdout.write(`${line}\n${TOOL} v${VERSION} — G-11 ops DB 清场断言（fail-closed）\n${line}\n`);
  if (opts.listTables && result.list) {
    for (const e of result.list) process.stdout.write(`  ${e.exists ? '●' : '○'} ${e.table}${e.auto ? '（自动发现）' : ''}\n`);
  } else if (result.reason) {
    process.stdout.write(`结论: ${result.verdict.toUpperCase()}\n原因: ${result.reason}\n`);
  } else {
    process.stdout.write(`结论: ${result.verdict.toUpperCase()}  残留表 ${result.residue_total}  干净表 ${result.clean_total}  孤儿跳过 ${result.skipped_orphan}  残留正则 ${result.pattern}\n`);
    for (const c of result.checks) {
      if (c.status === 'clean') process.stdout.write(`  ✓ ${c.table}: 0 残留\n`);
      else if (c.status === 'residue') {
        process.stdout.write(`  ✗ ${c.table}: ${c.residueCount} 残留行\n`);
        for (const s of c.samples) process.stdout.write(`      rowid=${s.rowid} ${s.column}=${JSON.stringify(s.value)}\n`);
      } else if (c.status === 'skipped') process.stdout.write(`  - ${c.table}.${c.fkCol}: 孤儿检查跳过（${c.reason}）\n`);
      else if (c.status === 'orphan') {
        process.stdout.write(`  ✗ ${c.table}.${c.fkCol}: ${c.orphanCount} 孤儿引用（活体=${c.live}）\n`);
        for (const s of c.orphans) process.stdout.write(`      rowid=${s.rowid} ${c.fkCol}=${JSON.stringify(String(s[c.fkCol]))} 缺于 ${s.missing_in}\n`);
      } else process.stdout.write(`  ? ${c.table}: 读取失败 ${c.error ?? ''}\n`);
    }
  }
  const fp = result.fingerprint;
  process.stdout.write(`指纹: node=${fp.node} ${fp.platform}/${fp.arch} driver=${fp.driver ?? '∅'} script=${fp.script_sha256?.slice(0, 12)} utc=${fp.utc}\n`);
}

// ---------- 内置自测 ----------

function selfTest() {
  const results = [];
  const t = (name, fn) => {
    try { fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, error: String(e) }); }
  };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cleanup-audit-selftest-'));
  const db = path.join(tmp, 'ops.db');
  try {
    const drv = openDriver(db);
    drv.exec('CREATE TABLE session_heartbeat (id TEXT, agent TEXT, last_beat INTEGER)');
    drv.exec('CREATE TABLE approvals (id TEXT, session_id TEXT, status TEXT, created_at TEXT)');
    drv.exec('CREATE TABLE sessions (id TEXT, label TEXT)'); // 活体对照表
    const insert = (sql) => drv.exec(sql);
    // 脏库：l 前缀残留 + 非前缀孤儿
    insert("INSERT INTO session_heartbeat VALUES ('l57-probe', 'probe-agent', 1)");
    insert("INSERT INTO session_heartbeat VALUES ('l58-selftest', 'probe-agent', 2)");
    insert("INSERT INTO session_heartbeat VALUES ('live-session', 'agent', 3)");
    insert("INSERT INTO approvals VALUES ('l60-approve', 'l60-approval', 'pending', '2026-11-26')");
    insert("INSERT INTO approvals VALUES ('a-ok', 'live-session', 'approved', '2026-11-26')");
    insert("INSERT INTO approvals VALUES ('a-ghost', 'ghost-session', 'pending', '2026-11-26')");

    // 自测默认选项（不经 parseArgs 校验，避免空参触发 usage 退出）
    const opts = { pattern: '^l[0-9]+-', re: new RegExp('^l[0-9]+-'), maxRows: 20, extraTables: [], onlyKnown: false };
    const dirty = auditDb(db, { ...opts, maxRows: 20 });
    t('脏库判 fail', () => assert(dirty.verdict === 'fail', `期望 fail，实得 ${dirty.verdict} ${JSON.stringify(dirty.checks)}`));
    t('心跳表残留计数=2', () => {
      const hb = dirty.checks.find((c) => c.table === 'session_heartbeat');
      assert(hb?.residueCount === 2, `期望 2，实得 ${JSON.stringify(hb)}`);
      assert(hb.samples.some((s) => s.value === 'l57-probe'), '样例应含 l57-probe');
    });
    t('approvals 残留计数=1（l60-approve）', () => {
      const ap = dirty.checks.find((c) => c.table === 'approvals' && c.status === 'residue');
      assert(ap?.residueCount === 1, `期望 1，实得 ${JSON.stringify(ap)}`);
    });
    t('孤儿引用检出 ghost-session 与 l60-approval', () => {
      const or = dirty.checks.find((c) => c.table === 'approvals' && c.status === 'orphan');
      const ids = or?.orphans.map((o) => o.session_id) ?? [];
      assert(or?.orphanCount === 2 && ids.includes('ghost-session') && ids.includes('l60-approval'),
        `期望 2 孤儿（ghost-session+l60-approval），实得 ${JSON.stringify(or)}`);
    });
    t('干净行不误伤（live-session / a-ok）', () => {
      const hb = dirty.checks.find((c) => c.table === 'session_heartbeat');
      assert(!hb.samples.some((s) => s.value === 'live-session'), 'live-session 不应判残留');
    });

    // 清场：删 l 前缀 + 孤儿 → 应 pass
    drv.exec("DELETE FROM session_heartbeat WHERE id LIKE 'l%'");
    drv.exec("DELETE FROM approvals WHERE id LIKE 'l%' OR session_id = 'ghost-session'");
    const clean = auditDb(db, { ...opts, maxRows: 20 });
    t('清场后判 pass', () => assert(clean.verdict === 'pass', `期望 pass，实得 ${clean.verdict} ${JSON.stringify(clean.checks)}`));

    // 空 schema（无受检表）→ unverified
    const emptyDb = path.join(tmp, 'empty.db');
    const drv2 = openDriver(emptyDb);
    drv2.exec('CREATE TABLE unrelated (x TEXT)');
    drv2.close();
    const unver = auditDb(emptyDb, { ...opts });
    t('无受检表判 unverified（fail-closed）', () => assert(unver.verdict === 'unverified', `期望 unverified，实得 ${unver.verdict}`));

    // 缺文件 → unverified
    const missing = auditDb(path.join(tmp, 'nope.db'), { ...opts });
    t('缺文件判 unverified', () => assert(missing.verdict === 'unverified', `期望 unverified，实得 ${missing.verdict}`));

    drv.close();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`\n${TOOL} 自测：${results.length - failed.length}/${results.length} 通过\n`);
  for (const r of results) process.stdout.write(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  → ' + r.error}\n`);
  process.exit(failed.length ? 1 : 0);
}

// ---------- 主流程 ----------

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.selfTest) return selfTest();
  const jsonl = [];
  const result = auditDb(opts.db, opts);
  emit(result, opts, jsonl);
  if (!opts.json) process.stdout.write('审计者不得修改探针；改探针须独立 commit+理由（acceptance/audit/independence.md）\n');
  process.exit(result.verdict === 'pass' ? 0 : (result.verdict === 'fail' ? 1 : 2));
}

main();
