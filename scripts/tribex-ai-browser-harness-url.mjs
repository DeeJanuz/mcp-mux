const baseUrl = process.env.MCPVIEWS_DEV_URL || 'http://localhost:1420/';
const scenario = process.env.TRIBEX_AI_HARNESS_SCENARIO || 'review-churn';
const url = new URL(baseUrl);

url.searchParams.set('mcpviews_harness', 'ai');
url.searchParams.set('scenario', scenario);

console.log(JSON.stringify({
  url: url.toString(),
  notes: [
    'Open this URL in the Codex in-app browser.',
    'Do not launch the installed MCPViews macOS app for this workflow.',
    'Use browser screenshots at each harness stage for visual inspection.',
  ],
}, null, 2));
