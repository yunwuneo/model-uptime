import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  Plus,
  Radio,
  ShieldCheck,
  SquareActivity,
  Zap,
} from 'lucide-react';
import type { StatusPage } from '../../shared/types';
import { useLoad } from './context';
import { AdminHeading } from './Admin';
import {
  Badge,
  Empty,
  MetricCard,
  Spinner,
  TrendChart,
  dateTime,
  endpointLabel,
  formatMs,
  formatPct,
  formatTps,
} from '../ui';

export function Dashboard() {
  const { data, error, loading, reload } = useLoad<StatusPage>('/status?hours=24', 20000),
    [monitorId, setMonitorId] = useState('');
  const selected =
    data?.monitors.find((m) => m.id === monitorId) ??
    data?.monitors.find((m) => m.series.some((p) => p.ttftMs !== null)) ??
    data?.monitors[0];
  const active = data?.monitors.filter((m) => m.enabled) ?? [],
    issues = active.filter((m) => ['down', 'degraded', 'pending'].includes(m.health));
  return (
    <>
      <AdminHeading
        kicker="OVERVIEW"
        title="每一次响应，心中有数。"
        description="你的 API 与模型服务，尽在掌握。"
        action={
          <Link to="/admin/monitors?create=1" className="button primary">
            <Plus size={16} />
            添加监控
          </Link>
        }
      />
      {error && (
        <div className="notice error">
          {error}
          <button
            onClick={() => {
              void reload();
            }}
          >
            重试
          </button>
        </div>
      )}
      <div className={`admin-status-banner ${issues.length ? 'has-issues' : ''}`}>
        <span className="status-banner-icon">
          {issues.length ? <Radio size={22} /> : <ShieldCheck size={22} />}
        </span>
        <div>
          <strong>
            {!active.length
              ? '准备就绪，等待第一份数据'
              : issues.length
                ? `${issues.length} 个服务需要关注`
                : active.some((m) => m.health === 'unknown')
                  ? '正在等待有效探测数据'
                  : '所有服务运行正常'}
          </strong>
          <p>
            {!active.length
              ? '添加监控目标后，系统将自动发送小量探测请求。'
              : `${active.length} 个监控目标 · 过去 24 小时 ${data?.metrics.samples ?? 0} 次探测`}
          </p>
        </div>
        <span className={`worker-status ${data?.worker.alive ? 'alive' : ''}`}>
          <span className="status-dot" />
          {data?.worker.alive ? '探测器在线' : '探测器离线'}
        </span>
      </div>
      <div className="metrics-grid admin-metrics">
        <MetricCard
          label="监控目标"
          value={String(data?.monitors.length ?? 0).padStart(2, '0')}
          icon={<SquareActivity size={17} />}
          foot={`${active.length} 个启用 · ${(data?.monitors.length ?? 0) - active.length} 个暂停`}
        />
        <MetricCard
          label="24h 请求成功率"
          value={data?.metrics.successRate == null ? '—' : data.metrics.successRate.toFixed(2)}
          unit={data?.metrics.successRate == null ? '' : '%'}
          icon={<ShieldCheck size={17} />}
          foot="基于真实请求探测样本"
        />
        <MetricCard
          label="TTFT · P50"
          value={data?.metrics.ttftP50 == null ? '—' : (data.metrics.ttftP50 / 1000).toFixed(2)}
          unit={data?.metrics.ttftP50 == null ? '' : 's'}
          icon={<Zap size={17} />}
          foot={`P95 ${formatMs(data?.metrics.ttftP95)}`}
        />
        <MetricCard
          label="输出速度 · P50"
          value={formatTps(data?.metrics.tpsP50)}
          unit={data?.metrics.tpsP50 == null ? '' : 'tokens/s'}
          icon={<Clock3 size={17} />}
          foot={`P95 ${formatTps(data?.metrics.tpsP95)} tokens/s · 可靠 usage`}
        />
      </div>
      <div className="admin-dashboard-grid">
        <section className="admin-panel dashboard-chart">
          <div className="admin-panel-heading">
            <div>
              <h2>响应性能</h2>
              <p>过去 24 小时 · 单个服务趋势</p>
            </div>
            <select
              aria-label="选择图表监控目标"
              value={selected?.id ?? ''}
              onChange={(e) => setMonitorId(e.target.value)}
            >
              {data?.monitors.map((m) => (
                <option value={m.id} key={m.id}>
                  {m.name}
                </option>
              ))}
              {!data?.monitors.length && <option value="">暂无服务</option>}
            </select>
          </div>
          <div className="dashboard-chart-metric">
            <strong>{formatMs(selected?.metrics.ttftP50 ?? selected?.metrics.latencyP50)}</strong>
            <span>{selected?.metrics.ttftP50 != null ? 'TTFT · P50' : '总耗时 · P50'}</span>
            <span className="chart-legend">
              <span className="tiny-dot" />
              成功请求
            </span>
          </div>
          <TrendChart
            series={selected?.series ?? []}
            field={selected?.metrics.ttftP50 != null ? 'ttftMs' : 'latencyMs'}
            height={190}
          />
        </section>
        <section className="admin-panel dashboard-events">
          <div className="admin-panel-heading">
            <div>
              <h2>最近事件</h2>
              <p>发布记录与自动故障事件</p>
            </div>
            <Link to="/admin/incidents" className="icon-button" aria-label="管理事件">
              <ArrowUpRight size={17} />
            </Link>
          </div>
          {!data?.incidents.length ? (
            <div className="events-empty">
              <span>
                <Check size={20} />
              </span>
              <strong>暂无事件</strong>
              <p>服务变化将在这里留下记录。</p>
            </div>
          ) : (
            data.incidents.slice(0, 3).map((i) => (
              <div className="mini-event" key={i.id}>
                <span className={`event-dot ${i.status}`} />
                <div>
                  <strong>{i.title}</strong>
                  <span>
                    {i.status === 'resolved'
                      ? '已解决'
                      : i.status === 'maintenance'
                        ? '维护计划'
                        : '进行中'}{' '}
                    · {dateTime(i.updatedAt)}
                  </span>
                </div>
              </div>
            ))
          )}
        </section>
      </div>
      <section className="admin-panel">
        <div className="admin-panel-heading">
          <div>
            <h2>服务一览</h2>
            <p>最新探测状态与过去 24 小时表现</p>
          </div>
          <Link className="text-link" to="/admin/monitors">
            管理全部
            <ArrowRight size={14} />
          </Link>
        </div>
        {loading && !data ? (
          <div className="table-loading">
            <Spinner />
          </div>
        ) : !data?.monitors.length ? (
          <Empty title="连接你的第一个服务">
            <p>支持 Chat、Responses、Anthropic、Gemini、Embedding 与 Image。</p>
            <Link to="/admin/monitors?create=1" className="button secondary">
              添加监控
              <Plus size={15} />
            </Link>
          </Empty>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>监控目标</th>
                  <th>当前状态</th>
                  <th>成功率</th>
                  <th>TTFT · P50</th>
                  <th>最近探测</th>
                </tr>
              </thead>
              <tbody>
                {data.monitors.slice(0, 8).map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.name}</strong>
                      <small>
                        {endpointLabel[m.endpoint]} · {m.model}
                      </small>
                    </td>
                    <td>
                      <Badge health={m.health} />
                    </td>
                    <td>{formatPct(m.metrics.successRate)}</td>
                    <td>{formatMs(m.metrics.ttftP50)}</td>
                    <td className="muted">
                      {m.latest ? dateTime(m.latest.checkedAt) : '等待探测'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
