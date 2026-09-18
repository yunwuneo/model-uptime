import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  ArrowUpRight,
  Bell,
  CircleHelp,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Plus,
  Settings2,
  ShieldCheck,
  SquareActivity,
  LockKeyhole,
  ArrowRight,
  Menu,
  X,
} from 'lucide-react';
import { api, setCsrf } from '../api';
import { Brand, Field, Spinner, Toast } from '../ui';
import { AdminContext } from './context';
import { Dashboard } from './Dashboard';
import { Monitors } from './Monitors';
import { Incidents } from './Incidents';
import { Alerts } from './Alerts';
import { Settings } from './Settings';

type Session = { initialized: boolean; authenticated: boolean; csrf: string | null };
const links = [
  ['/admin', '运行概览', LayoutDashboard],
  ['/admin/monitors', '监控目标', SquareActivity],
  ['/admin/incidents', '事件与维护', Megaphone],
  ['/admin/alerts', '告警通知', Bell],
  ['/admin/settings', '站点设置', Settings2],
] as const;
export function Admin() {
  const [session, setSession] = useState<Session | null>(null),
    [sessionError, setSessionError] = useState('');
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null),
    [mobileNav, setMobileNav] = useState(false);
  const location = useLocation();
  const refreshSession = useCallback(async () => {
    try {
      const value = await api<Session>('/auth/session');
      setSession(value);
      setCsrf(value.csrf);
      setSessionError('');
    } catch {
      setSessionError('无法连接后台服务，请确认 API 已启动。');
    }
  }, []);
  useEffect(() => {
    void refreshSession();
    document.title = 'Lumen · 管理控制台';
  }, [refreshSession]);
  useEffect(() => {
    setMobileNav(false);
  }, [location.pathname]);
  const toast = useCallback((message: string, error = false) => setNotice({ message, error }), []);
  const closeToast = useCallback(() => setNotice(null), []);
  if (!session)
    return (
      <div className="auth-page">
        <Brand />
        {sessionError ? (
          <div className="auth-card">
            <p role="alert">{sessionError}</p>
            <button
              className="button primary"
              onClick={() => {
                void refreshSession();
              }}
            >
              重新连接
            </button>
          </div>
        ) : (
          <Spinner />
        )}
      </div>
    );
  if (!session.authenticated)
    return (
      <Login
        initialized={session.initialized}
        onLogin={(value) => {
          setSession(value);
          setCsrf(value.csrf);
        }}
      />
    );
  const active = links.find((l) => l[0] === location.pathname) ?? links[0];
  return (
    <AdminContext.Provider value={{ toast, refreshSession }}>
      <div className="admin-shell">
        <aside className={`admin-sidebar ${mobileNav ? 'mobile-open' : ''}`}>
          <div className="sidebar-brand">
            <Link to="/admin">
              <Brand />
            </Link>
            <button
              className="icon-button mobile-only"
              onClick={() => setMobileNav(false)}
              aria-label="关闭导航"
            >
              <X size={18} />
            </button>
          </div>
          <div className="workspace-switch">
            <span className="workspace-avatar">L</span>
            <div>
              <strong>个人工作空间</strong>
              <span>管理员 · 单实例</span>
            </div>
            <ShieldCheck size={15} />
          </div>
          <span className="sidebar-section-label">工作空间</span>
          <nav>
            {links.map(([path, label, Icon]) => (
              <NavLink
                key={path}
                to={path}
                end={path === '/admin'}
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                <Icon size={18} />
                {label}
                {path === '/admin/monitors' && <span className="nav-shortcut">API</span>}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-note">
              <CircleHelp size={17} />
              <strong>状态，始终清晰。</strong>
              <p>添加真实端点，即可开始记录可用性与响应表现。</p>
              <Link to="/?demo=1">
                查看公开页演示
                <ArrowUpRight size={13} />
              </Link>
            </div>
            <Link to="/" className="sidebar-public">
              公开状态页
              <ArrowUpRight size={15} />
            </Link>
            <div className="sidebar-account">
              <span className="account-avatar">A</span>
              <div>
                <strong>管理员</strong>
                <span>安全会话已启用</span>
              </div>
              <button
                className="icon-button"
                aria-label="退出登录"
                onClick={() => {
                  void api('/admin/logout', { method: 'POST', body: {} })
                    .then(refreshSession)
                    .catch((e) => toast(e.message, true));
                }}
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </aside>
        {mobileNav && <div className="sidebar-backdrop" onClick={() => setMobileNav(false)} />}
        <div className="admin-workspace">
          <header className="admin-topbar">
            <div>
              <button
                className="icon-button mobile-only"
                aria-label="打开导航"
                onClick={() => setMobileNav(true)}
              >
                <Menu size={20} />
              </button>
              <span className="muted">控制台</span>
              <span className="breadcrumb-divider">/</span>
              <span>{active[1]}</span>
            </div>
            <div>
              <Link to="/" className="button text-button">
                访问状态页
                <ArrowUpRight size={14} />
              </Link>
              <span className="topbar-avatar">A</span>
            </div>
          </header>
          <main className="admin-main">
            <Routes>
              <Route index element={<Dashboard />} />
              <Route path="monitors" element={<Monitors />} />
              <Route path="incidents" element={<Incidents />} />
              <Route path="alerts" element={<Alerts />} />
              <Route path="settings" element={<Settings refreshSession={refreshSession} />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </main>
          <footer className="admin-footer">
            <span>Lumen Status</span>
            <span>配置保存在服务器 · 时间为北京时间</span>
          </footer>
        </div>
        {notice && <Toast message={notice.message} error={notice.error} onClose={closeToast} />}
      </div>
    </AdminContext.Provider>
  );
}
function Login({
  initialized,
  onLogin,
}: {
  initialized: boolean;
  onLogin: (session: Session) => void;
}) {
  const [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div className="auth-page">
      <Link to="/">
        <Brand />
      </Link>
      <div className="auth-card">
        <div className="auth-symbol">
          <LockKeyhole size={25} />
        </div>
        <span className="section-kicker">YOUR CONTROL CENTER</span>
        <h1>{initialized ? '欢迎回来。' : '从这里开始。'}</h1>
        <p>{initialized ? '登录控制台，掌握每一次响应。' : '设置管理员密码，开启你的模型监控。'}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError('');
            if (!initialized && password !== confirm) {
              setError('两次密码输入不一致');
              return;
            }
            setBusy(true);
            void api<Session>(initialized ? '/auth/login' : '/auth/setup', {
              method: 'POST',
              body: { password },
            })
              .then(onLogin)
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <Field label="管理员密码" hint={!initialized ? '至少 12 位，没有预设密码。' : undefined}>
            <input
              autoFocus
              type="password"
              autoComplete={initialized ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={initialized ? 1 : 12}
              maxLength={128}
              required
            />
          </Field>
          {!initialized && (
            <Field label="确认密码">
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={12}
                required
              />
            </Field>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button className="button primary auth-submit" disabled={busy}>
            {busy ? <Spinner /> : null}
            {initialized ? '登录控制台' : '创建管理员'}
            <ArrowRight size={16} />
          </button>
        </form>
        <div className="auth-security">
          <ShieldCheck size={13} />
          密码哈希存储 · HttpOnly 安全会话
        </div>
        {!initialized && (
          <small className="auth-initialization-note">
            首次初始化请在本机完成，再开放公网访问。
          </small>
        )}
      </div>
      <Link to="/" className="muted auth-back">
        返回公开状态页
        <ArrowUpRight size={13} />
      </Link>
    </div>
  );
}
export function AdminHeading({
  kicker,
  title,
  description,
  action,
}: {
  kicker: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="admin-heading">
      <div>
        <span className="section-kicker">{kicker}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function AddButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="button primary" onClick={onClick}>
      <Plus size={16} />
      {children}
    </button>
  );
}
