// Team maths (pure, no DOM): periods, earned / received / pending, payout coverage per task.
// Shared by the owner Team pages, the employee panel, the statement PDF and the debug self-test.
import { todayIST, addDays, addMonths, fmtDate, monthLabel, monthKey, round2, sum } from './util.js';

const inRange = (d, from, to) => !!d && d >= from && d <= to;

/** Monday of the week containing `iso` (IST dates are plain YYYY-MM-DD strings). */
export function weekStart(iso) {
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

/**
 * Period → { kind, from, to, label }.
 * kind: today | week | month | last-month | custom (custom uses from/to, swapped if reversed).
 */
export function periodRange(kind, { today = todayIST(), from, to } = {}) {
  if (kind === 'today') return { kind, from: today, to: today, label: `Today · ${fmtDate(today)}` };
  if (kind === 'week') { const f = weekStart(today); return { kind, from: f, to: addDays(f, 6), label: `This week · ${fmtDate(f)} – ${fmtDate(addDays(f, 6))}` }; }
  if (kind === 'month' || kind === 'last-month') {
    const first = (kind === 'month' ? today.slice(0, 7) : addMonths(today.slice(0, 7) + '-01', -1).slice(0, 7)) + '-01';
    const last = addDays(addMonths(first, 1), -1);
    return { kind, from: first, to: last, label: monthLabel(monthKey(first)) };
  }
  let f = from || today; let t = to || f;
  if (t < f) [f, t] = [t, f];
  return { kind: 'custom', from: f, to: t, label: f === t ? fmtDate(f) : `${fmtDate(f)} – ${fmtDate(t)}` };
}

/** Is the task on/over `day` (multi-day tasks span work_date … end_date)? */
export function taskOn(t, day) { return !!t.work_date && t.work_date <= day && (t.end_date && t.end_date > t.work_date ? t.end_date : t.work_date) >= day; }
/** Does the task touch [from, to]? */
export function taskInRange(t, from, to) {
  if (!t.work_date) return false;
  const end = t.end_date && t.end_date > t.work_date ? t.end_date : t.work_date;
  return t.work_date <= to && end >= from;
}

/**
 * Payout coverage: all payouts of a member are applied to that member's done tasks, oldest work first
 * (a payout linked to a task pays that task first). Returns Map taskId → { paid, due, state: paid|partial|unpaid }.
 */
export function payCoverage(tasks, payouts) {
  const out = new Map();
  const byMember = new Map();
  for (const t of tasks) if (t.status === 'done') { if (!byMember.has(t.member_id)) byMember.set(t.member_id, []); byMember.get(t.member_id).push(t); }
  const payBy = new Map();
  for (const p of payouts) { if (!payBy.has(p.member_id)) payBy.set(p.member_id, []); payBy.get(p.member_id).push(p); }
  for (const [mid, list] of byMember) {
    list.sort((a, b) => String(a.work_date).localeCompare(String(b.work_date)) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
    const left = new Map(list.map(t => [t.id, round2(t.amount)]));
    let pool = 0;
    for (const p of payBy.get(mid) || []) {
      let amt = round2(p.amount);
      if (p.task_id && left.has(p.task_id)) { const take = Math.min(left.get(p.task_id), amt); left.set(p.task_id, round2(left.get(p.task_id) - take)); amt = round2(amt - take); }
      pool = round2(pool + amt);
    }
    for (const t of list) { const take = Math.min(left.get(t.id), pool); left.set(t.id, round2(left.get(t.id) - take)); pool = round2(pool - take); }
    for (const t of list) {
      const amt = round2(t.amount); const due = left.get(t.id); const paid = round2(amt - due);
      out.set(t.id, { paid, due, state: amt <= 0 || due <= 0.009 ? 'paid' : paid > 0 ? 'partial' : 'unpaid' });
    }
  }
  return out;
}

/**
 * Stats for one member. tasks / payouts may contain other members' rows (they are filtered).
 * period optional: { from, to }. Pending is always all-time: done amounts − payouts.
 */
export function memberStats(memberId, tasks, payouts, period) {
  const T = tasks.filter(t => t.member_id === memberId && t.status !== 'cancelled');
  const P = payouts.filter(p => p.member_id === memberId);
  const done = T.filter(t => t.status === 'done');
  const earnedAll = round2(sum(done, t => t.amount));
  const paidAll = round2(sum(P, p => p.amount));
  const r = { earnedAll, paidAll, pending: round2(earnedAll - paidAll), taskCount: T.length, openCount: T.filter(t => t.status === 'assigned' || t.status === 'in_progress').length };
  if (period) {
    const inP = T.filter(t => inRange(t.work_date, period.from, period.to));
    r.periodTasks = inP.length;
    r.earned = round2(sum(inP.filter(t => t.status === 'done'), t => t.amount));
    r.scheduled = round2(sum(inP.filter(t => t.status !== 'done'), t => t.amount));
    r.received = round2(sum(P.filter(p => inRange(p.payout_date, period.from, period.to)), p => p.amount));
  }
  return r;
}

/** Team total still owed (sum of positive per-member pending). */
export function teamPending(members, tasks, payouts) {
  return round2(sum(members, m => Math.max(0, memberStats(m.id, tasks, payouts).pending)));
}
