import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { signIn } from '../../lib/auth';

export default function SignIn() {
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [email, setEmail] = useState('jordan.lee@clinic.test');
  const [password, setPassword] = useState('demo');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!email.trim()) next.email = 'Enter your email.';
    else if (!/^\S+@\S+$/.test(email)) next.email = 'Enter an email like name@clinic.org.';
    if (!password) next.password = 'Enter your password.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    await signIn(email.trim(), password);
    // Connect to the exo next, unless they were heading somewhere specific.
    navigate(from && from !== '/connect' ? from : '/connect', { replace: true });
  }

  return (
    <form className="signin" onSubmit={submit} noValidate>
      <h1 className="start-title">Wrist Exo</h1>
      <p className="start-sub">Sign in to start a session.</p>

      <label className="field">
        <span className="field-label">Email</span>
        <input type="email" autoComplete="username" value={email}
          aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-err' : undefined}
          onChange={(e) => setEmail(e.target.value)} />
        {errors.email && <span id="email-err" className="field-err">{errors.email}</span>}
      </label>

      <label className="field">
        <span className="field-label">Password</span>
        <input type="password" autoComplete="current-password" value={password}
          aria-invalid={!!errors.password} aria-describedby={errors.password ? 'pw-err' : undefined}
          onChange={(e) => setPassword(e.target.value)} />
        {errors.password && <span id="pw-err" className="field-err">{errors.password}</span>}
      </label>

      <button className="btn signin-btn" type="submit" disabled={busy}>
        {busy ? 'Signing in' : 'Sign in'}
      </button>
      <p className="signin-note">Demo account: any email and password will work.</p>
    </form>
  );
}
