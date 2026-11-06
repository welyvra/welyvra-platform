'use server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { API_KEY_COOKIE, ApiError, api } from '@/lib/api';

export async function login(formData: FormData) {
  const key = String(formData.get('apiKey') ?? '').trim();
  if (!/^wlv_[a-z0-9]{12}_[a-z0-9]{32}$/.test(key)) redirect('/login?error=format');
  (await cookies()).set(API_KEY_COOKIE, key, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 8,
  });
  redirect('/');
}

export async function logout() {
  (await cookies()).delete(API_KEY_COOKIE);
  redirect('/login');
}

export type ActionState = { error?: string; ok?: string };

async function run(fn: () => Promise<unknown>, ok: string, paths: string[]): Promise<ActionState> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    throw e;
  }
  for (const p of paths) revalidatePath(p);
  return { ok };
}

export async function runReconciliation(_: ActionState): Promise<ActionState> {
  return run(() => api('/v1/reconciliation-runs', { method: 'POST' }), 'Reconciliation completed', [
    '/',
    '/reconciliation',
    '/cases',
  ]);
}

export async function attributeDeposit(_: ActionState, form: FormData): Promise<ActionState> {
  const depositId = String(form.get('depositId'));
  const caseId = String(form.get('caseId') ?? '');
  const result = await run(
    () =>
      api(`/v1/deposits/${depositId}/attribute`, {
        method: 'POST',
        body: { customer_id: String(form.get('customerId')), reason: String(form.get('reason')) },
      }),
    'Deposit attributed',
    ['/', '/deposits', '/cases'],
  );
  // The form unmounts once the case is resolved, so confirm on the case page itself.
  if (result.ok && /^[0-9a-f-]{36}$/.test(caseId)) redirect(`/cases/${caseId}?updated=attributed`);
  return result;
}

export async function transitionCase(_: ActionState, form: FormData): Promise<ActionState> {
  const caseId = String(form.get('caseId'));
  const result = await run(
    () =>
      api(`/v1/cases/${caseId}/transitions`, {
        method: 'POST',
        body: { to: String(form.get('to')), reason: String(form.get('reason')) },
      }),
    'Case updated',
    ['/', '/cases', `/cases/${caseId}`],
  );
  if (result.ok && /^[0-9a-f-]{36}$/.test(caseId)) redirect(`/cases/${caseId}?updated=status`);
  return result;
}
