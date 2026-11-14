import { getAuthUserId } from '@convex-dev/auth/server';

import { query } from './_generated/server';

/** Who is signed in (null when nobody is). Safe to call before sign-in. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    return user ? { _id: user._id, email: user.email ?? null } : null;
  },
});
