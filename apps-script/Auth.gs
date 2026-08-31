/**
 * Merchforce — buyer auth for gated mode.
 * Sessions are HMAC-signed tokens (email + expiry) so no session table is needed.
 * access_mode 'open' skips all of this.
 */

var SESSION_HOURS = 72;

function fnLogin_(p) {
  var email = String(p.email || '').toLowerCase().trim();
  var rowNum = findRow_('Users', function (r) { return String(r.email).toLowerCase() === email; });
  if (rowNum < 0) return err_('Invalid credentials');
  var u = readRows_('Users')[rowNum - 2];
  if (String(u.active) !== 'TRUE') return err_('Account disabled');
  if (hashPassword_(String(p.password || ''), u.salt) !== u.pass_hash) {
    audit_(email, 'login_fail', '', '');
    return err_('Invalid credentials');
  }
  u.last_login = now_();
  writeRecord_('Users', rowNum, u);
  audit_(email, 'login_ok', '', '');
  return ok_({
    session: makeSession_(email),
    user: { email: u.email, name: u.name, company: u.company }
  });
}

function makeSession_(email) {
  var exp = now_().getTime() + SESSION_HOURS * 3600 * 1000;
  var payload = email + '|' + exp;
  return Utilities.base64EncodeWebSafe(payload) + '.' + sign_(payload);
}

function validSession_(token) {
  if (!token) return false;
  var parts = String(token).split('.');
  if (parts.length !== 2) return false;
  try {
    var payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
    if (sign_(payload) !== parts[1]) return false;
    var exp = Number(payload.split('|')[1]);
    return now_().getTime() < exp;
  } catch (e) { return false; }
}

function sign_(payload) {
  var key = props_().getProperty('PEPPER') || 'k';
  var raw = Utilities.computeHmacSha256Signature(payload, key);
  return raw.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
