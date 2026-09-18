import { useEffect, useState } from 'react';
import { Check, Globe2, LockKeyhole, Save, ShieldCheck } from 'lucide-react';
import type { SiteSettings } from '../../shared/types';
import { api } from '../api';
import { Field, Spinner, Toggle } from '../ui';
import { AdminHeading } from './Admin';
import { useAdmin, useLoad } from './context';

export function Settings({ refreshSession }: { refreshSession: () => Promise<void> }) {
  const { data, error, loading } = useLoad<SiteSettings>('/admin/settings'),
    { toast } = useAdmin();
  const [form, setForm] = useState<SiteSettings | null>(null),
    [saving, setSaving] = useState(false),
    [formError, setFormError] = useState('');
  const [current, setCurrent] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [changing, setChanging] = useState(false),
    [passwordError, setPasswordError] = useState('');
  useEffect(() => {
    if (data) setForm(data);
  }, [data]);
  const set = <K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));
  return (
    <>
      <AdminHeading
        kicker="SETTINGS"
        title="你的站点，你来定义。"
        description="配置公开页面、监控规则与管理员安全。"
      />
      {error && <div className="notice error">{error}</div>}
      {loading || !form ? (
        <div className="table-loading">
          <Spinner />
        </div>
      ) : (
        <div className="settings-layout">
          <form
            className="settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              setSaving(true);
              setFormError('');
              void api('/admin/settings', { method: 'PUT', body: form })
                .then(() => toast('站点设置已保存'))
                .catch((e) => setFormError(e.message))
                .finally(() => setSaving(false));
            }}
          >
            <section className="admin-panel settings-panel">
              <div className="settings-section-heading">
                <Globe2 size={20} />
                <div>
                  <h2>公开页面</h2>
                  <p>简单而清晰地呈现你的服务。</p>
                </div>
              </div>
              <div className="form-grid">
                <Field label="站点名称" full>
                  <input
                    required
                    maxLength={40}
                    value={form.title}
                    onChange={(e) => set('title', e.target.value)}
                  />
                </Field>
                <Field label="页面说明" full>
                  <textarea
                    rows={2}
                    maxLength={160}
                    value={form.description}
                    onChange={(e) => set('description', e.target.value)}
                  />
                </Field>
              </div>
            </section>
            <section className="admin-panel settings-panel">
              <div className="settings-section-heading">
                <ShieldCheck size={20} />
                <div>
                  <h2>监控规则</h2>
                  <p>调整默认策略与历史数据保留。</p>
                </div>
              </div>
              <div className="form-grid">
                <Field
                  label="默认探测间隔（分钟）"
                  hint="仅作为新建目标的默认值，已有目标单独配置。"
                >
                  <input
                    type="number"
                    required
                    min={1}
                    max={1440}
                    step={1}
                    value={form.defaultIntervalSeconds / 60}
                    onChange={(e) => set('defaultIntervalSeconds', Number(e.target.value) * 60)}
                  />
                </Field>
                <Field
                  label="持续失败阈值（分钟）"
                  hint="超过此时长，并获得新失败样本，才判为故障。"
                >
                  <input
                    type="number"
                    required
                    min={1}
                    max={1440}
                    step={1}
                    value={form.downAfterSeconds / 60}
                    onChange={(e) => set('downAfterSeconds', Number(e.target.value) * 60)}
                  />
                </Field>
                <Field
                  label="历史数据保留（天）"
                  hint="按小时清理过期探测与发送日志，缩短保留期会删除过期数据。"
                >
                  <input
                    type="number"
                    required
                    min={7}
                    max={365}
                    step={1}
                    value={form.retentionDays}
                    onChange={(e) => set('retentionDays', Number(e.target.value))}
                  />
                </Field>
              </div>
              <Toggle
                label="自动发布故障事件"
                hint="判定故障时自动创建公告；首次成功恢复时自动结束。"
                checked={form.autoIncidents}
                onChange={(v) => set('autoIncidents', v)}
              />
            </section>
            {formError && (
              <div className="form-error" role="alert">
                {formError}
              </div>
            )}
            <div className="settings-save">
              <span className="muted">保存后规则立即生效</span>
              <button className="button primary" disabled={saving}>
                {saving ? <Spinner /> : <Save size={15} />}保存设置
              </button>
            </div>
          </form>
          <aside className="settings-aside">
            <span className="section-kicker">GOOD TO KNOW</span>
            <h3>准确，比漂亮的数字更重要。</h3>
            <div>
              <Check size={15} />
              <p>灰色表示尚无数据，不会默认为 100% 成功。</p>
            </div>
            <div>
              <Check size={15} />
              <p>TTFT 只测正文首块，不把心跳或思考片段算作正文。</p>
            </div>
            <div>
              <Check size={15} />
              <p>速度只使用上游可靠 token 计数，短请求会有波动。</p>
            </div>
            <div>
              <Check size={15} />
              <p>每个目标独立判定；状态页聚合展示最严重状态。</p>
            </div>
            <span>接口密钥与告警凭据加密保存。备份数据库时也需备份加密密钥文件。</span>
          </aside>
        </div>
      )}
      <section className="admin-panel settings-panel password-panel">
        <div className="settings-section-heading">
          <LockKeyhole size={20} />
          <div>
            <h2>管理员安全</h2>
            <p>更新密码后，所有已登录会话失效。</p>
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPasswordError('');
            if (password !== confirm) {
              setPasswordError('两次新密码输入不一致');
              return;
            }
            setChanging(true);
            void api('/admin/password', {
              method: 'POST',
              body: { currentPassword: current, password },
            })
              .then(async () => {
                toast('密码已更新，请重新登录');
                await refreshSession();
              })
              .catch((e) => setPasswordError(e.message))
              .finally(() => setChanging(false));
          }}
        >
          <div className="form-grid">
            <Field label="当前密码">
              <input
                type="password"
                required
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </Field>
            <Field label="新密码（至少 12 位）">
              <input
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Field label="确认新密码">
              <input
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
          </div>
          {passwordError && (
            <div className="form-error" role="alert">
              {passwordError}
            </div>
          )}
          <button className="button secondary" disabled={changing}>
            {changing && <Spinner />}更新密码
          </button>
        </form>
      </section>
    </>
  );
}
