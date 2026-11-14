import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();
crons.daily('purge old data', { hourUTC: 3, minuteUTC: 17 }, internal.maintenance.purge, {});
export default crons;
