import { useState } from 'react';
import { CalendarClock, Megaphone, Pencil, Trash2 } from 'lucide-react';
import type { AdminMonitor, Incident } from '../../shared/types';
import { api } from '../api';
import { Confirm, Empty, Field, Modal, Spinner, dateTime } from '../ui';
import { AddButton, AdminHeading } from './Admin';
import { useAdmin, useLoad } from './context';

const statusLabels: Record<Incident['status'], string> = {
  investigating: '正在调查',
  identified: '已定位',
  monitoring: '持续观察',
  resolved: '已解决',
  maintenance: '计划维护',
};
const localDate = (time: number) =>
  new Date(time - new Date(time).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
export function Incidents() {
  const { data, loading, error, reload } = useLoad<Incident[]>('/admin/incidents', 20000),
    { data: monitors } = useLoad<AdminMonitor[]>('/admin/monitors');
  const { toast } = useAdmin(),
    [editing, setEditing] = useState<Incident | 'new' | null>(null),
    [deleting, setDeleting] = useState<Incident | null>(null),
    [busy, setBusy] = useState(false);
  return (
    <>
      <AdminHeading
        kicker="INCIDENTS"
        title="变化，清晰留痕。"
        description="发布故障进展与维护计划，让服务状态始终透明。"
        action={<AddButton onClick={() => setEditing('new')}>发布事件</AddButton>}
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
      <div className="incident-overview">
        <div>
          <Megaphone size={19} />
          <strong>
            {data?.filter((i) => !['resolved', 'maintenance'].includes(i.status)).length ?? 0}
          </strong>
          <span>进行中事件</span>
        </div>
        <div>
          <CalendarClock size={19} />
          <strong>
            {data?.filter(
              (i) =>
                i.status === 'maintenance' &&
                (i.scheduledEnd === null || i.scheduledEnd > Date.now()),
            ).length ?? 0}
          </strong>
          <span>维护计划</span>
        </div>
      </div>
      <section className="admin-panel">
        <div className="admin-panel-heading">
          <div>
            <h2>发布记录</h2>
            <p>手动公告与自动故障记录，统一管理。</p>
          </div>
          <span className="muted">{data?.length ?? 0} 条记录</span>
        </div>
        {loading && !data ? (
          <div className="table-loading">
            <Spinner />
          </div>
        ) : !data?.length ? (
          <Empty title="暂无已发布事件">
            <p>需要说明服务变化或安排维护时，可在这里发布。</p>
            <button className="button secondary" onClick={() => setEditing('new')}>
              发布第一条事件
            </button>
          </Empty>
        ) : (
          data.map((i) => (
            <article key={i.id} className="admin-incident">
              <span className={`event-dot ${i.status}`} />
              <div className="admin-incident-content">
                <div>
                  <span className={`incident-status ${i.status}`}>{statusLabels[i.status]}</span>
                  {i.automatic && <span className="label-tag">自动探测</span>}
                  <span className="muted">
                    {i.monitorId
                      ? (monitors?.find((m) => m.id === i.monitorId)?.name ?? '已删除目标')
                      : '全站'}
                  </span>
                </div>
                <h3>{i.title}</h3>
                <p>{i.body}</p>
                <small>
                  {dateTime(i.startedAt)} 开始 · {dateTime(i.updatedAt)} 更新
                  {i.scheduledEnd ? ` · 预计至 ${dateTime(i.scheduledEnd)}` : ''}
                </small>
              </div>
              <div className="table-actions">
                <button
                  className="icon-button"
                  onClick={() => setEditing(i)}
                  aria-label={`编辑 ${i.title}`}
                >
                  <Pencil size={16} />
                </button>
                <button
                  className="icon-button delete-button"
                  onClick={() => setDeleting(i)}
                  aria-label={`删除 ${i.title}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))
        )}
      </section>
      <div className="admin-tip">
        <CalendarClock size={16} />
        计划维护仅发布通知，不会自动暂停探测；需要暂停时请在监控目标中操作。
      </div>
      {editing && (
        <IncidentForm
          incident={editing === 'new' ? null : editing}
          monitors={monitors ?? []}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            toast('事件已发布到公开状态页');
            await reload();
          }}
        />
      )}
      {deleting && (
        <Confirm
          title="删除这条事件？"
          description="该公告会从公开状态页与后台永久移除，不影响探测历史。此操作不可撤销。"
          busy={busy}
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            setBusy(true);
            void api(`/admin/incidents/${deleting.id}`, { method: 'DELETE' })
              .then(async () => {
                setDeleting(null);
                toast('事件记录已永久删除');
                await reload();
              })
              .catch((e) => toast(e.message, true))
              .finally(() => setBusy(false));
          }}
        />
      )}
    </>
  );
}
function IncidentForm({
  incident,
  monitors,
  onClose,
  onSaved,
}: {
  incident: Incident | null;
  monitors: AdminMonitor[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState(incident?.title ?? ''),
    [body, setBody] = useState(incident?.body ?? '');
  const [status, setStatus] = useState<Incident['status']>(incident?.status ?? 'investigating'),
    [severity, setSeverity] = useState<Incident['severity']>(incident?.severity ?? 'minor');
  const [monitorId, setMonitorId] = useState(incident?.monitorId ?? ''),
    [start, setStart] = useState(localDate(incident?.startedAt ?? Date.now())),
    [end, setEnd] = useState(incident?.scheduledEnd ? localDate(incident.scheduledEnd) : '');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title={incident ? '更新事件' : '发布事件'}
      subtitle="提交后立即在公开状态页展示。"
      onClose={busy ? () => {} : onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          void api(incident ? `/admin/incidents/${incident.id}` : '/admin/incidents', {
            method: incident ? 'PUT' : 'POST',
            body: {
              title,
              body,
              status,
              severity,
              monitorId: monitorId || null,
              startedAt: new Date(start).getTime(),
              scheduledEnd: end ? new Date(end).getTime() : null,
            },
          })
            .then(onSaved)
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        <div className="modal-body">
          <div className="form-grid">
            <Field label="事件标题" full>
              <input
                autoFocus
                required
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如 主渠道响应延迟增加"
              />
            </Field>
            <Field label="事件状态">
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as Incident['status']);
                  if (e.target.value === 'maintenance') setSeverity('maintenance');
                }}
              >
                {Object.entries(statusLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="影响等级">
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as Incident['severity'])}
              >
                <option value="minor">轻微影响</option>
                <option value="major">重大影响</option>
                <option value="maintenance">维护</option>
              </select>
            </Field>
            <Field label="关联监控" full>
              <select value={monitorId} onChange={(e) => setMonitorId(e.target.value)}>
                <option value="">全站 / 不关联目标</option>
                {monitors.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="开始时间（设备本地时区）">
              <input
                type="datetime-local"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field label="预计结束时间（可选）">
              <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
            <Field label="事件说明" full>
              <textarea
                required
                rows={5}
                maxLength={6000}
                placeholder="说明当前影响、处理进展或维护安排。"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </Field>
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="button secondary" type="button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="button primary" disabled={busy}>
            {busy && <Spinner />}
            {incident ? '更新事件' : '发布事件'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
