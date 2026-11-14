// Tells Convex to trust the tokens issued by Convex Auth on this deployment.
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: 'convex',
    },
  ],
};
