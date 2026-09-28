import * as cp from 'child_process';
import * as crypto from 'crypto';
const apiKey = "sk_live_abcdefghijklmnop";
export function run(x: any, db: any): void {
  if (x == 1) { eval(x); }
  cp.exec("ls " + x);
  document.body.innerHTML = x;
  crypto.createHash('md5');
  const opts = { rejectUnauthorized: false };
  db.query("SELECT * FROM t WHERE id = " + x);
  try { x(); } catch (e) { }
  var y = 2;
}
// TODO fix later
