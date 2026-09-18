import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowUpRight, KeyRound, Pause, Pencil, Play, Search, Trash2, Zap } from 'lucide-react';
import type {
  AdminMonitor,
  Endpoint,
  IconPreference,
  MonitorInput,
  Provider,
  Probe,
} from '../../shared/types';
import { brandLabels, iconOptions, resolveModelBrand } from '../../shared/model-brand';
import { ModelIcon } from '../ModelIcon';
import { api } from '../api';
import {
  Badge,
  Confirm,
  Empty,
  Field,
  Modal,
  Spinner,
  Toggle,
  dateTime,
  endpointLabel,
  formatMs,
  formatTps,
} from '../ui';
import { AddButton, AdminHeading } from './Admin';
import { useAdmin, useLoad } from './context';

const providerEndpoints: Record<Provider, Endpoint[]> = {
  openai: ['chat', 'responses', 'embedding', 'image', 'custom'],
  anthropic: ['messages', 'custom'],
  gemini: ['generate', 'embedding', 'image', 'custom'],
};
const initial = (interval = 900): MonitorInput => ({
  name: '',
  group: '主要服务',
  provider: 'openai',
  endpoint: 'chat',
  baseUrl: '',
  model: '',
  icon: 'auto',
  enabled: true,
  intervalSeconds: interval,
  timeoutSeconds: 45,
  maxTokens: 32,
  prompt: 'Count from 1 to 10, separated by spaces. No explanation.',
  path: '',
  body: {},
  ttftThresholdMs: 3000,
  tpsThreshold: 10,
  latencyThresholdMs: 30000,
  apiKey: '',
});
export function Monitors() {
  const { data, loading, error, reload } = useLoad<AdminMonitor[]>('/admin/monitors', 15000),
    { toast } = useAdmin();
  const [params, setParams] = useSearchParams(),
    [editing, setEditing] = useState<AdminMonitor | 'new' | null>(
      params.get('create') ? 'new' : null,
    );
  const [search, setSearch] = useState(''),
    [busyId, setBusyId] = useState(''),
    [deleting, setDeleting] = useState<AdminMonitor | null>(null),
    [defaultInterval, setDefaultInterval] = useState(900);
  useEffect(() => {
    void api<{ defaultIntervalSeconds: number }>('/admin/settings')
      .then((s) => setDefaultInterval(s.defaultIntervalSeconds))
      .catch(() => {});
  }, []);
  const close = () => {
    setEditing(null);
    if (params.has('create')) setParams({});
  };
  const visible =
    data?.filter((m) =>
      `${m.name} ${m.model} ${m.group}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  async function toggle(m: AdminMonitor) {
    setBusyId(m.id);
    try {
      await api(`/admin/monitors/${m.id}`, { method: 'PUT', body: { ...m, enabled: !m.enabled } });
      toast(m.enabled ? '监控已暂停' : '监控已启用');
      await reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusyId('');
    }
  }
  async function run(m: AdminMonitor) {
    setBusyId(m.id);
    try {
      const p = await api<Probe>(`/admin/monitors/${m.id}/probe`, { method: 'POST', body: {} });
      toast(
        p.success ? `探测成功 · ${formatMs(p.latencyMs)}` : `探测失败 · ${p.error}`,
        !p.success,
      );
      await reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusyId('');
    }
  }
  return (
    <>
      <AdminHeading
        kicker="MONITORS"
        title="连接，才有洞察。"
        description="管理真实 API 端点，独立配置每个服务的探测与性能阈值。"
        action={<AddButton onClick={() => setEditing('new')}>添加监控</AddButton>}
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
      <section className="admin-panel">
        <div className="admin-panel-heading">
          <div>
            <h2>
              监控目标<span className="count-bubble">{data?.length ?? 0}</span>
            </h2>
            <p>{data?.filter((m) => m.enabled).length ?? 0} 个启用 · 密钥仅保留在服务端</p>
          </div>
          <label className="search-input">
            <Search size={15} />
            <input
              aria-label="搜索监控目标"
              placeholder="搜索名称、模型或分组"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        {loading && !data ? (
          <div className="table-loading">
            <Spinner />
          </div>
        ) : !data?.length ? (
          <Empty title="你的服务，值得更好的监控">
            <p>从一个端点开始，让可用性与性能持续可见。</p>
            <button className="button primary" onClick={() => setEditing('new')}>
              添加第一个监控
              <ArrowUpRight size={15} />
            </button>
          </Empty>
        ) : !visible.length ? (
          <Empty title="没有匹配的监控目标" />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table monitors-table">
              <thead>
                <tr>
                  <th>监控目标 / 模型</th>
                  <th>状态</th>
                  <th>最新性能</th>
                  <th>探测策略</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="monitor-identity">
                        <ModelIcon model={m.model} name={m.name} icon={m.icon} />
                        <div>
                          <strong>{m.name}</strong>
                          <small>
                            {endpointLabel[m.endpoint]} · {m.model}
                          </small>
                          <span className="endpoint-host">{m.baseUrl}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Badge health={m.health} />
                      {m.latest?.error && (
                        <small className="table-error" title={m.latest.error}>
                          {m.latest.error}
                        </small>
                      )}
                    </td>
                    <td>
                      {formatMs(m.latest?.ttftMs ?? m.latest?.latencyMs)}
                      <small>
                        {m.latest?.tps == null
                          ? m.latest
                            ? dateTime(m.latest.checkedAt)
                            : '等待探测'
                          : `${formatTps(m.latest.tps)} tokens/s`}
                      </small>
                    </td>
                    <td>
                      每 {m.intervalSeconds / 60} 分钟
                      <small>
                        {m.timeoutSeconds}s 超时 · {m.hasKey ? '已配置密钥' : '无需密钥'}
                      </small>
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          className="icon-button"
                          title="立即探测"
                          aria-label={`探测 ${m.name}`}
                          disabled={busyId === m.id || !m.enabled}
                          onClick={() => {
                            void run(m);
                          }}
                        >
                          {busyId === m.id ? <Spinner /> : <Zap size={16} />}
                        </button>
                        <button
                          className="icon-button"
                          title="编辑"
                          aria-label={`编辑 ${m.name}`}
                          onClick={() => setEditing(m)}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="icon-button"
                          title={m.enabled ? '暂停' : '启用'}
                          aria-label={`${m.enabled ? '暂停' : '启用'} ${m.name}`}
                          disabled={busyId === m.id}
                          onClick={() => {
                            void toggle(m);
                          }}
                        >
                          {m.enabled ? <Pause size={15} /> : <Play size={15} />}
                        </button>
                        <button
                          className="icon-button delete-button"
                          title="删除"
                          aria-label={`删除 ${m.name}`}
                          onClick={() => setDeleting(m)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="admin-tip">
        <KeyRound size={16} />
        API 密钥与附加请求头加密存储；编辑时留空即可保留已有密钥。
      </div>
      {editing && (
        <MonitorForm
          monitor={editing === 'new' ? null : editing}
          defaultInterval={defaultInterval}
          onClose={close}
          onSaved={async () => {
            close();
            toast('监控配置已保存');
            await reload();
          }}
        />
      )}
      {deleting && (
        <Confirm
          title={`删除 ${deleting.name}？`}
          description="该监控及其所有探测历史将永久删除，已发布的事件记录会保留。此操作不可撤销。"
          busy={busyId === deleting.id}
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            setBusyId(deleting.id);
            void api(`/admin/monitors/${deleting.id}`, { method: 'DELETE' })
              .then(async () => {
                setDeleting(null);
                toast('监控及其探测历史已永久删除');
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
function MonitorForm({
  monitor,
  defaultInterval,
  onClose,
  onSaved,
}: {
  monitor: AdminMonitor | null;
  defaultInterval: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<MonitorInput>(
    monitor ? { ...monitor, apiKey: '' } : initial(defaultInterval),
  );
  const [body, setBody] = useState(
      monitor && Object.keys(monitor.body).length ? JSON.stringify(monitor.body, null, 2) : '',
    ),
    [headers, setHeaders] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [advanced, setAdvanced] = useState(false);
  const set = <K extends keyof MonitorInput>(key: K, value: MonitorInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const nonText = ['embedding', 'image', 'custom'].includes(form.endpoint);
  const inputNumber = (key: keyof MonitorInput, min: number, max: number, scale = 1) => (
    <input
      type="number"
      required
      min={min}
      max={max}
      step="any"
      value={Number(form[key]) / scale}
      onChange={(e) => set(key, (Number(e.target.value) * scale) as never)}
    />
  );
  function changeEndpoint(endpoint: Endpoint) {
    setForm((f) => ({
      ...f,
      endpoint,
      prompt:
        endpoint === 'embedding'
          ? 'ping'
          : endpoint === 'image'
            ? 'A single black dot on a white background.'
            : initial().prompt,
      timeoutSeconds: endpoint === 'image' ? 120 : 45,
      latencyThresholdMs: endpoint === 'image' ? 60000 : 30000,
    }));
  }
  return (
    <Modal
      wide
      title={monitor ? '编辑监控目标' : '添加监控目标'}
      subtitle="小量真实请求，持续记录可用性与性能。"
      onClose={busy ? () => {} : onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          let extra: Record<string, unknown>, customHeaders: Record<string, string> | undefined;
          try {
            extra = body.trim() ? JSON.parse(body) : {};
            customHeaders = headers.trim() ? JSON.parse(headers) : undefined;
            if (
              !extra ||
              Array.isArray(extra) ||
              typeof extra !== 'object' ||
              (customHeaders && (Array.isArray(customHeaders) || typeof customHeaders !== 'object'))
            )
              throw new Error();
          } catch {
            setError('附加参数与请求头必须是有效的 JSON 对象');
            return;
          }
          setBusy(true);
          void api(monitor ? `/admin/monitors/${monitor.id}` : '/admin/monitors', {
            method: monitor ? 'PUT' : 'POST',
            body: { ...form, body: extra, ...(customHeaders ? { headers: customHeaders } : {}) },
          })
            .then(onSaved)
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        <div className="modal-body">
          <div className="form-section">
            <h3>基本信息</h3>
            <div className="form-grid">
              <Field label="服务名称">
                <input
                  autoFocus
                  required
                  placeholder="例如 GPT 主渠道"
                  maxLength={80}
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                />
              </Field>
              <Field label="分组">
                <input
                  required
                  placeholder="例如 OpenAI"
                  maxLength={80}
                  value={form.group}
                  onChange={(e) => set('group', e.target.value)}
                />
              </Field>
              <Field label="接口协议">
                <select
                  value={form.provider}
                  onChange={(e) => {
                    const provider = e.target.value as Provider;
                    setForm((f) => ({ ...f, provider, endpoint: providerEndpoints[provider][0] }));
                  }}
                >
                  <option value="openai">OpenAI-compatible</option>
                  <option value="anthropic">Anthropic 原生</option>
                  <option value="gemini">Gemini 原生</option>
                </select>
              </Field>
              <Field label="端点类型">
                <select
                  value={form.endpoint}
                  onChange={(e) => changeEndpoint(e.target.value as Endpoint)}
                >
                  {providerEndpoints[form.provider].map((ep) => (
                    <option key={ep} value={ep}>
                      {endpointLabel[ep]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="接口根地址"
                full
                hint="包含协议版本路径，例如 https://api.example.com/v1；Gemini 通常使用 /v1beta。"
              >
                <input
                  required
                  type="url"
                  placeholder="https://api.example.com/v1"
                  value={form.baseUrl}
                  onChange={(e) => set('baseUrl', e.target.value)}
                />
              </Field>
              <Field label="模型标识">
                <input
                  required
                  placeholder="服务端实际接受的模型 ID"
                  value={form.model}
                  onChange={(e) => set('model', e.target.value)}
                />
              </Field>
              <Field
                label="API 密钥"
                hint={monitor?.hasKey ? '已有密钥，留空保留。不会回显。' : '无需鉴权的服务可留空。'}
              >
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={monitor?.hasKey ? '••••••••（已加密保存）' : '仅保留在服务器'}
                  value={form.apiKey ?? ''}
                  onChange={(e) => set('apiKey', e.target.value)}
                />
              </Field>
              <Field
                label="模型图标"
                hint="与接口协议独立。自动模式跟随模型变化，手动指定后保持不变。"
              >
                <select
                  value={form.icon ?? 'auto'}
                  onChange={(e) => set('icon', e.target.value as IconPreference)}
                >
                  {iconOptions.map((icon) => (
                    <option key={icon} value={icon}>
                      {icon === 'auto' ? '自动识别（默认）' : brandLabels[icon]}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="model-icon-preview" aria-live="polite">
                <ModelIcon model={form.model} name={form.name} icon={form.icon} />
                <div>
                  <strong>
                    {brandLabels[resolveModelBrand(form.model, form.name, form.icon)]}
                  </strong>
                  <small>
                    {(form.icon ?? 'auto') === 'auto'
                      ? '根据模型标识 / 名称自动匹配'
                      : '手动指定 · 不随模型名称变化'}
                  </small>
                </div>
                {form.icon && form.icon !== 'auto' && (
                  <button className="text-button" type="button" onClick={() => set('icon', 'auto')}>
                    恢复自动
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="form-section">
            <h3>探测策略</h3>
            <div className="form-grid">
              <Field label="探测间隔（分钟）" hint="最小 1 分钟；默认 15 分钟。">
                {inputNumber('intervalSeconds', 1, 1440, 60)}
              </Field>
              <Field label="请求超时（秒）">{inputNumber('timeoutSeconds', 5, 300)}</Field>
              {!nonText && (
                <Field label="最大输出 token" hint="默认 32，短样本的 tokens/s 仅供趋势参考。">
                  {inputNumber('maxTokens', 16, 4096)}
                </Field>
              )}
              <Field
                label={
                  form.endpoint === 'embedding'
                    ? '测试输入'
                    : form.endpoint === 'image'
                      ? '图片测试提示词'
                      : '测试提示词'
                }
                full
              >
                <textarea
                  required
                  rows={2}
                  value={form.prompt}
                  onChange={(e) => set('prompt', e.target.value)}
                />
              </Field>
            </div>
          </div>
          <div className="form-section">
            <h3>性能下降阈值</h3>
            <p className="form-section-note">请求成功但超过以下阈值，将标记为性能下降。</p>
            <div className="form-grid thresholds">
              {!nonText && (
                <>
                  <Field label="TTFT 高于（秒）">
                    {inputNumber('ttftThresholdMs', 0.1, 300, 1000)}
                  </Field>
                  <Field label="输出速度低于（tokens/s）">
                    {inputNumber('tpsThreshold', 0, 10000)}
                  </Field>
                </>
              )}
              <Field label="总耗时高于（秒）">
                {inputNumber('latencyThresholdMs', 0.1, 300, 1000)}
              </Field>
            </div>
          </div>
          {monitor?.hasKey && (
            <Toggle
              label="清除已有 API 密钥"
              hint="用于改为无需鉴权的服务；保存后移除密钥。"
              checked={form.clearApiKey ?? false}
              onChange={(v) => set('clearApiKey', v)}
            />
          )}
          {monitor && (
            <p className="form-section-note">
              更改端点、模型、提示词或鉴权配置时，将开始新的指标版本，旧探测数据仍保留在数据库。
            </p>
          )}
          <button
            type="button"
            className="text-link advanced-toggle"
            onClick={() => setAdvanced(!advanced)}
          >
            {advanced ? '收起' : '展开'}高级配置
            <ArrowUpRight size={13} />
          </button>
          {advanced && (
            <div className="form-section advanced-section">
              <div className="form-grid">
                <Field
                  label="自定义端点路径"
                  full
                  hint="相对于根地址拼接，如 /chat/completions。为空使用协议默认路径。"
                >
                  <input
                    value={form.path}
                    onChange={(e) => set('path', e.target.value)}
                    required={form.endpoint === 'custom'}
                    placeholder="/custom/endpoint"
                  />
                </Field>
                <Field
                  label="附加请求参数（JSON）"
                  full
                  hint="递归合并到默认请求体，适配不同中转服务。不要在这里放密钥；流式文本的 stream 固定开启。"
                >
                  <textarea
                    className="code-input"
                    rows={4}
                    placeholder={'{ "temperature": 0 }'}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                </Field>
                <Field
                  label="附加请求头（JSON）"
                  full
                  hint={
                    monitor?.headerNames.length
                      ? `已存请求头：${monitor.headerNames.join(', ')}。留空保留，填写 {} 可清空。`
                      : '请求头值将加密存储，不会回显。'
                  }
                >
                  <textarea
                    className="code-input"
                    rows={3}
                    placeholder={'{ "x-custom-header": "value" }'}
                    value={headers}
                    onChange={(e) => setHeaders(e.target.value)}
                  />
                </Field>
              </div>
            </div>
          )}
          {form.endpoint === 'custom' && !advanced && (
            <div className="notice warning">自定义端点需要在高级配置中填写路径。</div>
          )}
          <Toggle
            checked={form.enabled}
            onChange={(v) => set('enabled', v)}
            label="启用监控"
            hint="按设定间隔发起真实请求，可能产生上游费用。"
          />
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
            {busy && <Spinner />}
            {monitor ? '保存更改' : '创建监控'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
