import {
  friendlyAuthError,
  isCodeComplete,
  normalizeCode,
  normalizeEmail,
  validateEmail,
  validatePassword,
} from '../authValidation';

describe('email', () => {
  it('normalises case and whitespace', () => {
    expect(normalizeEmail('  Me@Example.COM ')).toBe('me@example.com');
  });
  it.each(['', '   ', 'plain', 'a@b', 'a b@c.com', '@x.com'])('rejects %j', (v) => {
    expect(validateEmail(v)).not.toBeNull();
  });
  it.each(['a@b.co', 'first.last+tag@sub.example.org'])('accepts %s', (v) => {
    expect(validateEmail(v)).toBeNull();
  });
});

describe('password', () => {
  it('requires 8+ characters', () => {
    expect(validatePassword('1234567')).not.toBeNull();
    expect(validatePassword('12345678')).toBeNull();
  });
});

describe('otp code', () => {
  it('keeps digits only and caps the length', () => {
    expect(normalizeCode('123 456')).toBe('123456');
    expect(normalizeCode('12-34-56')).toBe('123456');
    expect(normalizeCode('abc')).toBe('');
    expect(normalizeCode('1'.repeat(30))).toHaveLength(10);
  });
  it('knows when a code is complete', () => {
    expect(isCodeComplete('12345')).toBe(false);
    expect(isCodeComplete('123456')).toBe(true);
    expect(isCodeComplete('1234567', 8)).toBe(false);
  });
});

describe('friendlyAuthError', () => {
  it.each([
    [{ code: 'over_email_send_rate_limit', message: 'x' }, /too many attempts/i],
    [{ status: 429, message: 'x' }, /too many attempts/i],
    [{ code: 'otp_expired', message: 'Token has expired or is invalid' }, /expired/i],
    [{ message: 'Token has expired or is invalid' }, /expired/i],
    [{ message: 'Invalid OTP token' }, /not right/i],
    [{ code: 'invalid_credentials', message: 'Invalid login credentials' }, /wrong email or password/i],
    [{ code: 'email_not_confirmed', message: 'Email not confirmed' }, /confirm your email/i],
    [{ code: 'user_already_exists', message: 'User already registered' }, /already exists/i],
    [{ code: 'weak_password', message: 'Password should be at least 6 characters' }, /too weak/i],
    [{ message: 'Network request failed' }, /no connection/i],
    [{ message: 'Something unusual' }, /something unusual/i],
    [null, /try again/i],
  ])('maps %j', (err, expected) => {
    expect(friendlyAuthError(err as never)).toMatch(expected);
  });
});
