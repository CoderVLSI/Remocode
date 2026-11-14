const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function validateEmail(input: string): string | null {
  const email = normalizeEmail(input);
  if (!email) return 'Enter your email address.';
  if (!EMAIL_RE.test(email)) return 'That email address does not look right.';
  return null;
}

export function validatePassword(input: string): string | null {
  if (input.length < 8) return 'Use at least 8 characters.';
  return null;
}

/** Keeps digits only, so pasted codes like "123 456" or "123-456" work. */
export function normalizeCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, 10);
}

/** Supabase email OTPs are 6 digits by default and configurable up to 10. */
export function isCodeComplete(code: string, length = 6): boolean {
  return code.length >= length;
}

/** Turns Supabase auth errors into short, actionable text. */
export function friendlyAuthError(err: { message?: string; status?: number; code?: string } | null | undefined): string {
  if (!err) return 'Something went wrong. Please try again.';
  const msg = (err.message ?? '').toLowerCase();
  const code = err.code ?? '';
  if (code === 'over_email_send_rate_limit' || msg.includes('rate limit') || err.status === 429) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  if (code === 'otp_expired' || msg.includes('expired')) return 'That code has expired. Request a new one.';
  if (msg.includes('invalid') && (msg.includes('token') || msg.includes('otp') || msg.includes('code'))) {
    return 'That code is not right. Check it and try again.';
  }
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
    return 'Wrong email or password.';
  }
  if (code === 'email_not_confirmed' || msg.includes('not confirmed')) {
    return 'Confirm your email first. We can send you a code.';
  }
  if (code === 'user_already_exists' || msg.includes('already registered')) {
    return 'An account with this email already exists. Sign in instead.';
  }
  if (code === 'weak_password' || msg.includes('password should')) {
    return 'That password is too weak. Use a longer one.';
  }
  if (msg.includes('network') || msg.includes('fetch')) return 'No connection. Check your network and try again.';
  return err.message || 'Something went wrong. Please try again.';
}
