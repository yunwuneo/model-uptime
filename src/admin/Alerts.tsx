import { useState } from 'react';
import { Bell, Mail, Pencil, Radio, Send, Trash2, Webhook } from 'lucide-react';
import type { AdminChannel, AlertLog, ChannelKind } from '../../shared/types';
import { api } from '../api';
import { Confirm, Empty, Field, Modal, Spinner, Toggle, dateTime } from '../ui';
import { AddButton, AdminHeading } from './Admin';
import { useAdmin, useLoad } from './context';

const kindLabels: Record<ChannelKind, string> = {
  email: '邮件',
  webhook: 'Webhook',
  telegram: 'Telegram',
};
const kindIcons = { email: Mail, webhook: Webhook, telegram: Send };
const eventLabels: Record<string, string> = {
  test: '测试通知',
  down: '服务故障',
  degraded: '性能下降',
  recovery: '服务恢复',
};
export function Alerts() {
  const { data, error, loading, reload } = useLoad<AdminChannel[]>('/admin/channels'),
    logs = useLoad<AlertLog[]>('/admin/alerts', 20000);
  const { toast } = useAdmin(),
    [editing, setEditing] = useState<AdminChannel | 'new' | null>(null),
    [deleting, setDeleting] = useState<AdminChannel | null>(null),
    [busyId, setBusyId] = useState('');
  return (
    <>
      <AdminHeading
        kicker="NOTIFICATIONS"
        title="重要变化，即刻知晓。"
        description="通过邮件、Webhook 或 Telegram 接收故障、性能下降与恢复通知。"
        action={<AddButton onClick={() => setEditing('new')}>添加告警渠道</AddButton>}
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
      {loading && !data ? (
        <div className="table-loading">
          <Spinner />
        </div>
      ) : !data?.length ? (
        <section className="admin-panel">
          <Empty title="让关键变化找到你">
            <p>选择一个告警渠道，按需订阅服务变化。</p>
            <button className="button primary" onClick={() => setEditing('new')}>
              配置告警渠道
            </button>
          </Empty>
        </section>
      ) : (
        <div className="channel-grid">
          {data.map((c) => {
            const Icon = kindIcons[c.kind];
            return (
              <section className="channel-card" key={c.id}>
                <div className="channel-card-top">
                  <span className={`channel-icon ${c.kind}`}>
                    <Icon size={22} />
                  </span>
                  <span className={`channel-state ${c.enabled ? 'enabled' : ''}`}>
                    <span className="status-dot" />
                    {c.enabled ? '已启用' : '已暂停'}
                  </span>
                </div>
                <h3>{c.name}</h3>
                <p>
                  {kindLabels[c.kind]} ·{' '}
                  {c.kind === 'email'
                    ? String(c.config.to)
                    : c.kind === 'telegram'
                      ? `Chat ID: ${c.config.chatId}`
                      : String(c.config.url)}
                </p>
                <div className="channel-tags">
                  {c.onDown && <span>服务故障</span>}
                  {c.onDegraded && <span>性能下降</span>}
                  {c.onRecovery && <span>恢复通知</span>}
                </div>
                <div className="channel-actions">
                  <button
                    className="button secondary"
                    disabled={busyId === c.id}
                    onClick={() => {
                      setBusyId(c.id);
                      void api(`/admin/channels/${c.id}/test`, { method: 'POST', body: {} })
                        .then(() => toast('测试通知已发送'))
                        .catch((e) => toast(e.message, true))
                        .finally(() => {
                          setBusyId('');
                          void logs.reload();
                        });
                    }}
                  >
                    {busyId === c.id ? <Spinner /> : <Radio size={14} />}测试通知
                  </button>
                  <div>
                    <button
                      className="icon-button"
                      aria-label={`编辑 ${c.name}`}
                      onClick={() => setEditing(c)}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="icon-button delete-button"
                      aria-label={`删除 ${c.name}`}
                      onClick={() => setDeleting(c)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
      <div className="admin-tip">
        <Bell size={16} />
        仅在状态变化时发送通知；连续失败超过故障阈值才发送故障告警，不按每次失败重复推送。
      </div>
      <section className="admin-panel alert-log-panel">
        <div className="admin-panel-heading">
          <div>
            <h2>发送日志</h2>
            <p>最近 100 条记录 · 包含测试通知</p>
          </div>
        </div>
        {logs.error ? (
          <div className="notice error">{logs.error}</div>
        ) : !logs.data?.length ? (
          <div className="quiet-empty">暂无发送记录</div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>渠道</th>
                  <th>通知类型</th>
                  <th>结果</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {logs.data.map((l) => (
                  <tr key={l.id}>
                    <td className="muted">{dateTime(l.createdAt)}</td>
                    <td>{l.channelName}</td>
                    <td>{eventLabels[l.event] ?? l.event}</td>
                    <td>
                      <span className={`delivery-result ${l.success ? 'success' : 'failed'}`}>
                        {l.success ? '发送成功' : '发送失败'}
                      </span>
                    </td>
                    <td className="log-error">{l.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editing && (
        <ChannelForm
          channel={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            toast('告警渠道已保存');
            await reload();
          }}
        />
      )}
      {deleting && (
        <Confirm
          title={`删除 ${deleting.name}？`}
          description="该渠道配置将永久删除，历史发送日志会保留，不影响其他渠道。"
          busy={busyId === deleting.id}
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            setBusyId(deleting.id);
            void api(`/admin/channels/${deleting.id}`, { method: 'DELETE' })
              .then(async () => {
                setDeleting(null);
                toast('告警渠道配置已永久删除');
                await reload();
              })
              .catch((e) => toast(e.message, true))
              .finally(() => setBusyId(''));
          }}
        />
      )}
    </>
  );
}
function ChannelForm({
  channel,
  onClose,
  onSaved,
}: {
  channel: AdminChannel | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(channel?.name ?? ''),
    [kind, setKind] = useState<ChannelKind>(channel?.kind ?? 'webhook');
  const [config, setConfig] = useState<Record<string, unknown>>(
      channel?.config ?? { url: '', secret: '' },
    ),
    [enabled, setEnabled] = useState(channel?.enabled ?? true);
  const [onDown, setOnDown] = useState(channel?.onDown ?? true),
    [onDegraded, setOnDegraded] = useState(channel?.onDegraded ?? true),
    [onRecovery, setOnRecovery] = useState(channel?.onRecovery ?? true);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    existingSecret = channel?.hasSecret && channel.kind === kind;
  const set = (key: string, value: unknown) => setConfig((c) => ({ ...c, [key]: value }));
  const text = (key: string, placeholder: string, required = true, secret = false) => (
    <input
      required={required && !(secret && existingSecret)}
      type={secret ? 'password' : key === 'url' ? 'url' : 'text'}
      autoComplete="off"
      placeholder={secret && existingSecret ? '已保存，留空保留' : placeholder}
      value={String(config[key] ?? '')}
      onChange={(e) => set(key, e.target.value)}
    />
  );
  return (
    <Modal
      title={channel ? '编辑告警渠道' : '添加告警渠道'}
      subtitle="保存后可以发送测试通知，验证配置。"
      onClose={busy ? () => {} : onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          setBusy(true);
          void api(channel ? `/admin/channels/${channel.id}` : '/admin/channels', {
            method: channel ? 'PUT' : 'POST',
            body: { name, kind, config, enabled, onDown, onDegraded, onRecovery },
          })
            .then(onSaved)
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        <div className="modal-body">
          <div className="form-grid">
            <Field label="渠道名称">
              {
                <input
                  autoFocus
                  required
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如 运维通知"
                />
              }
            </Field>
            <Field label="渠道类型">
              <select
                value={kind}
                onChange={(e) => {
                  const v = e.target.value as ChannelKind;
                  setKind(v);
                  setConfig(
                    v === 'email'
                      ? {
                          host: '',
                          port: 587,
                          secure: false,
                          user: '',
                          password: '',
                          from: '',
                          to: '',
                        }
                      : v === 'telegram'
                        ? { token: '', chatId: '' }
                        : { url: '', secret: '' },
                  );
                }}
              >
                <option value="webhook">Webhook</option>
                <option value="email">邮件 · SMTP</option>
                <option value="telegram">Telegram</option>
              </select>
            </Field>
            {kind === 'webhook' ? (
              <>
                <Field
                  label="Webhook URL"
                  full
                  hint="发送 JSON POST：event、monitor、message、timestamp。"
                >
                  {text('url', 'https://example.com/webhook')}
                </Field>
                <Field
                  label="Bearer 密钥（可选）"
                  full
                  hint="作为 Authorization 请求头发送，加密保存。"
                >
                  {text('secret', '可选鉴权密钥', false, true)}
                </Field>
              </>
            ) : kind === 'telegram' ? (
              <>
                <Field label="Bot Token" full>
                  {text('token', 'Telegram 机器人 token', true, true)}
                </Field>
                <Field
                  label="Chat ID"
                  full
                  hint="可以是用户、群组或频道 ID，机器人必须有发送权限。"
                >
                  {text('chatId', '例如 -100123456789')}
                </Field>
              </>
            ) : (
              <>
                <Field label="SMTP 主机">{text('host', 'smtp.example.com')}</Field>
                <Field label="SMTP 端口">
                  <input
                    required
                    type="number"
                    min={1}
                    max={65535}
                    value={Number(config.port ?? 587)}
                    onChange={(e) => set('port', Number(e.target.value))}
                  />
                </Field>
                <Field label="SMTP 用户（可选）">{text('user', '账号', false)}</Field>
                <Field label="SMTP 密码">
                  {text('password', '应用专用密码', !!config.user, true)}
                </Field>
                <Field label="发件人">{text('from', 'status@example.com')}</Field>
                <Field label="收件人" hint="多个地址可用英文逗号分隔。">
                  {text('to', 'ops@example.com')}
                </Field>
                <Field label="TLS 方式" full>
                  <select
                    value={config.secure ? 'implicit' : 'starttls'}
                    onChange={(e) => set('secure', e.target.value === 'implicit')}
                  >
                    <option value="starttls">STARTTLS（通常 587，强制加密）</option>
                    <option value="implicit">隐式 TLS（通常 465）</option>
                  </select>
                </Field>
              </>
            )}
          </div>
          <div className="form-section channel-subscriptions">
            <h3>订阅事件</h3>
            <Toggle
              label="服务故障"
              hint="持续失败时间超过故障阈值。"
              checked={onDown}
              onChange={setOnDown}
            />
            <Toggle
              label="性能下降"
              hint="请求成功，但 TTFT、速度或耗时超出阈值。"
              checked={onDegraded}
              onChange={setOnDegraded}
            />
            <Toggle
              label="服务恢复"
              hint="异常服务恢复到正常运行。"
              checked={onRecovery}
              onChange={setOnRecovery}
            />
          </div>
          <Toggle label="启用渠道" checked={enabled} onChange={setEnabled} />
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="button primary" disabled={busy}>
            {busy && <Spinner />}保存渠道
          </button>
        </div>
      </form>
    </Modal>
  );
}
