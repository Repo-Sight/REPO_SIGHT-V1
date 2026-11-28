// api/baseline.js
//
// POST   /api/baseline   { "scanId": "<uuid>" }       set or replace the baseline of that scan's repo
// DELETE /api/baseline?repo=owner/name                clear the baseline of a repo
// Sign-in required. All logic lives in api/_lib/baseline.js. Include /api/baseline in the Vercel Firewall rate limit.
import { handleBaseline } from "./_lib/baseline.js";

export default function handler(req, res) {
  return handleBaseline(req, res);
}
