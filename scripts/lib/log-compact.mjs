import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAILY_RE = /^(\d{4}-\d{2}-\d{2})(?:-.+)?\.md$/;

function parseDate(filename) {
  const m = filename.match(DAILY_RE);
  return m ? m[1] : null;
}

function isoWeek(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const start = new Date(jan4);
  start.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const diff = Math.floor((d - start) / (7 * 24 * 60 * 60 * 1000));
  const weekNum = diff + 1;
  // ISO week-year: Jan dates in last week of prev year, or Dec dates in first week of next year
  let weekYear = d.getUTCFullYear();
  if (weekNum < 1) {
    weekYear -= 1;
    return `${weekYear}-W53`;
  }
  if (d.getUTCMonth() === 0 && weekNum >= 52) weekYear -= 1;
  if (d.getUTCMonth() === 11 && weekNum === 1) weekYear += 1;
  return `${weekYear}-W${String(weekNum).padStart(2, '0')}`;
}

function monthKey(dateStr) {
  return dateStr.slice(0, 7); // YYYY-MM
}

function yearKey(dateStr) {
  return dateStr.slice(0, 4); // YYYY
}

// ---------------------------------------------------------------------------
// Section extraction from daily logs
// ---------------------------------------------------------------------------

function extractSections(raw) {
  const sections = { plan: '', log: '', externalSignals: '', reflection: '' };
  const lines = raw.split('\n');
  let current = null;

  for (const line of lines) {
    const h2 = line.match(/^## (.+)/);
    if (h2) {
      const heading = h2[1].trim().toLowerCase();
      if (heading === 'plan') current = 'plan';
      else if (heading === 'log') current = 'log';
      else if (heading.startsWith('external signal')) current = 'externalSignals';
      else if (heading === 'reflection') current = 'reflection';
      else current = null;
      continue;
    }
    if (current && !line.startsWith('<!-- ')) {
      sections[current] += line + '\n';
    }
  }

  // Trim trailing whitespace from each section
  for (const key of Object.keys(sections)) {
    sections[key] = sections[key].trim();
  }
  return sections;
}

function extractTaskRefs(text) {
  const refs = new Set();
  for (const m of text.matchAll(/task_[a-z0-9][a-z0-9-]*/g)) {
    refs.add(m[0]);
  }
  return [...refs].sort();
}

function extractLogEntries(logText) {
  if (!logText) return [];
  return logText
    .split('\n')
    .filter((l) => l.match(/^- \d{2}:\d{2}/))
    .map((l) => l.replace(/^- /, '').trim());
}

function condenseExternalSignals(esText) {
  if (!esText) return [];
  const entries = esText.split('\n').filter((l) => l.startsWith('- '));
  // Group by source
  const bySource = new Map();
  for (const entry of entries) {
    const sourceMatch = entry.match(/\[([^\]]+)\]/);
    const source = sourceMatch ? sourceMatch[1] : 'unknown';
    const titleMatch = entry.match(/\[([^\]]+)\]\s+(.+?)(?:\s+\||\s*$)/);
    const title = titleMatch ? titleMatch[2].slice(0, 80) : '(untitled)';
    const bucket = bySource.get(source) ?? [];
    bucket.push(title);
    bySource.set(source, bucket);
  }
  const condensed = [];
  for (const [source, titles] of bySource) {
    if (titles.length <= 2) {
      for (const t of titles) condensed.push(`[${source}] ${t}`);
    } else {
      condensed.push(`[${source}] ${titles.length} updates`);
    }
  }
  return condensed;
}

function extractReflectionHighlights(reflectionText) {
  if (!reflectionText) return [];
  const highlights = [];
  const lines = reflectionText.split('\n');
  for (const line of lines) {
    // Keep lines that start with bullet or numbered entries under ### headings
    if (line.match(/^### /)) {
      highlights.push(line);
    } else if (line.match(/^- \*\*/) || line.match(/^\d+\.\s+\*\*/)) {
      highlights.push(line);
    }
  }
  return highlights;
}

// ---------------------------------------------------------------------------
// Log scanning
// ---------------------------------------------------------------------------

export function scanLogs(repoRoot, member) {
  const logsDir = resolve(repoRoot, 'workspace', member, 'logs');
  if (!existsSync(logsDir)) return [];

  const files = readdirSync(logsDir).filter((f) => DAILY_RE.test(f)).sort();
  return files.map((f) => {
    const date = parseDate(f);
    const filePath = resolve(logsDir, f);
    const stat = statSync(filePath);
    return { filename: f, date, path: filePath, size: stat.size };
  });
}

export function listMembers(repoRoot) {
  const wsDir = resolve(repoRoot, 'workspace');
  if (!existsSync(wsDir)) return [];
  return readdirSync(wsDir).filter((d) => {
    const logsDir = resolve(wsDir, d, 'logs');
    return existsSync(logsDir);
  });
}

// ---------------------------------------------------------------------------
// Compaction tiers
// ---------------------------------------------------------------------------

function parseDailyLog(entry) {
  const raw = readFileSync(entry.path, 'utf8');
  const sections = extractSections(raw);
  return {
    date: entry.date,
    filename: entry.filename,
    size: entry.size,
    taskRefs: extractTaskRefs(raw),
    logEntries: extractLogEntries(sections.log),
    externalSignals: condenseExternalSignals(sections.externalSignals),
    reflectionHighlights: extractReflectionHighlights(sections.reflection),
    hasPlan: sections.plan.length > 0,
    hasReflection: sections.reflection.length > 0,
  };
}

function renderWeeklySummary(week, days) {
  const lines = [];
  lines.push(`# Weekly Summary: ${week}`);
  lines.push('');

  const allTasks = new Set();
  for (const d of days) d.taskRefs.forEach((t) => allTasks.add(t));

  lines.push('## Overview');
  lines.push(`- Working days: ${days.length}`);
  lines.push(`- Date range: ${days[0].date} to ${days[days.length - 1].date}`);
  if (allTasks.size > 0) lines.push(`- Tasks referenced: ${[...allTasks].join(', ')}`);
  lines.push('');

  lines.push('## Daily Highlights');
  for (const d of days) {
    lines.push(`### ${d.date}`);
    if (d.logEntries.length > 0) {
      // Keep up to 5 most important entries per day
      const entries = d.logEntries.slice(0, 5);
      for (const e of entries) lines.push(`- ${e}`);
      if (d.logEntries.length > 5) lines.push(`- ... and ${d.logEntries.length - 5} more entries`);
    } else {
      lines.push('- (no log entries)');
    }
    lines.push('');
  }

  const allSignals = days.flatMap((d) => d.externalSignals);
  if (allSignals.length > 0) {
    lines.push('## External Signals (Condensed)');
    for (const s of allSignals) lines.push(`- ${s}`);
    lines.push('');
  }

  const allReflections = days.flatMap((d) => d.reflectionHighlights);
  if (allReflections.length > 0) {
    lines.push('## Reflection Highlights');
    for (const r of allReflections) lines.push(r);
    lines.push('');
  }

  return lines.join('\n');
}

function renderMonthlySummary(month, weekSummaries, dailyData) {
  const lines = [];
  lines.push(`# Monthly Summary: ${month}`);
  lines.push('');

  const allTasks = new Set();
  for (const d of dailyData) d.taskRefs.forEach((t) => allTasks.add(t));
  const totalLogEntries = dailyData.reduce((n, d) => n + d.logEntries.length, 0);

  lines.push('## Overview');
  lines.push(`- Working days: ${dailyData.length}`);
  lines.push(`- Weeks: ${weekSummaries.length}`);
  lines.push(`- Total log entries: ${totalLogEntries}`);
  if (allTasks.size > 0) lines.push(`- Tasks referenced: ${[...allTasks].join(', ')}`);
  lines.push('');

  lines.push('## Week-by-Week');
  for (const ws of weekSummaries) {
    lines.push(`### ${ws.week} (${ws.days.length} days)`);
    // Summarize: top task refs + entry count per week
    const weekTasks = new Set();
    let weekEntries = 0;
    for (const d of ws.days) {
      d.taskRefs.forEach((t) => weekTasks.add(t));
      weekEntries += d.logEntries.length;
    }
    lines.push(`- ${weekEntries} log entries`);
    if (weekTasks.size > 0) lines.push(`- Focus: ${[...weekTasks].join(', ')}`);
    lines.push('');
  }

  // Condensed reflections across the month
  const allReflections = dailyData.flatMap((d) => d.reflectionHighlights);
  if (allReflections.length > 0) {
    lines.push('## Key Reflections');
    for (const r of allReflections) lines.push(r);
    lines.push('');
  }

  return lines.join('\n');
}

function renderYearlySummary(year, monthSummaries, allDailyData) {
  const lines = [];
  lines.push(`# Yearly Summary: ${year}`);
  lines.push('');

  const allTasks = new Set();
  for (const d of allDailyData) d.taskRefs.forEach((t) => allTasks.add(t));

  lines.push('## Overview');
  lines.push(`- Total working days: ${allDailyData.length}`);
  lines.push(`- Months: ${monthSummaries.length}`);
  lines.push(`- Unique tasks: ${allTasks.size}`);
  lines.push('');

  lines.push('## Month-by-Month');
  for (const ms of monthSummaries) {
    lines.push(`### ${ms.month} (${ms.days.length} working days)`);
    const monthTasks = new Set();
    for (const d of ms.days) d.taskRefs.forEach((t) => monthTasks.add(t));
    if (monthTasks.size > 0) lines.push(`- Focus: ${[...monthTasks].join(', ')}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main compaction logic
// ---------------------------------------------------------------------------

export function compactLogs({ repoRoot, member, force = false, dryRun = false, today = null }) {
  const todayStr = today ?? new Date().toISOString().slice(0, 10);
  const currentWeekStr = isoWeek(todayStr);
  const currentMonthStr = monthKey(todayStr);
  const currentYearStr = yearKey(todayStr);

  const logEntries = scanLogs(repoRoot, member);
  if (logEntries.length === 0) return { member, created: [], skipped: [], message: 'No logs found' };

  const logsDir = resolve(repoRoot, 'workspace', member, 'logs');
  const summariesDir = resolve(logsDir, 'summaries');
  const created = [];
  const skipped = [];

  // Parse all daily logs
  const dailyData = logEntries.map(parseDailyLog);

  // --- Weekly summaries ---
  const byWeek = new Map();
  for (const d of dailyData) {
    const wk = isoWeek(d.date);
    const bucket = byWeek.get(wk) ?? [];
    bucket.push(d);
    byWeek.set(wk, bucket);
  }

  const weekSummaries = [];
  for (const [week, days] of [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (week === currentWeekStr) continue; // skip current week

    const outPath = resolve(summariesDir, 'weekly', `${week}.md`);
    weekSummaries.push({ week, days, path: outPath });

    if (!force && existsSync(outPath)) {
      skipped.push(outPath);
      continue;
    }

    const content = renderWeeklySummary(week, days);
    if (!dryRun) {
      mkdirSync(resolve(summariesDir, 'weekly'), { recursive: true });
      writeFileSync(outPath, content, 'utf8');
    }
    created.push({ tier: 'weekly', key: week, path: outPath, content: dryRun ? content : undefined });
  }

  // --- Monthly summaries ---
  // Group daily data by month (not weeks, which can span month boundaries)
  const dailyByMonth = new Map();
  for (const d of dailyData) {
    const mk = monthKey(d.date);
    const bucket = dailyByMonth.get(mk) ?? [];
    bucket.push(d);
    dailyByMonth.set(mk, bucket);
  }

  // Map weeks to months for the monthly render (a week belongs to the month of its first day)
  const weeksByMonth = new Map();
  for (const ws of weekSummaries) {
    const mk = monthKey(ws.days[0].date);
    const bucket = weeksByMonth.get(mk) ?? [];
    bucket.push(ws);
    weeksByMonth.set(mk, bucket);
  }

  const monthSummaries = [];
  for (const [month, monthDays] of [...dailyByMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (month === currentMonthStr) continue; // skip current month

    const outPath = resolve(summariesDir, 'monthly', `${month}.md`);
    const weeks = weeksByMonth.get(month) ?? [];
    monthSummaries.push({ month, weeks, days: monthDays, path: outPath });

    if (!force && existsSync(outPath)) {
      skipped.push(outPath);
      continue;
    }

    const content = renderMonthlySummary(month, weeks, monthDays);
    if (!dryRun) {
      mkdirSync(resolve(summariesDir, 'monthly'), { recursive: true });
      writeFileSync(outPath, content, 'utf8');
    }
    created.push({ tier: 'monthly', key: month, path: outPath, content: dryRun ? content : undefined });
  }

  // --- Yearly summaries ---
  // Group daily data by year directly
  const dailyByYear = new Map();
  for (const d of dailyData) {
    const yk = yearKey(d.date);
    const bucket = dailyByYear.get(yk) ?? [];
    bucket.push(d);
    dailyByYear.set(yk, bucket);
  }

  // Map month summaries to years
  const monthsByYear = new Map();
  for (const ms of monthSummaries) {
    const yk = yearKey(ms.days[0].date);
    const bucket = monthsByYear.get(yk) ?? [];
    bucket.push(ms);
    monthsByYear.set(yk, bucket);
  }

  for (const [year, yearDays] of [...dailyByYear.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (year === currentYearStr) continue; // skip current year

    const outPath = resolve(summariesDir, 'yearly', `${year}.md`);
    const months = monthsByYear.get(year) ?? [];

    if (!force && existsSync(outPath)) {
      skipped.push(outPath);
      continue;
    }

    const content = renderYearlySummary(year, months, yearDays);
    if (!dryRun) {
      mkdirSync(resolve(summariesDir, 'yearly'), { recursive: true });
      writeFileSync(outPath, content, 'utf8');
    }
    created.push({ tier: 'yearly', key: year, path: outPath, content: dryRun ? content : undefined });
  }

  return { member, created, skipped };
}

// ---------------------------------------------------------------------------
// Structured JSON extraction (for AI consumption)
// ---------------------------------------------------------------------------

export function extractLogData({ repoRoot, member, period = null, today = null }) {
  const todayStr = today ?? new Date().toISOString().slice(0, 10);
  const currentWeekStr = isoWeek(todayStr);
  const currentMonthStr = monthKey(todayStr);

  const logEntries = scanLogs(repoRoot, member);
  if (logEntries.length === 0) return { member, summaries: [] };

  const dailyData = logEntries.map(parseDailyLog);

  // Filter by period if specified
  let filteredData = dailyData;
  if (period) {
    if (period.match(/^\d{4}-W\d{2}$/)) {
      // Specific week
      filteredData = dailyData.filter((d) => isoWeek(d.date) === period);
    } else if (period.match(/^\d{4}-\d{2}$/)) {
      // Specific month
      filteredData = dailyData.filter((d) => monthKey(d.date) === period);
    } else if (period === 'week') {
      // Current week
      filteredData = dailyData.filter((d) => isoWeek(d.date) === currentWeekStr);
    } else if (period === 'month') {
      // Current month
      filteredData = dailyData.filter((d) => monthKey(d.date) === currentMonthStr);
    } else if (period === 'last-week') {
      // Previous week
      const prev = new Date(`${todayStr}T00:00:00Z`);
      prev.setUTCDate(prev.getUTCDate() - 7);
      const prevWeek = isoWeek(prev.toISOString().slice(0, 10));
      filteredData = dailyData.filter((d) => isoWeek(d.date) === prevWeek);
    } else if (period === 'last-month') {
      // Previous month
      const prev = new Date(`${todayStr}T00:00:00Z`);
      prev.setUTCMonth(prev.getUTCMonth() - 1);
      const prevMonth = prev.toISOString().slice(0, 7);
      filteredData = dailyData.filter((d) => monthKey(d.date) === prevMonth);
    }
  }

  if (filteredData.length === 0) return { member, period, summaries: [] };

  // Group into tiers
  const summaries = [];

  // Weekly grouping
  const byWeek = new Map();
  for (const d of filteredData) {
    const wk = isoWeek(d.date);
    const bucket = byWeek.get(wk) ?? [];
    bucket.push(d);
    byWeek.set(wk, bucket);
  }

  for (const [week, days] of [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const allTasks = new Set();
    for (const d of days) d.taskRefs.forEach((t) => allTasks.add(t));

    summaries.push({
      tier: 'weekly',
      key: week,
      taskRefs: [...allTasks],
      days: days.map((d) => ({
        date: d.date,
        taskRefs: d.taskRefs,
        logEntries: d.logEntries,
        condensedSignals: d.externalSignals,
        reflectionHighlights: d.reflectionHighlights,
      })),
    });
  }

  return { member, period: period ?? 'all', summaries };
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export function logStats(repoRoot) {
  const members = listMembers(repoRoot);
  const stats = [];

  for (const member of members) {
    const logs = scanLogs(repoRoot, member);
    const totalSize = logs.reduce((sum, l) => sum + l.size, 0);
    const dates = logs.map((l) => l.date).filter(Boolean).sort();

    // Count existing summaries
    const summariesDir = resolve(repoRoot, 'workspace', member, 'logs', 'summaries');
    let weeklySummaries = 0;
    let monthlySummaries = 0;
    let yearlySummaries = 0;

    if (existsSync(resolve(summariesDir, 'weekly'))) {
      weeklySummaries = readdirSync(resolve(summariesDir, 'weekly')).filter((f) => f.endsWith('.md')).length;
    }
    if (existsSync(resolve(summariesDir, 'monthly'))) {
      monthlySummaries = readdirSync(resolve(summariesDir, 'monthly')).filter((f) => f.endsWith('.md')).length;
    }
    if (existsSync(resolve(summariesDir, 'yearly'))) {
      yearlySummaries = readdirSync(resolve(summariesDir, 'yearly')).filter((f) => f.endsWith('.md')).length;
    }

    stats.push({
      member,
      dailyLogs: logs.length,
      totalSize,
      dateRange: dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : 'none',
      summaries: { weekly: weeklySummaries, monthly: monthlySummaries, yearly: yearlySummaries },
    });
  }

  return stats;
}
