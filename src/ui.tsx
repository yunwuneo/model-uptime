import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Activity, ArrowUpRight, Check, CircleHelp, X, LoaderCircle } from 'lucide-react';
import type { Health, Probe } from '../shared/types';

export const healthLabel: Record<Health, string> = {
  operational: '运行正常',
  degraded: '性能下降',
  pending: '异常待确认',
  down: '服务故障',
  paused: '已暂停',
  unknown: '暂无有效数据',
};
export const endpointLabel: Record<string, string> = {
  chat: 'Chat Completions',
  responses: 'Responses',
  messages: 'Messages',
  generate: 'Generate Content',
  embedding: 'Embedding',
  image: 'Image',
  custom: '自定义',
};
export const formatMs = (value: number | null | undefined) =>
  value == null
    ? '—'
    : value >= 1000
      ? (value / 1000).toFixed(2) + ' s'
      : Math.round(value) + ' ms';
export const formatTps = (value: number | null | undefined) =>
  value == null ? '—' : value.toFixed(1);
export const formatPct = (value: number | null | undefined) =>
  value == null ? '—' : value.toFixed(2) + '%';
export const dateTime = (value: number) =>
  new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
export function Brand({ small = false, title = 'Lumen' }: { small?: boolean; title?: string }) {
  return (
    <span className={`brand ${small ? 'small' : ''}`}>
      <span className="brand-icon">
        <Activity size={small ? 17 : 21} strokeWidth={2} />
      </span>
      {title}
      <span className="brand-label">STATUS</span>
    </span>
  );
}
export function Badge({ health }: { health: Health }) {
  return (
    <span className={`badge ${health}`}>
      <span className="status-dot" />
      {healthLabel[health]}
    </span>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Activity size={25} />
      </span>
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}
export function Spinner() {
  return <LoaderCircle className="spin" size={18} aria-label="加载中" />;
}
export function Help({ children }: { children: string }) {
  return (
    <span className="help" tabIndex={0} aria-label={children}>
      <CircleHelp size={13} />
      <span role="tooltip">{children}</span>
    </span>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => {
      el?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" onClick={onClose} aria-label="关闭">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Confirm({
  title,
  description,
  onClose,
  onConfirm,
  busy = false,
}: {
  title: string;
  description: string;
  onClose: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="modal-body">
        <p>{description}</p>
      </div>
      <div className="modal-footer">
        <button className="button secondary" onClick={onClose}>
          取消
        </button>
        <button className="button danger" onClick={onConfirm} disabled={busy}>
          {busy ? <Spinner /> : null}确认删除
        </button>
      </div>
    </Modal>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="toggle-row">
      <span>
        <span className="toggle-label">{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <input
        className="sr-only"
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={`toggle ${checked ? 'on' : ''}`} />
    </label>
  );
}
export function Field({
  label,
  hint,
  children,
  full = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  full?: boolean;
}) {
  const id = useId();
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<any>, {
        id,
        'aria-describedby': hint ? id + '-hint' : undefined,
      })
    : children;
  return (
    <div className={`field ${full ? 'full' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {control}
      {hint && <small id={id + '-hint'}>{hint}</small>}
    </div>
  );
}
export function MetricCard({
  label,
  value,
  unit,
  foot,
  icon,
  subtle = false,
}: {
  label: string;
  value: string;
  unit?: string;
  foot: ReactNode;
  icon?: ReactNode;
  subtle?: boolean;
}) {
  return (
    <div className={`metric-card ${subtle ? 'subtle' : ''}`}>
      <div className="metric-label">
        {label}
        {icon ?? null}
      </div>
      <div className="metric-value">
        {value}
        <span>{unit}</span>
      </div>
      <div className="metric-foot">{foot}</div>
    </div>
  );
}
export function TrendChart({
  series,
  field = 'ttftMs',
  color = '#479372',
  height = 160,
}: {
  series: Probe[];
  field?: 'ttftMs' | 'latencyMs' | 'tps';
  color?: string;
  height?: number;
}) {
  const points = series.filter((p) => p.success && p[field] !== null);
  if (!points.length)
    return (
      <div className="chart-empty" style={{ height }}>
        暂无可用的性能样本
      </div>
    );
  const width = 700,
    top = 18,
    bottom = 30,
    left = 50,
    right = 15;
  const max = Math.max(...points.map((p) => p[field]!), field === 'tps' ? 10 : 100) * 1.2;
  const begin = series[0]?.checkedAt ?? points[0].checkedAt,
    end = series.at(-1)?.checkedAt ?? points.at(-1)!.checkedAt;
  const x = (time: number) =>
    left + ((time - begin) / Math.max(end - begin, 1)) * (width - left - right);
  const y = (value: number) => top + (1 - value / max) * (height - top - bottom);
  // Separate segments at failed samples; don't interpolate across outages.
  const segments: string[] = [];
  let current: string[] = [];
  for (const p of series) {
    if (!p.success || p[field] === null) {
      if (current.length) segments.push(current.join(' '));
      current = [];
    } else current.push(`${x(p.checkedAt)},${y(p[field]!)}`);
  }
  if (current.length) segments.push(current.join(' '));
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="trend-chart"
      role="img"
      aria-label={field === 'tps' ? '输出 token 速度趋势' : '响应耗时趋势'}
    >
      {[0, 0.5, 1].map((r) => (
        <g key={r}>
          <line
            x1={left}
            x2={width - right}
            y1={y(max * r)}
            y2={y(max * r)}
            stroke="#eceef0"
            strokeDasharray="3 4"
          />
          <text x={left - 10} y={y(max * r) + 4} textAnchor="end" className="chart-label">
            {field === 'tps' ? Math.round(max * r) : ((max * r) / 1000).toFixed(1) + 's'}
          </text>
        </g>
      ))}
      {segments.map((s, i) => (
        <polyline
          key={i}
          points={s}
          fill="none"
          stroke={color}
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {points.length === 1 && (
        <circle cx={x(points[0].checkedAt)} cy={y(points[0][field]!)} r={4} fill={color} />
      )}
      {[0, 0.25, 0.5, 0.75, 1].map((r) => (
        <text
          key={r}
          x={left + r * (width - left - right)}
          y={height - 4}
          textAnchor={r === 0 ? 'start' : r === 1 ? 'end' : 'middle'}
          className="chart-label"
        >
          {end - begin > 2 * 86400000
            ? new Date(begin + (end - begin) * r).toLocaleDateString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                month: '2-digit',
                day: '2-digit',
              })
            : new Date(begin + (end - begin) * r).toLocaleTimeString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                hour: '2-digit',
                minute: '2-digit',
              })}
        </text>
      ))}
    </svg>
  );
}
export function Toast({
  message,
  error = false,
  onClose,
}: {
  message: string;
  error?: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, error ? 8000 : 3500);
    return () => clearTimeout(timer);
  }, [message, error, onClose]);
  return (
    <div className={`toast ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>
      {error ? <X size={17} /> : <Check size={17} />}
      <span>{message}</span>
      <button onClick={onClose} className="icon-button" aria-label="关闭通知">
        <X size={16} />
      </button>
    </div>
  );
}
export function External({ url, children }: { url: string; children: ReactNode }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="external-link">
      {children}
      <ArrowUpRight size={13} />
    </a>
  );
}
