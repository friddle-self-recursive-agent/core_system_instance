#!/usr/bin/env node
// report-audit.mjs — G-10 验收报告审计探针（acceptance/audit/probes/）
//
// 目标差距：design-code-gap-2026-11-26.md G-10「截图必选被跳过未标 unverified」。
// 规约来源：runtime/acceptance.md §4（loop 报告模板）/ §8（截图强制）+
//           runtime/perf-lint-baseline.md §3 机械门 2「UI 轮无截图=该项 unverified 不许 PASS」+
//           acceptance/bugs/bug.md §3（B1..B14 必检回归探针清单，动态解析）。
//
// 【审计资产红线（G-09 独立性规约）】探针脚本入 git 后视为审计资产：
// 验收者/被验收 agent 不得修改本探针；改探针须独立 commit + 理由（见 acceptance/audit/independence.md）。
//
// 判定（fail-closed：无证据 ≠ PASS）：
//   R1 报告无 probes 区/无任何探针条目        → 整份 unverified
//   R2 必检探针（bug.md §3 清单）缺失         → 强制 unverified
//   R3 pass 项无证据文本                      → 强制 unverified
//   R4 UI/交互/渲染类 pass 项无截图证据引用    → 强制 unverified
//   R5 pass 项证据含「跳过截图/无图像输入」等豁免话术 → 强制 unverified（loop-77/78/79 反模式）
//   R6 证据引用的截图文件在盘上不存在         → 强制 unverified（能解析路径时）
//   R7 状态词不在 pass|fail|unverified        → 强制 unverified
//   R8 任一探针显式 fail                      → 整份 FAIL
// 退出码：0=pass  1=fail  2=unverified  3=用法/IO 错误
//
// 用法：
//   node report-audit.mjs <report.md> [more.md ...] [选项]
// 选项：
//   --mandatory <file>  必检探针清单（缺省=仓库内 acceptance/bugs/bug.md，找不到则回退内置 B1..B9）
//   --repo-root <dir>   仓库根（缺省=对每份报告向上找 .git）
//   --json              stdout 只输出 JSON 行（机读）；缺省=人类摘要
//   --out <file>        另存 JSON 行结果文件
//   --self-test         内置 fixture 自测（不依赖外部文件），跑绿后 exit 0
//
// 零外部依赖（node 标准库）。行数预算 ≤800（R-ENG-7）。

import { readFileSync, writeFileSync, existsSync, statSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const TOOL = 'report-audit.mjs';
const VERSION = '1.0.0';

// ---------- 通用：环境指纹（G-09 要求探针输出含环境指纹） ----------

function sha256File(p) {
  try { return createHash('sha256').update(readFileSync(p)).digest('hex'); } catch { return null; }
}

function gitHead(dir) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}

function findRepoRoot(startDir) {
  let d = path.resolve(startDir);
  while (true) {
    if (existsSync(path.join(d, '.git'))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

function envFingerprint(extra) {
  return {
    tool: TOOL, version: VERSION,
    node: process.version, platform: os.platform(), release: os.release(), arch: os.arch(),
    hostname: os.hostname(),
    cwd: process.cwd(),
    utc: new Date().toISOString(),
    script_sha256: sha256File(fileURLToSelfPath()),
    git_head: extra?.git_head ?? null,
    ...extra,
  };
}

function fileURLToSelfPath() {
  // import.meta.url → 本脚本绝对路径（自哈希用于篡改留痕）
  try {
    const u = new URL(import.meta.url);
    return u.protocol === 'file:' ? decodeURIComponent(u.pathname) : null;
  } catch { return null; }
}

// ---------- 参数解析 ----------

function parseArgs(argv) {
  const opts = {
    reports: [], mandatory: null, repoRoot: null, json: false, out: null, selfTest: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--self-test') opts.selfTest = true;
    else if (a === '--out') opts.out = argv[++i] ?? fail('参数错误：--out 需要文件路径');
    else if (a === '--mandatory') opts.mandatory = argv[++i] ?? fail('参数错误：--mandatory 需要文件路径');
    else if (a === '--repo-root') opts.repoRoot = argv[++i] ?? fail('参数错误：--repo-root 需要目录');
    else if (a === '-h' || a === '--help') usageAndExit();
    else if (a.startsWith('--')) fail(`未知参数：${a}`);
    else opts.reports.push(a);
  }
  if (!opts.selfTest && opts.reports.length === 0) {
    usageAndExit('缺少报告文件参数');
  }
  return opts;
}

function usageAndExit(msg) {
  if (msg) process.stderr.write(`${TOOL}: ${msg}\n`);
  process.stderr.write(`用法: node ${TOOL} <report.md> [more.md ...] [--mandatory <file>] [--repo-root <dir>] [--json] [--out <file>] [--self-test]\n`);
  process.exit(3);
}

function fail(msg) { process.stderr.write(`${TOOL}: ${msg}\n`); process.exit(3); }

// ---------- 必检探针清单解析（acceptance/bugs/bug.md §3） ----------

const FALLBACK_MANDATORY = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9'];

function parseMandatoryList(file, jsonl) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) {
    jsonl.push({ type: 'mandatory-source', file, status: 'missing', fallback: FALLBACK_MANDATORY.join(','), error: String(e) });
    return FALLBACK_MANDATORY.map((id) => ({ id, title: '' }));
  }
  const items = [];
  // 形态：- **`B1`（三段式 Session 闭环）**：...
  const re = /^\s*-\s*\*\*`?(B\d+)`?(?:（([^）]*)）)?\*\*/;
  for (const line of text.split(/\r?\n/)) {
    const m = re.exec(line);
    if (m) items.push({ id: m[1], title: m[2] ?? '' });
  }
  if (items.length === 0) {
    jsonl.push({ type: 'mandatory-source', file, status: 'no-items', fallback: FALLBACK_MANDATORY.join(',') });
    return FALLBACK_MANDATORY.map((id) => ({ id, title: '' }));
  }
  jsonl.push({ type: 'mandatory-source', file, status: 'ok', count: items.length });
  return items;
}

// ---------- 报告探针条目解析（acceptance.md §4 列表形态 + §8 表格形态） ----------

const STATUS_RE = /\b(pass|fail|unverified)\b/i;
const STATUS_CELL_RE = /^(pass|fail|unverified)[!:：]?\s*$/i;
const SHOT_RE = /(?:[\w.@/-]+\.(?:png|jpe?g|webp))|(?:acceptance\/shots\/[^\s）)]*)/i;
// loop-77/78/79 反模式：以「无图像输入」类话术跳过截图却记 PASS
const SKIP_PHRASE_RE = /无图像输入|跳过截图|未截图|无截图|截图失败|无法截图|截不了图|无浏览器|浏览器不可用|无头浏览器不可用|无头不可用|headless\s*不可用|no\s+screenshot|skips?\s+screenshot/i;
const UI_CLASS_RE = /UI|页面|屏|渲染|界面|截图|点击|交互|前端|浏览器|console|web\b|screen|dom\b|route|路由|深链/i;

function isProbeEntryLine(line) {
  // 列表形态：- <条目>: pass|fail|unverified（证据一行）——probes 区内所有 `- ` 项均按此对待
  return /^\s*-\s+\S/.test(line);
}

function parseListEntry(line, continuationLines) {
  const body = [line.trim(), ...continuationLines.map((l) => l.trim())].join(' ');
  const m = /^\s*-\s+(.+)$/.exec(line);
  const rest = m ? m[1] : line.trim();
  const sm = STATUS_RE.exec(rest);
  const status = sm ? sm[1].toLowerCase() : null;
  // 名称=「状态词之前」或「首个冒号之前」（无状态词时，R7）
  const cut = status ? sm.index : (rest.search(/[:：]/) === -1 ? rest.length : rest.search(/[:：]/));
  const namePart = rest.slice(0, cut).trim();
  const evidencePart = status
    ? (rest.slice(sm.index + sm[0].length).trim() + ' ' + continuationLines.map((l) => l.trim()).join(' ')).trim()
    : rest.slice(cut).replace(/^[:：]\s*/, '').trim();
  return {
    kind: 'list', raw: body, name: cleanName(namePart), declared: status,
    evidence: stripParensOuter(evidencePart) || evidencePart.trim(),
  };
}

function parseTableRow(line) {
  const cells = line.split('|').map((c) => c.trim()).filter((c, i, arr) => !(i === 0 && c === '') && !(i === arr.length - 1 && c === ''));
  if (cells.length < 2) return null;
  const si = cells.findIndex((c) => STATUS_CELL_RE.test(c));
  if (si === -1) return null;
  const name = cells[0].replace(/^\*+|\*+$/g, '').trim();
  const evidence = cells.filter((_, i) => i !== si && i !== 0).join(' ');
  return {
    kind: 'table', raw: line.trim(), name, declared: cells[si].toLowerCase().replace(/[!:：]/g, '').trim(),
    evidence,
  };
}

function cleanName(s) {
  return s.replace(/^[-*`【\[]+\s*/, '').replace(/[`:：]\s*$/, '').replace(/\*+/g, '').trim();
}

function stripParensOuter(s) {
  const m = /^[（(](.*)[）)]\s*$/.exec(s.trim());
  return m ? m[1].trim() : s.trim();
}

function parseReport(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  const notes = [];

  // 表格形态：任意含状态单元格的表行（跳过表头分隔行）
  for (const raw of lines) {
    const line = raw.trim();
    if (/^\|/.test(line) && !/^\|[\s:|-]+\|?$/.test(line) && !/^\|\s*(探针|条目|项|check|probe)\b/i.test(line)) {
      const row = parseTableRow(line);
      if (row) entries.push(row);
    }
  }

  // 列表形态：probes: 区内的列表项——凡 `- ` 项即探针条目；
  // 状态词不是 pass|fail|unverified 的条目照收（declared=null → R7 强制 unverified）
  let inProbesBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const header = /^probes\s*:\s*$/i.exec(line.trim());
    if (header) { inProbesBlock = true; continue; }
    const startsSection = /^\S[^：:\s]*\s*:\s*/.test(line.trim());
    if (inProbesBlock && startsSection && !/^\s+-/.test(line)) inProbesBlock = false;
    if (!inProbesBlock) continue;
    if (/^\s*-\s+\S/.test(line)) {
      // 收集续行（更深缩进的非列表行）
      const cont = [];
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (!l.trim()) break;
        if (/^\s*-\s+/.test(l) || /^\S[^：:\s]*\s*:\s*/.test(l.trim())) break;
        if (/^\s{2,}\S/.test(l)) cont.push(l);
        else break;
      }
      entries.push(parseListEntry(line, cont));
      i += cont.length;
    }
  }

  // 去重（同一表行可能同时命中列表解析器——按 raw 去重；同名取最严状态在合并阶段处理）
  const seen = new Set();
  const dedup = [];
  for (const e of entries) {
    const key = `${e.kind}::${e.raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(e);
  }

  // 头部字段（advisory，不降判）：trigger/docs/code/build/test/lint
  for (const field of ['trigger', 'docs', 'code', 'build', 'test', 'lint']) {
    if (!new RegExp(`^\\s*${field}\\s*:`, 'm').test(text)) notes.push(`头部缺字段 ${field}:（acceptance.md §4 模板字段，仅提示）`);
  }
  return { entries: dedup, notes };
}

// ---------- 判定（fail-closed） ----------

function resolveShotPath(ref, reportDir, repoRoot) {
  const candidates = [];
  const clean = ref.replace(/^[（(]|[）),.;]+$/g, '').trim();
  if (path.isAbsolute(clean)) candidates.push(clean);
  else {
    candidates.push(path.resolve(reportDir, clean));
    if (repoRoot) candidates.push(path.resolve(repoRoot, clean));
  }
  for (const c of candidates) { if (existsSync(c) && statSync(c).isFile()) return { resolved: c, exists: true }; }
  return { resolved: candidates[0], exists: false };
}

function auditOne(entry, ctx) {
  const reasons = [];
  let effective = entry.declared;
  const text = `${entry.name} ${entry.evidence}`;

  if (!entry.declared) {
    effective = 'unverified';
    reasons.push('R7 状态词缺失或不识别（pass|fail|unverified）');
  } else if (entry.declared === 'fail') {
    effective = 'fail';
    reasons.push('R8 显式 fail');
  } else if (entry.declared === 'pass') {
    // R3 证据非空
    if (!entry.evidence || entry.evidence.length < 3) {
      effective = 'unverified'; reasons.push('R3 pass 无证据文本（无证据≠PASS）');
    }
    // R5 豁免话术
    if (SKIP_PHRASE_RE.test(entry.evidence)) {
      effective = 'unverified';
      reasons.push('R5 证据含跳过截图/无图像输入类话术（G-10 反模式，禁止 PASS）');
    }
    // R4 UI 类必须附截图引用
    const isUi = UI_CLASS_RE.test(text);
    const shotRef = SHOT_RE.exec(entry.evidence)?.[0] ?? null;
    if (isUi && !shotRef) {
      effective = 'unverified';
      reasons.push('R4 UI/交互/渲染类 pass 无截图证据引用（acceptance.md §8：截图失败=unverified，DOM 断言不替代）');
    }
    // R6 截图文件在盘上存在
    if (shotRef) {
      const r = resolveShotPath(shotRef, ctx.reportDir, ctx.repoRoot);
      entry.shot = { ref: shotRef, path: r.resolved, exists: r.exists };
      if (!r.exists) {
        effective = 'unverified';
        reasons.push('R6 引用的截图文件在盘上不存在（证据路径不可核）');
      }
    }
    ctx.counts.uiPass += isUi && entry.declared === 'pass' ? 1 : 0;
  }
  // unverified 声明保持 unverified
  if (entry.declared === 'unverified') reasons.push('声明即 unverified');
  return { ...entry, effective, reasons };
}

function auditReport(file, opts, jsonl) {
  const abs = path.resolve(file);
  let text;
  try { text = readFileSync(abs, 'utf8'); } catch (e) {
    return { file: abs, verdict: 'unverified', probes: [], mandatoryMissing: [], notes: [String(e)],
      fingerprint: envFingerprint({ report: abs, report_sha256: null }) };
  }
  const reportDir = path.dirname(abs);
  const repoRoot = opts.repoRoot ? path.resolve(opts.repoRoot) : findRepoRoot(reportDir);
  const mandatoryFile = opts.mandatory
    ? path.resolve(opts.mandatory)
    : (repoRoot ? path.join(repoRoot, 'acceptance', 'bugs', 'bug.md') : null);
  const notes0 = [];
  let mandatory = [];
  let mandatoryStatus = 'unavailable';
  if (mandatoryFile) {
    const before = jsonl.length;
    mandatory = parseMandatoryList(mandatoryFile, jsonl);
    const evt = jsonl[before];
    mandatoryStatus = evt?.status === 'ok' ? 'ok' : (evt?.status ?? 'missing');
  } else {
    notes0.push('必检清单不可得（无 --mandatory 且未定位到仓库根）→ fail-closed 强制 unverified');
    jsonl.push({ type: 'mandatory-source', file: null, status: 'unavailable' });
  }
  const { entries, notes } = parseReport(text);
  notes.push(...notes0);

  const ctx = { reportDir, repoRoot, counts: { uiPass: 0 } };
  const audited = entries.map((e) => auditOne(e, ctx));

  // R2 必检探针覆盖：按 token（B1 与 B10 词边界区分）
  const presentTokens = new Set();
  for (const e of audited) {
    for (const m of e.name.matchAll(/(?<![A-Za-z0-9])B(\d+)(?!\d)/g)) presentTokens.add(`B${m[1]}`);
    for (const m of e.evidence.matchAll(/(?<![A-Za-z0-9])B(\d+)(?!\d)/g)) presentTokens.add(`B${m[1]}`);
  }
  const mandatoryMissing = mandatory.filter((m) => !presentTokens.has(m.id));

  const anyFail = audited.some((e) => e.effective === 'fail');
  const anyUnverified = audited.length === 0 || mandatoryStatus !== 'ok' || mandatoryMissing.length > 0 || audited.some((e) => e.effective === 'unverified');
  const verdict = anyFail ? 'fail' : (anyUnverified ? 'unverified' : 'pass');

  return {
    file: abs,
    verdict,
    probes: audited,
    mandatory: { source: mandatoryFile, status: mandatoryStatus, required: mandatory.map((m) => m.id), missing: mandatoryMissing.map((m) => m.id) },
    notes,
    fingerprint: envFingerprint({ report: abs, report_sha256: sha256File(abs), repo_root: repoRoot, git_head: gitHead(repoRoot ?? reportDir), probes_total: audited.length, ui_pass_total: ctx.counts.uiPass }),
  };
}

// ---------- 输出 ----------

function emit(result, opts, jsonl) {
  const record = { type: 'report-audit', ...result };
  jsonl.push(record);
  if (opts.out) {
    try { writeFileSync(opts.out, jsonl.map((j) => JSON.stringify(j)).join('\n') + '\n'); } catch (e) {
      process.stderr.write(`${TOOL}: 写 --out 失败：${e}\n`);
    }
  }
  if (opts.json) {
    for (const j of jsonl) process.stdout.write(JSON.stringify(j) + '\n');
    return;
  }
  // 人类摘要
  const line = '─'.repeat(60);
  process.stdout.write(`${line}\n${TOOL} v${VERSION} — G-10 验收报告审计（fail-closed）\n${line}\n`);
  process.stdout.write(`报告: ${result.file}\n结论: ${result.verdict.toUpperCase()}\n`);
  if (result.probes?.length) {
    process.stdout.write(`探针 ${result.probes.length} 条；UI-pass ${result.fingerprint.ui_pass_total} 条\n`);
    for (const p of result.probes) {
      const flag = p.effective === 'pass' ? ' ' : '!';
      process.stdout.write(` [${flag}] ${p.name.slice(0, 48)}  声明=${p.declared ?? '∅'} → 判定=${p.effective}${p.reasons.length ? '  (' + p.reasons.join('; ') + ')' : ''}\n`);
    }
  }
  if (result.mandatory?.missing?.length) process.stdout.write(`必检探针缺失: ${result.mandatory.missing.join(', ')}\n`);
  for (const n of result.notes ?? []) process.stdout.write(`note: ${n}\n`);
  const fp = result.fingerprint;
  process.stdout.write(`指纹: node=${fp.node} ${fp.platform}/${fp.arch} script=${fp.script_sha256?.slice(0, 12)} git=${fp.git_head?.slice(0, 12) ?? '∅'} utc=${fp.utc}\n`);
}

// ---------- 内置自测（fixture） ----------

function selfTest() {
  const results = [];
  const t = (name, fn) => {
    try { fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, error: String(e) }); }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  const goodReport = [
    '# loop-99 2026-11-26',
    'trigger: manual',
    'docs: core_design@abc core_system_instance@def',
    'code: workservice@123 plugin@456',
    'build: ok  test: 10/10  lint: 全绿',
    'probes:',
    '  - B1（三段式 Session 闭环）: pass（acceptance/shots/loop-99-b1.png 第一段侦察命令可见）',
    '  - B2（0–100 标度统一）: pass（lint 输出全绿见 acceptance/shots/loop-99-b2.png）',
    '  - B3: pass（session 复用日志 kv-cache 命中记录）',
    '  - B4: pass（TagCtxShard 命中日志）',
    '  - B5: pass（stale 计数对比）',
    '  - B6: pass（Judge 审核记录）',
    '  - B7: pass（event_log 分类计数）',
    '  - B8: pass（single-scheme 绿）',
    '  - B9: pass（docs DB 挂载日志）',
    '  - B10: pass（scope 拦截测试）',
    '  - B11: pass（trace 聚合查询）',
    '  - B12: pass（rollback 分派用例）',
    '  - B13: pass（409 冲突样例）',
    '  - B14: pass（trustGate 校验记录）',
    '  - console 主屏渲染: pass（acceptance/shots/loop-99-main.png）',
    'deviations:',
    '  - none',
    'next: watch',
  ].join('\n');

  const badReport = [
    '# loop-98 2026-11-25',
    'trigger: manual',
    'probes:',
    '  - B1: pass（无图像输入，跳过截图）',          // R5
    '  - B2: pass',                                    // R3
    '  - B3: pass（主屏 DOM 检查通过）',               // R4（UI 类无截图）
    '  - B4: pass（acceptance/shots/loop-98-gone.png）', // R6（盘上不存在）
    '  - B5: done（自判通过）',                        // R7
    '  - B6: fail（未跑）',                            // R8
    'deviations:',
    '  - none',
  ].join('\n');

  // 构造 fixture 目录：报告 + 在盘截图
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'report-audit-selftest-'));
  try {
    const shots = path.join(tmp, 'acceptance', 'shots');
    mkdirSync(shots, { recursive: true });
    mkdirSync(path.join(shots, 'docs'), { recursive: true });
    // 必检清单 fixture（模拟 acceptance/bugs/bug.md §3，含 B10+ 双位数编号形态）
    const bugsDir = path.join(tmp, 'acceptance', 'bugs');
    mkdirSync(bugsDir, { recursive: true });
    const bugFixture = ['## 3. 验收报告必检探针清单',
      ...Array.from({ length: 14 }, (_, i) => {
        const n = i + 1;
        return n === 10
          ? '- **`B10`（底层 `Heartbeat` 默认隐藏与 Scope 隔离）**：fixture 条目'
          : `- **\`B${n}\`（fixture 探针 ${n}）**：fixture 条目`;
      })].join('\n');
    writeFileSync(path.join(bugsDir, 'bug.md'), bugFixture);
    writeFileSync(path.join(shots, 'loop-99-b1.png'), 'png');
    writeFileSync(path.join(shots, 'loop-99-b2.png'), 'png');
    writeFileSync(path.join(shots, 'loop-99-main.png'), 'png');
    writeFileSync(path.join(shots, 'docs', 'shot-b3.png'), 'png');
    const goodPath = path.join(tmp, 'loop-99.md');
    const badPath = path.join(tmp, 'loop-98.md');
    writeFileSync(goodPath, goodReport);
    writeFileSync(badPath, badReport);

    const j1 = [];
    const r1 = auditReport(goodPath, { repoRoot: tmp }, j1);
    t('好报告（证据齐+截图在盘）判 pass', () => {
      assert(r1.verdict === 'pass', `期望 pass，实得 ${r1.verdict}，probes=${JSON.stringify(r1.probes?.map((p) => [p.name, p.effective]))}`);
      assert(r1.mandatory.missing.length === 0, `必检缺失: ${r1.mandatory.missing}`);
    });
    t('必检清单覆盖 B1..B14', () => assert(r1.mandatory.required.length >= 14, `必检清单仅 ${r1.mandatory.required.length} 项`));

    const j2 = [];
    const r2 = auditReport(badPath, { repoRoot: tmp }, j2);
    t('坏报告判 fail（含显式 fail）', () => assert(r2.verdict === 'fail', `期望 fail，实得 ${r2.verdict}`));
    const byName = (frag) => r2.probes.find((p) => p.name.includes(frag));
    t('R5 豁免话术强制 unverified', () => assert(byName('B1')?.effective === 'unverified' && byName('B1').reasons.some((r) => r.startsWith('R5')), JSON.stringify(byName('B1'))));
    t('R3 无证据强制 unverified', () => assert(byName('B2')?.effective === 'unverified', JSON.stringify(byName('B2'))));
    t('R4 UI 类无截图强制 unverified', () => assert(byName('B3')?.effective === 'unverified' && byName('B3').reasons.some((r) => r.startsWith('R4')), JSON.stringify(byName('B3'))));
    t('R6 截图不在盘强制 unverified', () => assert(byName('B4')?.effective === 'unverified' && byName('B4').reasons.some((r) => r.startsWith('R6')), JSON.stringify(byName('B4'))));
    t('R7 未知状态强制 unverified', () => assert(byName('B5')?.effective === 'unverified', JSON.stringify(byName('B5'))));
    t('R8 显式 fail 传导', () => assert(byName('B6')?.effective === 'fail', JSON.stringify(byName('B6'))));

    t('缺必检探针 → unverified', () => {
      const partial = path.join(tmp, 'loop-97.md');
      writeFileSync(partial, 'probes:\n  - B1: pass（acceptance/shots/loop-99-b1.png）\n');
      const r = auditReport(partial, { repoRoot: tmp }, []);
      assert(r.verdict === 'unverified', `期望 unverified，实得 ${r.verdict}`);
      assert(r.mandatory.missing.length > 0, '应列出缺失必检项');
    });
    t('空 probes 区 → unverified', () => {
      const empty = path.join(tmp, 'loop-96.md');
      writeFileSync(empty, '# loop-96\ndeviations:\n  - none\n');
      const r = auditReport(empty, { repoRoot: tmp }, []);
      assert(r.verdict === 'unverified', `期望 unverified，实得 ${r.verdict}`);
    });
    t('表格形态可解析', () => {
      const tbl = path.join(tmp, 'loop-95.md');
      writeFileSync(tbl, [
        '| 探针 | 结果 | 证据 |',
        '|---|---|---|',
        '| B1 三段式 | pass | acceptance/shots/loop-99-b1.png |',
        '| B2 标度 | fail | lint 红 |',
      ].join('\n'));
      const r = auditReport(tbl, { repoRoot: tmp }, []);
      assert(r.probes.length === 2, `表行应解析 2 条，实得 ${r.probes.length}`);
      assert(r.verdict === 'fail', `期望 fail，实得 ${r.verdict}`);
    });
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
  const results = opts.reports.map((f) => auditReport(f, opts, jsonl));
  const worst = results.some((r) => r.verdict === 'fail') ? 'fail'
    : (results.some((r) => r.verdict === 'unverified') ? 'unverified' : 'pass');
  const overall = { type: 'overall', verdict: worst, reports: results.length, fingerprint: envFingerprint({}) };
  for (const r of results) emit(r, opts, jsonl);
  jsonl.push(overall);
  if (opts.out) writeFileSync(opts.out, jsonl.map((j) => JSON.stringify(j)).join('\n') + '\n');
  if (opts.json) {
    // emit 已逐条输出；补 overall
    process.stdout.write(JSON.stringify(overall) + '\n');
  } else {
    process.stdout.write(`\n总判定: ${worst.toUpperCase()}（${results.length} 份报告）\n审计者不得修改探针；改探针须独立 commit+理由（acceptance/audit/independence.md）\n`);
  }
  process.exit(worst === 'pass' ? 0 : (worst === 'fail' ? 1 : 2));
}

main();
