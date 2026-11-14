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

/** Emailed sign-in codes are 6 digits (see convex/auth.ts). */
export function isCodeComplete(code: string, length = 6): boolean {
  return code.length >= length;
}

export type AuthStep = 'signIn' | 'signUp' | 'sendCode' | 'verifyCode';

/**
 * Turns Convex Auth errors into short, actionable text. Production deployments redact server
 * errors to a generic "Server Error", so when the text carries no detail we fall back to what
 * is most likely for the step the user was on.
 */
export function friendlyAuthError(err: unknown, step: AuthStep): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const msg = raw.toLowerCase();

  if (/network|failed to fetch|websocket|timed? ?out|offline/.test(msg)) {
    return 'No connection. Check your network and try again.';
  }
  if (msg.includes('too many') || msg.includes('rate limit') || msg.includes('ratelimit')) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  if (msg.includes('already exists')) return 'An account with this email already exists. Sign in instead.';
  if (msg.includes('invalid password')) return 'That password is too weak. Use at least 8 characters.';
  if (msg.includes('could not verify code') || msg.includes('invalid code')) {
    return 'That code is not right or has expired. Check it or request a new one.';
  }
  if (msg.includes('invalid credentials') || msg.includes('invalidaccountid') || msg.includes('invalidsecret')) {
    return 'Wrong email or password.';
  }
  if (msg.includes('not set up on this backend') || msg.includes('resend')) {
    return 'Email codes are not set up on this backend yet. Sign in with your password.';
  }
  if (msg.includes('provider') && (msg.includes('not configured') || msg.includes('not found') || msg.includes('resend-otp'))) {
    return 'Email codes are not set up on this backend yet. Sign in with your password.';
  }

  // Redacted production error (or nothing useful): describe the likely cause for this step.
  if (!raw || msg.includes('server error')) {
    switch (step) {
      case 'signIn':
        return 'Wrong email or password, or no account exists for this email yet.';
      case 'signUp':
        return 'Could not create the account. It may already exist, or the password is too short (use 8+ characters).';
      case 'sendCode':
        return 'Could not send the code. Email codes may not be set up on this backend; use your password instead.';
      case 'verifyCode':
        return 'That code is not right or has expired. Check it or request a new one.';
    }
  }
  return raw.replace(/^\[CONVEX [^\]]*\]\s*(\[Request ID: [^\]]*\]\s*)?/i, '').slice(0, 200) || 'Something went wrong. Please try again.';
}
