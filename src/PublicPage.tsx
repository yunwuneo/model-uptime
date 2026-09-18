import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  Clock3,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Radio,
  Zap,
  LockKeyhole,
} from 'lucide-react';
import type { Incident, PublicMonitor, StatusPage } from '../shared/types';
import { api } from './api';
import { demoPage } from './demo';
import { ModelIcon } from './ModelIcon';
import {
  Badge,
  Brand,
  Empty,
  External,
  Help,
  MetricCard,
  Modal,
  Spinner,
  TrendChart,
  dateTime,
  endpointLabel,
  formatMs,
  formatPct,
  formatTps,
} from './ui';

const headings = {
  operational: '一切运行如常。',
  degraded: '部分服务性能下降。',
  pending: '正在确认服务异常。',
  down: '部分服务暂时不可用。',
  unknown: '等待下一次响应。',
  paused: '监控已暂停。',
};
const statusName: Record<Incident['status'], string> = {
  investigating: '正在调查',
  identified: '已定位',
  monitoring: '持续观察',
  resolved: '已解决',
  maintenance: '计划维护',
};
function History({ monitor }: { monitor: PublicMonitor }) {
  const samples = monitor.history.reduce((sum, d) => sum + d.samples, 0);
  const rate = samples
    ? monitor.history.reduce((sum, d) => sum + (d.successRate ?? 0) * d.samples, 0) / samples
    : null;
  return (
    <div className="history-cell">
      <div className="uptime-history" aria-label="最近90天探测成功率">
        {monitor.history.map((d) => (
          <span
            key={d.date}
            className={
              d.successRate === null
                ? 'no-data'
                : d.successRate < 95
                  ? 'bad'
                  : d.successRate < 100
                    ? 'partial'
                    : 'good'
            }
            title={`${d.date} · ${d.successRate === null ? '无数据' : formatPct(d.successRate)} · ${d.samples} 次探测`}
          />
        ))}
      </div>
      <div>
        <span>90 天前</span>
        <strong>{formatPct(rate)}</strong>
        <span>今天</span>
      </div>
    </div>
  );
}
export function PublicPage() {
  const [params, setParams] = useSearchParams(),
    demo = params.get('demo') === '1';
  const [hours, setHours] = useState(24),
    [data, setData] = useState<StatusPage | null>(null),
    [error, setError] = useState('');
  const [loading, setLoading] = useState(true),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null),
    [chartField, setChartField] = useState<'ttftMs' | 'latencyMs' | 'tps'>('ttftMs');
  const [performanceId, setPerformanceId] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = demo ? demoPage(hours) : await api<StatusPage>(`/status?hours=${hours}`);
      setData(result);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '状态加载失败');
    } finally {
      setLoading(false);
    }
  }, [demo, hours]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 30000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (data) document.title = `${data.site.title} · 模型服务状态`;
  }, [data]);
  const groups = useMemo(() => [...new Set(data?.monitors.map((m) => m.group) ?? [])], [data]);
  const visible =
    data?.monitors.filter(
      (m) =>
        (filter === 'all' || m.group === filter) &&
        `${m.name} ${m.model} ${endpointLabel[m.endpoint]}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) ?? [];
  const selected = data?.monitors.find((m) => m.id === selectedId);
  const performance =
    data?.monitors.find((m) => m.id === performanceId) ??
    data?.monitors.find((m) => m.series.some((p) => p.ttftMs !== null)) ??
    data?.monitors[0];
  const active = data?.monitors.filter((m) => m.enabled) ?? [],
    healthy = active.filter((m) => m.health === 'operational').length;
  const title = data?.site.title ?? 'Lumen';
  return (
    <div className="public-page">
      <header className="public-nav">
        <div className="public-nav-inner">
          <Link to={demo ? '/?demo=1' : '/'} aria-label="首页">
            <Brand title={title} />
          </Link>
          <nav>
            <a href="#services">服务状态</a>
            <a href="#performance">性能洞察</a>
            <a href="#incidents">历史事件</a>
          </nav>
          <Link to="/admin" className="nav-console">
            管理控制台
            <ArrowUpRight size={14} />
          </Link>
        </div>
      </header>
      {demo && (
        <div className="demo-banner">
          <Sparkles size={14} />
          <span>演示模式 · 所有指标与事件均为样例，不代表真实服务状态</span>
          <button
            onClick={() => {
              setData(null);
              setParams({});
            }}
          >
            退出演示
            <ArrowRight size={13} />
          </button>
        </div>
      )}
      <main className="public-main">
        <section className="status-hero">
          <div>
            <div className="eyebrow">
              <span className={`hero-dot ${data?.health ?? 'unknown'}`} />
              服务实时状态<span className="eyebrow-separator">/</span>LIVE STATUS
            </div>
            <h1>{data ? headings[data.health] : '每一次响应，清晰可见。'}</h1>
            <p>{data?.site.description ?? 'API 可用性与大模型性能，实时透明。'}</p>
          </div>
          <div className="hero-summary">
            <div className="hero-counter">
              <span>{healthy.toString().padStart(2, '0')}</span>
              <span className="hero-counter-divider">/</span>
              <span>{active.length.toString().padStart(2, '0')}</span>
            </div>
            <span>服务运行正常</span>
            <div className="updated">
              <Radio size={12} />
              {data ? `${dateTime(data.generatedAt)} 更新` : '正在连接监控服务'}
            </div>
          </div>
        </section>
        {error && (
          <div className="notice error" role="alert">
            {error} · 已有数据可能过时
            <button
              onClick={() => {
                void refresh();
              }}
            >
              重试
            </button>
          </div>
        )}
        {data && !demo && !data.worker.alive && active.length > 0 && (
          <div className="notice warning">
            探测器暂未报告心跳。页面保留最近记录，过期数据不会显示为正常。
          </div>
        )}
        <div className="overview-toolbar">
          <div>
            <span className="section-kicker">运行概览</span>
            <span className="muted">
              真实探测 ·{' '}
              {hours === 24 ? '过去 24 小时' : hours === 168 ? '过去 7 天' : '过去 30 天'}
            </span>
          </div>
          <div className="toolbar-actions">
            <div className="segmented">
              {[
                [24, '24 小时'],
                [168, '7 天'],
                [720, '30 天'],
              ].map(([v, label]) => (
                <button
                  className={hours === v ? 'active' : ''}
                  key={v}
                  onClick={() => setHours(Number(v))}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                void refresh();
              }}
              className="icon-button refresh"
              aria-label="刷新状态"
              disabled={loading}
            >
              {loading ? <Spinner /> : <RefreshCw size={16} />}
            </button>
          </div>
        </div>
        <div className="metrics-grid">
          <MetricCard
            label="请求成功率"
            value={data?.metrics.successRate == null ? '—' : data.metrics.successRate.toFixed(2)}
            unit={data?.metrics.successRate == null ? '' : '%'}
            icon={<ShieldCheck size={17} />}
            foot={
              <>
                <span className="tiny-dot" />
                {data?.metrics.samples ?? 0} 次探测样本
              </>
            }
          />
          <MetricCard
            label="首 Token 等待 · TTFT"
            value={data?.metrics.ttftP50 == null ? '—' : (data.metrics.ttftP50 / 1000).toFixed(2)}
            unit={data?.metrics.ttftP50 == null ? '' : 's'}
            icon={<Zap size={17} />}
            foot={
              <>
                P50
                <span className="metric-foot-divider" />
                P95 {formatMs(data?.metrics.ttftP95)}
              </>
            }
          />
          <MetricCard
            label="输出速度"
            value={formatTps(data?.metrics.tpsP50)}
            unit={data?.metrics.tpsP50 == null ? '' : 'tokens/s'}
            icon={<ActivityIcon />}
            foot={
              <>
                P50
                <span className="metric-foot-divider" />
                P95 {formatTps(data?.metrics.tpsP95)}
                <Help>
                  速度 =（上游报告的正文输出 token 数 − 1）÷（末个正文块到首个正文块的时间）。SSE
                  会批量返回 token，短样本波动较大，不等同于完整基准测试。
                </Help>
              </>
            }
          />
          <MetricCard
            label="请求总耗时"
            value={
              data?.metrics.latencyP50 == null ? '—' : (data.metrics.latencyP50 / 1000).toFixed(2)
            }
            unit={data?.metrics.latencyP50 == null ? '' : 's'}
            icon={<Clock3 size={17} />}
            foot={
              <>
                P50
                <span className="metric-foot-divider" />
                P95 {formatMs(data?.metrics.latencyP95)}
              </>
            }
          />
        </div>
        <section id="services" className="services-section">
          <div className="section-heading">
            <div>
              <h2>
                模型与服务<span className="count-bubble">{data?.monitors.length ?? 0}</span>
              </h2>
              <p>从可用性到响应表现，每个端点都有迹可循。</p>
            </div>
            <div className="service-controls">
              <label className="search-input">
                <Search size={15} />
                <input
                  aria-label="搜索模型或端点"
                  placeholder="搜索模型或端点"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label className="filter-select">
                <select
                  aria-label="按分组筛选"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">全部分组</option>
                  {groups.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} />
              </label>
            </div>
          </div>
          <div className="service-table">
            <div className="service-table-head">
              <span>服务 / 端点</span>
              <span>
                90 天可用性
                <Help>
                  每根柱代表一天的探测成功率，并非按持续时间计算的
                  SLA。灰色代表无数据，绿色代表全部探测成功。
                </Help>
              </span>
              <span>TTFT · P50</span>
              <span>输出 · P50</span>
              <span>当前状态</span>
              <span />
            </div>
            {loading && !data ? (
              <div className="table-loading">
                <Spinner />
                正在读取服务状态
              </div>
            ) : !data?.monitors.length ? (
              <Empty title="准备迎接第一份监控数据">
                <p>在控制台添加 API 端点，探测器将自动开始记录。</p>
                <div className="empty-actions">
                  <Link to="/admin" className="button primary">
                    配置监控
                    <ArrowRight size={15} />
                  </Link>
                  <button
                    className="button secondary"
                    onClick={() => {
                      setData(null);
                      setParams({ demo: '1' });
                    }}
                  >
                    查看演示
                  </button>
                </div>
              </Empty>
            ) : !visible.length ? (
              <Empty title="没有匹配的服务">试试其他名称或分组。</Empty>
            ) : (
              visible.map((m) => (
                <button className="service-row" key={m.id} onClick={() => setSelectedId(m.id)}>
                  <div className="service-name">
                    <ModelIcon model={m.model} name={m.name} icon={m.icon} />
                    <div>
                      <strong>{m.name}</strong>
                      <span>
                        {m.group}
                        <span className="middot">·</span>
                        {endpointLabel[m.endpoint]}
                      </span>
                    </div>
                  </div>
                  <History monitor={m} />
                  <div className="service-number">
                    {formatMs(m.metrics.ttftP50)}
                    <span>
                      {m.endpoint === 'embedding' ||
                      m.endpoint === 'image' ||
                      m.endpoint === 'custom'
                        ? '不适用'
                        : `P95 ${formatMs(m.metrics.ttftP95)}`}
                    </span>
                  </div>
                  <div className="service-number">
                    {formatTps(m.metrics.tpsP50)}
                    <span>{m.metrics.tpsP50 === null ? '无可靠样本' : 'tokens/s'}</span>
                  </div>
                  <Badge health={m.health} />
                  <ArrowUpRight size={15} className="row-arrow" />
                </button>
              ))
            )}
          </div>
          <div className="table-caption">
            <span>
              <span className="legend-dot good" />
              全部成功
              <span className="legend-dot partial" />
              部分失败
              <span className="legend-dot no-data" />
              无数据
            </span>
            <span>探测成功率，不代表持续时间 SLA · 性能仅统计成功样本</span>
          </div>
        </section>
        <section id="performance" className="performance-grid">
          <div className="performance-panel">
            <div className="panel-heading">
              <div>
                <span className="section-kicker">PERFORMANCE</span>
                <h2>响应表现，尽在掌握。</h2>
              </div>
              <label className="filter-select">
                <select
                  aria-label="选择性能图表服务"
                  value={performance?.id ?? ''}
                  onChange={(e) => setPerformanceId(e.target.value)}
                >
                  {data?.monitors.map((m) => (
                    <option value={m.id} key={m.id}>
                      {m.name}
                    </option>
                  ))}
                  {!data?.monitors.length && <option value="">暂无服务</option>}
                </select>
                <ChevronDown size={13} />
              </label>
            </div>
            <div className="chart-toolbar">
              <div className="chart-tabs">
                {[
                  ['ttftMs', 'TTFT'],
                  ['tps', '输出速度'],
                  ['latencyMs', '总耗时'],
                ].map(([v, l]) => (
                  <button
                    key={v}
                    className={chartField === v ? 'active' : ''}
                    onClick={() => setChartField(v as typeof chartField)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <span>
                <span className="tiny-dot" />
                成功请求样本
              </span>
            </div>
            <TrendChart series={performance?.series ?? []} field={chartField} height={190} />
            <div className="chart-note">
              各模型测试条件可能不同。此图展示单个服务，避免跨模型平均值掩盖异常。
            </div>
          </div>
          <div className="transparency-panel">
            <div className="transparency-icon">
              <ShieldCheck size={22} />
            </div>
            <span className="section-kicker">HOW WE MONITOR</span>
            <h2>
              透明的状态。
              <br />
              真实的响应。
            </h2>
            <p>通过小量真实请求，记录每个端点的可用性与性能。</p>
            <div className="monitor-principles">
              <div>
                <Clock3 size={16} />
                <span>
                  默认每 {Math.round((data?.site.defaultIntervalSeconds ?? 900) / 60)} 分钟探测
                </span>
              </div>
              <div>
                <Radio size={16} />
                <span>
                  连续失败超过 {Math.round((data?.site.downAfterSeconds ?? 3600) / 60)} 分钟判故障
                </span>
              </div>
              <div>
                <Zap size={16} />
                <span>TTFT 从请求发出到首个正文块</span>
              </div>
            </div>
            <span className="transparency-foot">Embedding / Image 以成功率与耗时衡量</span>
          </div>
        </section>
        <section id="incidents" className="incidents-section">
          <div className="section-heading">
            <div>
              <h2>事件与维护记录</h2>
              <p>每一次变化，都有清晰的记录。</p>
            </div>
            <span className="muted">时间为北京时间</span>
          </div>
          {!data?.incidents.length ? (
            <div className="no-incidents">
              <ShieldCheck size={20} />
              <span>暂无已发布事件或维护计划</span>
            </div>
          ) : (
            data.incidents.map((i) => (
              <article key={i.id} className={`incident-card ${i.status}`}>
                <div className="incident-date">
                  <span>
                    {new Date(i.startedAt).toLocaleDateString('zh-CN', {
                      timeZone: 'Asia/Shanghai',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </span>
                  <small>{dateTime(i.startedAt).split(' ')[1]}</small>
                </div>
                <div className="incident-content">
                  <div>
                    <span className={`incident-status ${i.status}`}>{statusName[i.status]}</span>
                    {i.automatic && <span className="muted">自动探测</span>}
                  </div>
                  <h3>{i.title}</h3>
                  <p>{i.body}</p>
                  <small>
                    {i.resolvedAt
                      ? `${dateTime(i.resolvedAt)} 恢复`
                      : i.scheduledEnd
                        ? `预计至 ${dateTime(i.scheduledEnd)}`
                        : `${dateTime(i.updatedAt)} 更新`}
                  </small>
                </div>
              </article>
            ))
          )}
        </section>
        <footer className="public-footer">
          <Brand small title={title} />
          <span>更清晰的状态，更从容的连接。</span>
          <Link to="/admin">
            <LockKeyhole size={12} />
            管理控制台
          </Link>
        </footer>
      </main>
      {selected && (
        <Modal
          wide
          title={selected.name}
          subtitle={`${selected.group} · ${endpointLabel[selected.endpoint]}${demo ? ' · 演示数据' : ''}`}
          onClose={() => setSelectedId(null)}
        >
          <div className="modal-body service-detail">
            <div className="detail-status">
              <Badge health={selected.health} />
              <span className="muted">
                {selected.latest ? `${dateTime(selected.latest.checkedAt)} 最近探测` : '尚未探测'}
              </span>
            </div>
            <div className="detail-endpoint">
              <span>接口地址</span>
              <External url={selected.url}>{selected.url}</External>
              <span>模型标识</span>
              <code>{selected.model}</code>
            </div>
            {selected.latest?.error && <div className="notice error">{selected.latest.error}</div>}
            <div className="detail-metrics">
              <div>
                <small>请求成功率</small>
                <strong>{formatPct(selected.metrics.successRate)}</strong>
              </div>
              <div>
                <small>TTFT · P50 / P95</small>
                <strong>
                  {formatMs(selected.metrics.ttftP50)}
                  <span> / {formatMs(selected.metrics.ttftP95)}</span>
                </strong>
              </div>
              <div>
                <small>输出 · P50 / P95</small>
                <strong>
                  {formatTps(selected.metrics.tpsP50)}
                  <span> / {formatTps(selected.metrics.tpsP95)} tokens/s</span>
                </strong>
              </div>
              <div>
                <small>总耗时 · P50 / P95</small>
                <strong>
                  {formatMs(selected.metrics.latencyP50)}
                  <span> / {formatMs(selected.metrics.latencyP95)}</span>
                </strong>
              </div>
            </div>
            <h3>最近响应趋势</h3>
            <TrendChart
              series={selected.series}
              field={
                ['embedding', 'image', 'custom'].includes(selected.endpoint)
                  ? 'latencyMs'
                  : 'ttftMs'
              }
              height={180}
            />
            <div className="detail-note">
              所选范围内 {selected.metrics.samples} 次探测 · 每 {selected.intervalSeconds / 60}{' '}
              分钟探测 · P50/P95 使用最近秩法，仅统计成功请求。TTFT 以首个正文块近似首 token；未报告
              usage、单块输出或思考 token 口径不明时，速度不展示。
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
function ActivityIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3 14v-4m5 4V6m5 8V3m4 11V8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
