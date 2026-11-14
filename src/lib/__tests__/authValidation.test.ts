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
  const e = (m: string) => new Error(m);
  it.each([
    [e('Invalid credentials'), 'signIn', /wrong email or password/i],
    [e('[CONVEX A(auth:signIn)] [Request ID: abc] Server Error\nUncaught Error: Invalid credentials'), 'signIn', /wrong email or password/i],
    [e('Account me@x.com already exists'), 'signUp', /already exists/i],
    [e('Invalid password'), 'signUp', /too weak/i],
    [e('Could not verify code'), 'verifyCode', /not right or has expired/i],
    [e('Invalid code'), 'verifyCode', /not right or has expired/i],
    [e('Too many failed attempts'), 'verifyCode', /too many attempts/i],
    [e('Network request failed'), 'signIn', /no connection/i],
    [e('Email codes are not set up on this backend (AUTH_RESEND_KEY is missing).'), 'sendCode', /not set up/i],
  ])('maps %j', (err, step, expected) => {
    expect(friendlyAuthError(err, step as never)).toMatch(expected);
  });

  it('falls back to a likely cause for redacted production errors, per step', () => {
    const redacted = e('[CONVEX A(auth:signIn)] [Request ID: 1f2e] Server Error');
    expect(friendlyAuthError(redacted, 'signIn')).toMatch(/wrong email or password/i);
    expect(friendlyAuthError(redacted, 'signUp')).toMatch(/could not create the account/i);
    expect(friendlyAuthError(redacted, 'sendCode')).toMatch(/use your password/i);
    expect(friendlyAuthError(redacted, 'verifyCode')).toMatch(/not right or has expired/i);
    expect(friendlyAuthError(null, 'signIn')).toMatch(/wrong email or password/i);
  });

  it('strips Convex prefixes from unknown messages and caps their length', () => {
    expect(friendlyAuthError(e('[CONVEX A(x)] [Request ID: 9] Something unusual happened'), 'signIn')).toBe('Something unusual happened');
    expect(friendlyAuthError(e('x'.repeat(500)), 'signIn').length).toBeLessThanOrEqual(200);
  });
});
