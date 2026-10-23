/** 用户端与管理端的点数支出、翻译请求图表，沿用账户总览配色和交互。 */
import { html } from 'hono/html';
import { k } from '../src/i18n/index.js';
import { displayCredits, UNITS_PER_CREDIT } from '../src/credits/units.js';
import { timeChart } from './charts.js';

export function activityCharts(ui, activity, { action, incomeType = '' }) {
  const { t, locale } = ui;
  const { totals, days } = activity;
  const num = (value) => new Intl.NumberFormat(locale.htmlLang).format(value);
  const compact = (value) => new Intl.NumberFormat(locale.htmlLang, { notation: 'compact', maximumFractionDigits: 2 }).format(value);
  const shortDate = new Intl.DateTimeFormat(locale.htmlLang, { timeZone: 'UTC', month: 'numeric', day: 'numeric' });
  const tooltipDate = new Intl.DateTimeFormat(locale.htmlLang, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
  // 日期标签已是按 activity.timeZone 切分的日期，格式化时按 UTC 读取以免再次换算。
  const dayDate = (day) => new Date(`${day}T00:00:00Z`);
  const zone = activity.timeZone || 'UTC';
  const series = (label, field, cls, credits = false) => ({ name: String(label), field, cls, kind: 'bar',
    // 只有 SVG 坐标转换成 Number，合计与悬停文字保留 BigInt 精度。
    values: days.map((day) => Number(day[field]) / (credits ? Number(UNITS_PER_CREDIT) : 1)),
  });
  const pointValue = (units) => `${displayCredits(units)} ${t('点')}`;
  const chart = (items, total, totalField, value, extra = []) => timeChart({
    labels: days.map((day) => day.day), series: items, stacked: true, width: 490, height: 260,
    axisFormat: compact, labelFormat: (day) => shortDate.format(dayDate(day)),
    interactive: true, tooltipDateFormat: (day) => `${tooltipDate.format(dayDate(day))} ${zone}`,
    tooltipItems: (i) => [
      ...items.map((s) => ({ label: s.name, value: value(days[i][s.field]), tone: s.cls })),
      { label: String(total), value: value(days[i][totalField]), total: true },
      ...extra.map(([label, field]) => ({ label: String(label), value: num(days[i][field]) })),
    ],
  }) || html`<div class="overview-empty" role="status">${t('所选范围内暂无可展示的数据。')}</div>`;
  return html`<div class="overview credit-activity">
  <div class="overview-toolbar">
    <form method="get" action="${action}" class="overview-filters">
      ${incomeType ? html`<input type="hidden" name="type" value="${incomeType}">` : ''}
      <label class="overview-filter"><span>${t('时间范围')}</span><select name="period">
        ${[['month', k('本月')], ['7d', k('近 7 天')], ['30d', k('近 30 天')]].map(([value, label]) => html`<option value="${value}"${activity.period === value ? html` selected` : ''}>${t(label)}</option>`)}
      </select></label>
      <button class="button" type="submit">${t('筛选')}</button>
      ${activity.period !== 'month' ? html`<a class="overview-reset" href="${action}${incomeType ? `?type=${incomeType}` : ''}">${t('清除筛选条件')}</a>` : ''}
    </form>
    <span class="overview-timezone">${zone}</span>
  </div>
  <div class="overview-chart-grid">
    <section class="overview-chart" data-chart="credit-expenses">
      <div class="overview-chart-head"><h2>${t('点数支出')}<span data-spent>${pointValue(totals.spent_units)}</span></h2></div>
      ${chart([series(t('托管翻译扣点'), 'usage_units', 'usage-primary', true), series(t('点数作废'), 'void_units', 'usage-secondary', true)], t('点数支出'), 'spent_units', pointValue)}
      <p class="credit-activity-note">${t('预扣与作废计入支出，失败返还计入收入。')}</p>
    </section>
    <section class="overview-chart" data-chart="translation-requests">
      <div class="overview-chart-head"><h2>${t('翻译请求')}<span data-requests>${num(totals.requests)}</span></h2></div>
      ${chart([series(t('成功'), 'ok', 'usage-primary'), series(t('失败（已返还）'), 'failed', 'usage-failed'), series(t('处理中'), 'pending', 'usage-secondary')], t('请求次数'), 'requests', num, [[t('字数'), 'chars']])}
      <p class="credit-activity-note">${t('只记录类型、字数、扣点和结果，不保存原文或译文。')}</p>
    </section>
  </div>
  <p class="overview-note">${t('图表统计所选范围内的全部记录，明细最多显示 {count} 条。', { count: activity.limit })}</p>
</div>`;
}
