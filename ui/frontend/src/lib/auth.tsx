// Demo-only sign in: any email and password are accepted. Nothing leaves the browser.
// The signed-in user lives in sessionStorage, so closing the tab signs out.
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

export interface User {
  email: string;
  name: string;
}

const KEY = 'wrist-exo-user';

export function currentUser(): User | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export async function signIn(email: string, _password: string): Promise<User> {
  await new Promise((r) => setTimeout(r, 700)); // feels like a network call
  const local = email.split('@')[0] || 'clinician';
  const name = local.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const user = { email, name };
  try { sessionStorage.setItem(KEY, JSON.stringify(user)); } catch { /* storage blocked: stay in memory */ }
  return user;
}

export function signOut() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Sends signed-out visitors to the sign-in page, then back where they were going. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const loc = useLocation();
  if (!currentUser()) return <Navigate to="/signin" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}
