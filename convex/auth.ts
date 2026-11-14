import { Email } from '@convex-dev/auth/providers/Email';
import { Password } from '@convex-dev/auth/providers/Password';
import { convexAuth } from '@convex-dev/auth/server';

/**
 * Emailed one-time codes, sent through Resend's HTTP API. This only turns on when AUTH_RESEND_KEY
 * is set on the deployment; without it, password sign-in still works.
 *
 * Note: Resend's shared sender (onboarding@resend.dev) only delivers to your own Resend account
 * email until you verify a domain and set AUTH_EMAIL_FROM.
 */
const resendKey = process.env.AUTH_RESEND_KEY;

const ResendOTP = Email({
  id: 'resend-otp',
  apiKey: resendKey,
  maxAge: 60 * 15,
  // 6 digits from a cryptographically secure source (runs in an action, where real randomness exists).
  async generateVerificationToken() {
    const bytes = crypto.getRandomValues(new Uint32Array(1));
    return String(bytes[0] % 1_000_000).padStart(6, '0');
  },
  async sendVerificationRequest({ identifier: email, token }) {
    if (!resendKey) throw new Error('Email codes are not set up on this backend (AUTH_RESEND_KEY is missing).');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.AUTH_EMAIL_FROM ?? 'Remo Code <onboarding@resend.dev>',
        to: [email],
        subject: `Your Remo Code code: ${token}`,
        text: `Your Remo Code sign-in code is ${token}.\n\nIt expires in 15 minutes. If you did not ask for it, ignore this email.`,
      }),
    });
    if (!res.ok) throw new Error(`Could not send the email (${res.status}).`);
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    // Email + password. With Resend configured, new accounts must confirm their email with a code.
    Password({
      profile(params) {
        return { email: String(params.email ?? '').trim().toLowerCase() };
      },
      ...(resendKey ? { verify: ResendOTP } : {}),
    }),
    // Passwordless: "email me a code".
    ...(resendKey ? [ResendOTP] : []),
  ],
});
