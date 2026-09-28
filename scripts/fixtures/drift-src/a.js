const cp = require('child_process');
const crypto = require('crypto');
const https = require('https');
var apiKey = "sk_live_abcdefghijklmnop";
function run(x, db) {
  if (x == 1) { eval(x); }
  cp.exec("ls " + x);
  document.body.innerHTML = x;
  crypto.createHash('md5');
  https.request({ rejectUnauthorized: false });
  db.query("SELECT * FROM t WHERE id = " + x);
  try { x(); } catch (e) { }
}
// TODO fix later
