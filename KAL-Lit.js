/* KAL Lit — litigation panel for CasePeer.
   This case: renames and files new documents (top of Documents), reads litigation PDFs, works out FINAL deadline dates
   (CA court holidays, service-method extensions, weekends), saves only when a person clicks, then reads everything back.
   All cases: problems across open litigation files. */
(function () {
  'use strict';
  var VERSION = 'v1.1';
  if (location.hostname !== 'my.casepeer.com') { window.alert('Open CasePeer first, then click KAL Lit.'); return; }
  var old = document.getElementById('kl-root'); if (old) old.remove();
  var KLP = (function () {
  var MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
  // scans often lose spaces ("December 10,2026", "March22,2027"), so spaces are optional
  var DS = '(?:' + MONTHS + ')\\s*\\d{1,2}(?:st|nd|rd|th)?\\s*,?\\s*\\d{4}|\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}';
  var WD = '(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\\s*)?';
  var DATE_RE = new RegExp('(' + MONTHS + ')\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(\\d{4})|\\b(\\d{1,2})\\/(\\d{1,2})\\/(\\d{2,4})\\b', 'gi');
  function toDate(m) {
    if (m[1]) { var mi = MONTHS.split('|').map(function (x) { return x.toLowerCase(); }).indexOf(m[1].toLowerCase()); return new Date(+m[3], mi, +m[2]); }
    var y = +m[6]; if (y < 100) y += 2000; return new Date(y, +m[4] - 1, +m[5]);
  }
  function datesIn(s) { var out = [], m; DATE_RE.lastIndex = 0; while ((m = DATE_RE.exec(s))) { var d = toDate(m); if (!isNaN(d) && d.getFullYear() > 2000 && d.getFullYear() < 2100) out.push({ d: d, i: m.index, raw: m[0] }); } return out; }
  function sq(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function clip(s, n) { s = sq(s); return s.length > n ? s.slice(0, n).trim() : s; }

  // proof-of-service block = text after the last "PROOF OF SERVICE" heading
  function posBlock(all) {
    var re = /PROOF OF (ELECTRONIC )?SERVICE/gi, m, last = -1; while ((m = re.exec(all))) last = m.index;
    return last >= 0 ? all.slice(last) : '';
  }
  function serviceMethod(block) {
    var b = block;
    // checked boxes: [X], [x], ☒, ■, X BY ...
    var checked = b.match(/(\[\s*[xX✓]\s*\]|☒|■|☑)\s*\(?\s*(BY\s+)?(ELECTRONIC|E-?SERVICE|EMAIL|E-MAIL|U\.?S\.? MAIL|MAIL|PERSONAL|OVERNIGHT|FEDERAL EXPRESS|EXPRESS|FAX|FACSIMILE)/i);
    var pick = checked ? checked[3] : null;
    if (!pick) {
      var hits = {};
      if (/\b(BY\s+)?(ELECTRONIC\s+(SERVICE|TRANSMISSION|MAIL)|E-?SERVICE|E-?MAIL)\b/i.test(b)) hits.e = 1;
      if (/\bBY\s+(FIRST[- ]CLASS\s+)?(U\.?S\.?\s+)?MAIL\b|placing.{0,80}(mail|envelope)|deposited.{0,60}mail/i.test(b)) hits.m = 1;
      if (/\bOVERNIGHT|FEDERAL EXPRESS|EXPRESS MAIL|GSO|UPS NEXT/i.test(b)) hits.o = 1;
      if (/\bBY PERSONAL (SERVICE|DELIVERY)\b|personally delivered/i.test(b)) hits.p = 1;
      var k = Object.keys(hits); if (k.length === 1) pick = { e: 'ELECTRONIC', m: 'MAIL', o: 'OVERNIGHT', p: 'PERSONAL' }[k[0]];
    }
    if (!pick) return '';
    pick = pick.toUpperCase();
    if (/ELECTRONIC|E-?SERVICE|E-?MAIL|EMAIL/.test(pick)) return 'electronic';
    if (/OVERNIGHT|EXPRESS|FEDERAL/.test(pick)) return 'overnight';
    if (/PERSONAL/.test(pick)) return 'personal';
    if (/FAX|FACSIMILE/.test(pick)) return 'fax';
    if (/MAIL/.test(pick)) return 'mail';
    return '';
  }
  function serviceDate(block) {
    // prefer "On <date>, I served" / "Date: <date>" / "Executed on <date>"
    var m = block.match(new RegExp('\\bOn\\s+' + WD + '(' + DS + ')', 'i'));
    if (m) { var d = datesIn(m[1])[0]; if (d) return d.d; }
    var ds = datesIn(block); if (!ds.length) return null;
    var ex = block.search(/executed on|dated:/i);
    if (ex >= 0) { var after = ds.filter(function (x) { return x.i > ex; })[0]; if (after) return after.d; }
    return ds[0].d;
  }

  function datedDate(t) { var m = t.match(new RegExp('Dated?\\s*:?\\s*' + WD + '(' + DS + ')', 'i')); var d = m && datesIn(m[1])[0]; return d ? d.d : null; }
  function classify(t) {
    var up = t.toUpperCase(), h0 = up.slice(0, 5000);
    // their verified responses to our discovery
    if (/RESPONSES?\s+(OF\s+[^\n]{0,80}?)?TO\s+(PLAINTIFF'?S?\s+)?(FORM|SPECIAL|SPECIALLY|REQUESTS?|DEMAND|INTERROGATOR)/.test(h0) && /RESPONDING PARTY:?\s*DEFENDANT/.test(up)) return 'responses';
    if (/NOTICE OF (THE )?(TAKING )?(THE )?(VIDEO(TAPED)? |REMOTE |AUDIO ?(AND|&) ?VIDEO ?)?DEPOSITION|DEPOSITION SUBPOENA/.test(h0)) return 'depo';
    if (/DEMAND FOR (MUTUAL |SIMULTANEOUS )?(EXCHANGE|DESIGNATION) OF EXPERT|EXPERT WITNESS (INFORMATION|DEMAND)|CODE OF CIVIL PROCEDURE,? (SECTION )?§? ?2034\.2/.test(h0)) return 'expert';
    if (/DISC-0\d\d|FORM INTERROGATORIES/.test(up.slice(0, 3000)) && !/PROPOUNDING PARTY/.test(up)) return /ATTORNEYS? FOR PLAINTIFF|PROPOUNDED TO PLAINTIFF|TO PLAINTIFF/.test(up) ? 'disc_on_us' : 'disc_by_us';
    if (/PROOF OF SERVICE OF SUMMONS|POS-010/.test(up)) return 'summons_pos';
    if (/\bCOMPLAINT FOR\b|PLD-PI-001|^\s*COMPLAINT\b/.test(h0) && /ATTORNEYS? FOR PLAINTIFF/.test(h0) && !/ANSWER/.test(h0.slice(0, 2500))) return 'complaint';
    if (/PROPOUNDING PARTY/.test(up) && /RESPONDING PARTY/.test(up)) {
      var pp = (t.match(/PROPOUNDING PARTY:?\s*(.{0,120})/i) || [])[1] || '';
      return /PLAINTIFF/i.test(pp.split(/RESPONDING/i)[0]) ? 'disc_by_us' : 'disc_on_us';
    }
    var head = up.slice(0, 4000);
    if (/\bANSWER\b/.test(head) && /(DEFENDANT|ATTORNEYS? FOR)/.test(head) && !/CASE MANAGEMENT STATEMENT/.test(head)) return 'answer';
    if (/CASE MANAGEMENT STATEMENT|CM-110/.test(head)) return 'cmc_statement';
    if (/SUMMARY JUDGMENT|NOTICE OF (CASE MANAGEMENT|TRIAL|HEARING|MOTION|RULING|STATUS)|MINUTE ORDER|ORDER SETTING|NOTICE OF CASE ASSIGNMENT|CASE MANAGEMENT CONFERENCE/.test(head)) return 'notice';
    return 'unknown';
  }

  function discType(t) {
    var up = t.toUpperCase().slice(0, 6000);
    var types = [
      [/SPECIAL(LY PREPARED)?\s+INTERROGATORIES/, 'Special Interrogatories'],
      [/FORM INTERROGATORIES/, 'Form Interrogatories'],
      [/REQUESTS? FOR ADMISSIONS?/, 'Requests for Admission'],
      [/REQUESTS? FOR (THE )?PRODUCTION|DEMAND FOR (THE )?(PRODUCTION|INSPECTION)|INSPECTION DEMAND/, 'Requests for Production'],
      [/DEMAND FOR (EXCHANGE OF EXPERT|DESIGNATION OF EXPERT)|EXPERT WITNESS/, 'Demand for Expert Exchange'],
      [/NOTICE OF (TAKING )?(THE )?DEPOSITION|DEPOSITION SUBPOENA/, 'Deposition Notice']
    ];
    for (var i = 0; i < types.length; i++) if (types[i][0].test(up)) return types[i][1];
    return 'Discovery';
  }

  function readDiscovery(t) {
    var pp = sq((t.match(/PROPOUNDING PARTY:?\s*(.{0,200}?)\s*RESPONDING PARTY/i) || [])[1] || '');
    var rp = sq((t.match(/RESPONDING PARTY:?\s*(.{0,160}?)\s*SET\s*(NO\.?|NUMBER)/i) || [])[1] || '');
    var set = sq((t.match(/SET\s*(NO\.?|NUMBER):?\s*([A-Za-z0-9]+)/i) || [])[2] || '');
    var block = posBlock(t);
    if (!pp) pp = sq((block.match(/BY DEFENDANTS?,?\s*(.{0,100}?)\s+on the parties/i) || [])[1] || '');
    var sv = serviceDate(block), noPos = false;
    if (!sv) { sv = datedDate(t); noPos = true; }
    return {
      noPos: noPos, region: (pp + ' ' + block.slice(0, 600)),
      kind: 'disc_on_us', what: discType(t), set: set, from: clip(pp.replace(/^Defendants?,?\s*/i, ''), 120), to: clip(rp.replace(/^Plaintiffs?,?\s*/i, ''), 80),
      served: sv, method: noPos ? '' : serviceMethod(block)
    };
  }

  function readSummonsPOS(t) {
    // party served (item 3a)
    var party = sq((t.match(/Party served \(specify name of party as shown on documents served\):?\s*(.{0,140}?)\s*(b\.|\bb\s|Person|4\.)/i) || [])[1] || '');
    var per = t.match(/by personal service\.[\s\S]{0,400}?on \(date\):\s*(\S+)/i);
    var perDate = per ? (datesIn(per[1])[0] || {}).d : null;
    var sub = t.match(/by substituted service\.\s*On \(date\):\s*(\S+)/i);
    if (sub && !datesIn(sub[1]).length) sub = null;
    var subDate = sub ? (datesIn(sub[1])[0] || {}).d : null;
    var mailed = t.match(/mailed the documents on \(date\):\s*(\S+)/i) || t.match(/thereafter mailed[\s\S]{0,400}?on \(date\):\s*(\S+)/i);
    if (mailed && !datesIn(mailed[1]).length) mailed = null;
    var mailDate = mailed ? (datesIn(mailed[1])[0] || {}).d : null;
    var method = perDate ? 'personal' : (subDate || mailDate) ? 'substituted' : '';
    var pi = t.search(/Party served/i);
    return { region: pi >= 0 ? t.slice(pi, pi + 700) : t.slice(0, 1500), kind: 'summons_pos', party: clip(party, 120), method: method, personalDate: perDate, subDate: subDate, mailDate: mailDate };
  }

  function readAnswer(t) {
    var head = t.slice(0, 3500);
    var forWho = sq((head.match(/Attorneys? for\s+(Defendants?|Cross-?Complainants?)?,?\s*(.{0,200}?)(SUPERIOR COURT|UNITED STATES|\d{1,2}\s+\d{1,2}\s+\d{1,2})/i) || [])[2] || '');
    // firm = the ALL-CAPS line(s) before "Attorneys for", ending in LLP/APC/LLC/PC/Office/Associates
    var firm = sq((head.match(/([A-Z][A-Z&.,' ]{3,90}(LLP|L\.L\.P\.|APC|A\.P\.C\.|LLC|P\.C\.|PC|ASSOCIATES|LAW OFFICES?[A-Z .,']*|ATTORNEY))/) || [])[1] || '');
    var block = posBlock(t);
    var sv = serviceDate(block), noPos = false; if (!sv) { sv = datedDate(t); noPos = true; }
    var ai = head.search(/Attorneys? for|COMES? NOW|ANSWERING DEFENDANT/i);
    return { noPos: noPos, region: ai >= 0 ? head.slice(Math.max(0, ai - 200), ai + 500) : head, head: head, kind: 'answer', defendant: clip(forWho, 140), firm: clip(firm, 90), served: sv, method: noPos ? '' : serviceMethod(block) };
  }

  function readNotice(t) {
    var up = t.toUpperCase();
    var h1 = up.slice(0, 4000);
    var what = /SUMMARY JUDGMENT|SUMMARY ADJUDICATION/.test(h1) ? 'msj' : /MANDATORY SETTLEMENT/.test(up) ? 'msc' : /FINAL STATUS/.test(up) ? 'fsc' : /TRIAL SETTING/.test(up) ? 'tsc' : /CASE MANAGEMENT CONFERENCE/.test(up) ? 'cmc' : /\bMEDIATION\b/.test(up) ? 'mediation' : /SUMMARY JUDGMENT/.test(up) ? 'msj' : /\bTRIAL\b/.test(up) ? 'trial' : 'hearing';
    // hearing date: "Date: <date>" or "on <date> at <time>"
    var m = t.match(new RegExp('(?:Hearing Date|Date of Hearing|\\bDate)\\s*:?\\s*' + WD + '(' + DS + ')', 'i')) ||
            t.match(new RegExp('\\bon\\s+' + WD + '(' + DS + ')\\s*,?\\s*at\\s+\\d', 'i'));
    var ds = m ? datesIn(m[1]) : [];
    var tm = t.match(/Time\s*:?\s*(\d{1,2}:\d{2}\s*[AaPp]\.?[Mm]\.?)/) || t.match(/at\s+(\d{1,2}:\d{2}\s*[AaPp]\.?[Mm]\.?)/);
    var time = sq(tm ? tm[1] : '');
    var dept = sq((t.match(/(Dept\.?|Department)\s*:?\s*([A-Za-z0-9-]{1,6})/i) || [])[2] || '');
    var title = /SUMMARY ADJUDICATION/.test(h1) && !/SUMMARY JUDGMENT/.test(h1) ? 'MSA Notice' : what === 'msj' ? 'MSJ Notice' : /MINUTE ORDER/.test(h1) ? 'Minute Order' : /NOTICE OF RULING/.test(h1) ? 'Notice of Ruling' : /NOTICE OF MOTION/.test(h1) ? 'Notice of Motion' :
      { cmc: 'Notice of CMC', tsc: 'Notice of TSC', trial: 'Notice of Trial', mediation: 'Notice of Mediation', msc: 'Notice of MSC', fsc: 'Notice of FSC' }[what] || 'Notice of Hearing';
    return { kind: 'notice', what: what, title: title, date: ds[0] ? ds[0].d : null, time: time, dept: dept };
  }

  // who filed it: we are plaintiffs' counsel, so "Attorneys for Plaintiff" = us
  function filedBy(t) {
    var h = t.slice(0, 4000), m = h.match(/ATTORNEY FOR \(Name\):?\s*(.{0,80}?)(\s{2,}|NAME OF COURT|SUPERIOR COURT|$)/i);
    var who = m ? sq(m[1]) : '';
    if (!who) { var a = h.match(/Attorneys? for\s+((Plaintiffs?|Defendants?|Cross-?\w+)[^\n]{0,80}?)(SUPERIOR COURT|UNITED STATES|\s{3,}|$)/i); who = a ? sq(a[1]) : ''; }
    if (!who) return null;
    if (/^plaintiff/i.test(who)) return { us: true, label: 'us (plaintiff)' };
    return { us: false, label: clip(who.replace(/[,;]+$/, ''), 80) };
  }
  function read(pages) {
    var t = pages.join('\n');
    var chars = t.replace(/\s/g, '').length;
    if (chars < 200) return { kind: 'scan', note: 'No text in this PDF (scanned image).' };
    var k = classify(t), fed = /UNITED STATES DISTRICT COURT|Federal Rules? of Civil Procedure|\bFed\. ?R\. ?Civ\. ?P\b|\d:\d{2}-cv-\d+/i.test(t);
    var r0 = readKind(k, t); r0.federal = fed;
    // date for the file name: when it was served (proof of service), else the "Dated:" line
    r0.docDate = r0.served || serviceDate(posBlock(t)) || datedDate(t) || null;
    r0.region2 = t.slice(0, 2500);
    r0.filedBy = filedBy(t);
    return r0;
  }
  function readKind(k, t) {
    if (k === 'disc_on_us') return readDiscovery(t);
    if (k === 'disc_by_us') { var r = readDiscovery(t); r.kind = 'disc_by_us'; return r; }
    if (k === 'summons_pos') return readSummonsPOS(t);
    if (k === 'answer') return readAnswer(t);
    if (k === 'notice') return readNotice(t);
    if (k === 'responses') { var rr = readDiscovery(t); rr.kind = 'responses'; rr.what = discType(t); rr.from = clip(sq((t.match(/RESPONDING PARTY:?\s*(.{0,160}?)\s*SET\s*(NO\.?|NUMBER)/i) || [])[1] || '').replace(/^Defendants?,?\s*/i, ''), 120); return rr; }
    if (k === 'complaint') return { kind: 'complaint' };
    if (k === 'depo') {
      var dn = readNotice(t), who = sq((t.match(/DEPOSITION OF\s+(?:PLAINTIFF,?\s+|DEFENDANT,?\s+|THE PERSON MOST QUALIFIED OF\s+|PMQ OF\s+)?([A-Z][A-Za-z.'\- ]{2,50}?)(?=\s*(,|ON\b|WILL\b|AT\b|PLEASE\b|TO\b|\(|\n|DATE))/i) || [])[1] || '');
      return { kind: 'depo', what: who ? 'Deposition of ' + who.replace(/\b([A-Z])([A-Z]+)\b/g, function (m0, a, b) { return a + b.toLowerCase(); }) : 'Deposition', date: dn.date, time: dn.time, dept: '', served: serviceDate(posBlock(t)) };
    }
    if (k === 'expert') {
      var em = t.match(new RegExp('(?:on or before|exchange[^.]{0,120}?\\bon|date (?:of|for) (?:the )?exchange:?)\\s*' + WD + '(' + DS + ')', 'i'));
      return { kind: 'expert', date: em ? (datesIn(em[1])[0] || {}).d || null : null, served: serviceDate(posBlock(t)) };
    }
    if (k === 'cmc_statement') { var cs = readNotice(t); cs.what = 'cmc'; cs.title = 'CMC Statement'; cs.statement = true; return cs; }
    return { kind: 'unknown' };
  }
  return { read: read, datesIn: datesIn, serviceMethod: serviceMethod, serviceDate: serviceDate };
})();

  // ---------- people ----------
  var STAFF = [[26695, 'Ashley'], [41457, 'Miguel'], [48160, 'Juan'], [14839, 'Kevin'], [14958, 'Michael']];
  var NEW_DAYS = 21; // a PDF counts as new if uploaded in the last 21 days and not calendared yet
  var INBOX_DAYS = 30; // unfiled list shows the last 30 days; older files sit behind a link
  var TASK_TO = [26695, 41457, 48160]; // Ashley, Miguel, Juan
  function getAssignees() { try { var v = JSON.parse(localStorage.getItem('kl-assign2') || 'null'); if (v && v.length) return v; } catch (e) { } return [26695, 41457, 48160, 14839]; }
  function setAssignees(v) { try { localStorage.setItem('kl-assign2', JSON.stringify(v)); } catch (e) { } }

  // ---------- dates ----------
  function to24(s) { var m = String(s || '').match(/(\d{1,2}):(\d{2})\s*([AaPp])?/); if (!m) return ''; var h = +m[1]; if (m[3] && /p/i.test(m[3]) && h < 12) h += 12; if (m[3] && /a/i.test(m[3]) && h === 12) h = 0; return ('0' + h).slice(-2) + ':' + m[2]; }
  function to12(s) { var m = String(s || '').match(/^(\d{1,2}):(\d{2})/); if (!m) return ''; var h = +m[1], ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return h + ':' + m[2] + ' ' + ap; }
  function fmt(d) { return d ? ('0' + (d.getMonth() + 1)).slice(-2) + '/' + ('0' + d.getDate()).slice(-2) + '/' + d.getFullYear() : ''; }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fromIso(s) { if (!s) return null; var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function pd(s) { var p = String(s || '').trim().split(' ')[0].split('/'); if (p.length !== 3) return null; var d = new Date(+p[2], +p[0] - 1, +p[1]); return isNaN(d) ? null : d; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function today() { var t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
  function same(a, b) { return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function nthDow(y, m, dow, n) { var d = new Date(y, m, 1); while (d.getDay() !== dow) d = addDays(d, 1); return addDays(d, 7 * (n - 1)); }
  function lastDow(y, m, dow) { var d = new Date(y, m + 1, 0); while (d.getDay() !== dow) d = addDays(d, -1); return d; }
  function obs(d) { return d.getDay() === 6 ? addDays(d, -1) : d.getDay() === 0 ? addDays(d, 1) : d; }
  var HOL = {};
  function holidays(y) {
    if (HOL[y]) return HOL[y]; var tg = nthDow(y, 10, 4, 4);
    return (HOL[y] = [[obs(new Date(y, 0, 1)), "New Year's Day"], [nthDow(y, 0, 1, 3), 'MLK Day'], [obs(new Date(y, 1, 12)), "Lincoln's Birthday"], [nthDow(y, 1, 1, 3), "Presidents' Day"],
      [obs(new Date(y, 2, 31)), 'Cesar Chavez Day'], [lastDow(y, 4, 1), 'Memorial Day'], [obs(new Date(y, 5, 19)), 'Juneteenth'], [obs(new Date(y, 6, 4)), 'Independence Day'],
      [nthDow(y, 8, 1, 1), 'Labor Day'], [nthDow(y, 8, 5, 4), 'Native American Day'], [obs(new Date(y, 10, 11)), 'Veterans Day'], [tg, 'Thanksgiving'], [addDays(tg, 1), 'Day after Thanksgiving'], [obs(new Date(y, 11, 25)), 'Christmas']]);
  }
  var FEDH = {};
  function fedHolidays(y) {
    if (FEDH[y]) return FEDH[y];
    return (FEDH[y] = [[obs(new Date(y, 0, 1)), "New Year's Day"], [nthDow(y, 0, 1, 3), 'MLK Day'], [nthDow(y, 1, 1, 3), "Washington's Birthday"], [lastDow(y, 4, 1), 'Memorial Day'], [obs(new Date(y, 5, 19)), 'Juneteenth'],
      [obs(new Date(y, 6, 4)), 'Independence Day'], [nthDow(y, 8, 1, 1), 'Labor Day'], [nthDow(y, 9, 1, 2), 'Columbus Day'], [obs(new Date(y, 10, 11)), 'Veterans Day'], [nthDow(y, 10, 4, 4), 'Thanksgiving'], [obs(new Date(y, 11, 25)), 'Christmas']]);
  }
  // FED = federal case. Our deadlines roll BACK over both federal and California holidays (safe: never later than the real date).
  var FED = false;
  function holiday(d) {
    if (isNaN(d)) throw new Error('Bad date.');
    var lists = [holidays(d.getFullYear()), holidays(d.getFullYear() + 1)]; if (FED) lists.push(fedHolidays(d.getFullYear()), fedHolidays(d.getFullYear() + 1));
    for (var j = 0; j < lists.length; j++) for (var i = 0; i < lists[j].length; i++) if (same(lists[j][i][0], d)) return lists[j][i][1];
    return null;
  }
  function courtDay(d) { return d.getDay() !== 0 && d.getDay() !== 6 && !holiday(d); }
  function roll(d, fwd) { var x = new Date(d), moved = []; while (!courtDay(x)) { moved.push(holiday(x) || (x.getDay() === 0 ? 'Sunday' : 'Saturday')); x = addDays(x, fwd ? 1 : -1); } return { d: x, why: moved[0] || '' }; }
  function addCourtDays(d, n) { var x = new Date(d); while (n > 0) { x = addDays(x, 1); if (courtDay(x)) n--; } return x; }
  // service-method extension (CCP 1010.6 e-service +2 court days; 1013 mail +5 days in CA; overnight/fax +2 court days)
  var METHODS = { electronic: ['E-service', 'court', 2], mail: ['Mail (in CA)', 'cal', 5], overnight: ['Overnight / express', 'court', 2], fax: ['Fax', 'court', 2], personal: ['Personal delivery', 'cal', 0] };
  // federal: FRCP 6(d) +3 days for mail and other consented means (fax, overnight); e-service and personal get nothing
  var METHODS_FED = { electronic: ['E-service', 'cal', 0], mail: ['Mail', 'cal', 3], overnight: ['Overnight / express', 'cal', 3], fax: ['Fax', 'cal', 3], personal: ['Personal delivery', 'cal', 0] };
  function extend(d, method) { var m = (FED ? METHODS_FED : METHODS)[method]; if (!m || !m[2]) return { d: d, note: '' }; return { d: m[1] === 'court' ? addCourtDays(d, m[2]) : addDays(d, m[2]), note: '+' + m[2] + (m[1] === 'court' ? ' court days' : ' days') + ' (' + m[0].toLowerCase() + (FED ? ', FRCP 6(d)' : '') + ')' }; }

  // ---------- CasePeer I/O ----------
  function getJSON(u) {
    return fetch(u, { credentials: 'include' }).then(function (r) {
      if (!r.ok) throw new Error(r.status === 403 ? 'Your CasePeer login is not allowed to open this. Ask Moises.' : 'CasePeer error (HTTP ' + r.status + ').');
      return r.text().then(function (t) {
        try { return JSON.parse(t); } catch (e) {
          if (/litigation-management/.test(u)) throw new Error('Your CasePeer login can\'t open Litigation Management, so All cases can\'t load. Ask Moises to turn it on for you. This case still works.');
          throw new Error('CasePeer sent back a page instead of data. Are you still logged in? Reload CasePeer and try again.');
        }
      });
    });
  }
  function getDoc(u) { return fetch(u, { credentials: 'include' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u); return r.text(); }).then(function (h) { return new DOMParser().parseFromString(h, 'text/html'); }); }
  function csrf() { var m = document.cookie.match(/csrftoken=([^;]+)/); return m ? m[1] : ''; }
  function postForm(url, fd) {
    return fetch(url, { method: 'POST', credentials: 'include', body: fd, headers: { 'X-CSRFToken': csrf() } }).then(function (r) {
      return r.text().then(function (t) {
        if (!r.ok) throw new Error('CasePeer did not save (HTTP ' + r.status + ').');
        var d = new DOMParser().parseFromString(t, 'text/html');
        var errs = [].slice.call(d.querySelectorAll('.errorlist li, .has-error .help-block, .alert-danger')).map(function (e) { return e.textContent.trim(); }).filter(Boolean);
        if (errs.length) throw new Error('CasePeer said: ' + errs.join('; '));
      });
    });
  }
  var LIT = null;
  function litAll(fresh) {
    if (LIT && !fresh) return Promise.resolve(LIT); var all = [], page = 1;
    function next() { return getJSON('/api/v1/case/litigation/?page=' + page + '&page_size=200').then(function (r) { all = all.concat(r.results || []); if (r.next) { page++; return next(); } LIT = all; return all; }); }
    return next();
  }
  function events(cid) { return getJSON('/api/v1/case/litigation-tab/events/' + cid + '/?page_size=500').then(function (r) { return r.results || []; }); }
  function tasksAll(cid) {
    function one(k) { return getJSON('/api/v1/case/case-tasks/' + k + '/' + cid + '/?page_size=500').then(function (r) { return r.results || []; }).catch(function () { return []; }); }
    return Promise.all([one('open'), one('completed')]).then(function (a) { return a[0].concat(a[1]); });
  }
  function taskText(t) { var d = document.createElement('div'); d.innerHTML = t.task || ''; return d.textContent.replace(/\s+/g, ' ').trim(); }
  function rules(cid, plan) { return getJSON('/case/' + cid + '/litigation/all-event-rules/' + plan + '/'); }
  function docs(cid) {
    var out = [];
    function walk(fid, path, depth) {
      return getJSON('/api/v1/case/case-documents/' + cid + '/?page_size=300' + (fid ? '&folder_id=' + fid : '')).then(function (r) {
        var s = Promise.resolve();
        (r.results || []).forEach(function (x) {
          if (x.file_type === 'Folder') { if (depth > 0 && (fid || /litigation/i.test(x.docname))) s = s.then(function () { return walk(x.id, path + '/' + x.docname, depth - 1); }); }
          else if (fid && /pdf/i.test(x.file_type || x.extension || '')) out.push({ id: x.id, name: x.docname, path: path.replace(/^\/Litigation/, ''), created: x.created, url: x.docfile, by: x.uploader });
        });
        return s;
      });
    }
    return walk(null, '', 3).then(function () { out.sort(function (a, b) { return (pd(b.created) || 0) - (pd(a.created) || 0) || b.id - a.id; }); return out; });
  }
  // ----- unfiled documents, folders, categories, rename, move -----
  function topDocs(cid) {
    return getJSON('/api/v1/case/case-documents/' + cid + '/?page_size=300').then(function (r) {
      return (r.results || []).filter(function (x) { return x.file_type !== 'Folder'; }).map(function (x) {
        return { id: x.id, name: x.docname, created: x.created || '', url: x.docfile, by: x.uploader, ext: x.extension || '', pdf: /pdf/i.test((x.file_type || '') + ' ' + (x.extension || '') + ' ' + x.docname) };
      }).sort(function (a, b) { return (pd(b.created) || 0) - (pd(a.created) || 0) || b.id - a.id; });
    });
  }
  function folderList(cid) {
    return getJSON('/api/v1/case/case-documents/folders/' + cid + '/').then(function (r) {
      var by = {}; (r || []).forEach(function (f) { by[f.id] = f; });
      function path(f, n) { var p = by[f.parentId]; return (p && n < 8 ? path(p, n + 1) + ' › ' : '') + f.docname; }
      return (r || []).map(function (f) { return { id: f.id, path: path(f, 0) }; }).sort(function (a, b) { return a.path.localeCompare(b.path); });
    });
  }
  var CATS = null;
  function catList(cid) {
    if (CATS) return Promise.resolve(CATS);
    return getDoc('/case/' + cid + '/documents/2/sort/0/').then(function (d) {
      var seen = {}; CATS = [].slice.call(d.querySelectorAll('a[href*="/documents/2/sort/"]')).map(function (a) { var m = a.getAttribute('href').match(/\/sort\/(\d+)\//); return m && +m[1] ? { id: +m[1], name: a.textContent.trim() } : null; })
        .filter(function (x) { if (!x || !x.name || seen[x.id]) return false; seen[x.id] = 1; return true; });
      return CATS;
    }).catch(function () { CATS = []; return CATS; });
  }
  function sendJSON(method, url, body) {
    return fetch(url, { method: method, credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() }, body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) throw new Error('CasePeer did not save (HTTP ' + r.status + ').'); return r; });
  }
  function ids(a) { return (a || []).map(function (x) { return x && typeof x === 'object' ? (x.value != null ? x.value : x.id) : x; }); }
  // same save CasePeer's own "Edit Document" dialog uses; keeps tabs, reviewers and description as they are
  function renameDoc(docId, newName, catId) {
    var url = '/version-document/edit/' + docId + '/';
    return getJSON(url).then(function (cur) {
      var cats = ids(cur.custom_categories); if (catId && cats.indexOf(catId) < 0) cats.push(catId);
      return sendJSON('PATCH', url, { case_tabs: ids(cur.case_tabs), custom_categories: cats, reviewers: ids(cur.reviewers), docname: newName, description: cur.description || '' });
    }).then(function () { return getJSON(url); }).then(function (now) {
      if (now.docname !== newName) throw new Error('The new name did not stick.');
      if (catId && ids(now.custom_categories).indexOf(catId) < 0) throw new Error('Renamed, but the category did not stick.');
    });
  }
  // same save CasePeer's own "Move To" dialog uses
  function moveDoc(cid, docId, folderId) {
    var url = '/api/v1/case/case-documents/action/' + cid + '/move-to-folder/' + folderId + '/', inner = { rows_selected: [docId], folder_id: folderId };
    return sendJSON('PATCH', url, { data: inner }).catch(function () { return sendJSON('PATCH', url, inner); })
      .then(function () { return getJSON('/api/v1/case/case-documents/' + cid + '/?page_size=300&folder_id=' + folderId); })
      .then(function (r) { if (!(r.results || []).some(function (x) { return x.id === docId; })) throw new Error('The document is not in the new folder.'); });
  }
  // "Nothing to calendar": a note on the document itself, so it drops off the new list for everyone
  var NOTHING = /KAL Lit: nothing to calendar/i;
  function markNothing(docId) {
    var url = '/version-document/edit/' + docId + '/';
    return getJSON(url).then(function (cur) {
      if (NOTHING.test(cur.description || '')) return;
      var desc = ((cur.description || '') + ' KAL Lit: nothing to calendar ' + fmt(today()) + '.').trim();
      return sendJSON('PATCH', url, { case_tabs: ids(cur.case_tabs), custom_categories: ids(cur.custom_categories), reviewers: ids(cur.reviewers), docname: cur.docname, description: desc })
        .then(function () { return getJSON(url); }).then(function (now) { if (!NOTHING.test(now.description || '')) throw new Error('The note did not stick.'); });
    });
  }
  function markedIn(list) {
    var out = {};
    return pool(list, 4, function (d) { return getJSON('/version-document/edit/' + d.id + '/').then(function (x) { if (NOTHING.test(x.description || '')) out[d.id] = 1; }); }).then(function () { return out; });
  }
  var PDFJS = null;
  function pdfjs() {
    if (PDFJS) return Promise.resolve(PDFJS); var base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/';
    return import(base + 'pdf.min.mjs').then(function (m) { return fetch(base + 'pdf.worker.min.mjs').then(function (r) { return r.text(); }).then(function (w) { m.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([w], { type: 'text/javascript' })); PDFJS = m; return m; }); });
  }
  function pdfPages(url) {
    return pdfjs().then(function (lib) { return fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (b) { return lib.getDocument({ data: b }).promise; }); }).then(function (doc) {
      var n = doc.numPages, idx = []; for (var p = 1; p <= n; p++) if (p <= 4 || p > n - 4) idx.push(p);
      return Promise.all(idx.map(function (p) { return doc.getPage(p).then(function (pg) { return pg.getTextContent(); }).then(function (tc) { return tc.items.map(function (i) { return i.str; }).join(' '); }); }));
    });
  }
  var FIRMS = null; // [{id,name}]
  function firmList(cid, anyDef) {
    if (FIRMS) return Promise.resolve(FIRMS); if (!anyDef) return Promise.resolve([]);
    return getDoc('/case/' + cid + '/defendant/' + anyDef + '/legal/').then(function (d) { var s = d.querySelector('select[name=counsel_law_firm]'); FIRMS = s ? [].slice.call(s.options).filter(function (o) { return o.value; }).map(function (o) { return { id: o.value, name: o.text.trim() }; }) : []; return FIRMS; }).catch(function () { return []; });
  }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function bestMatch(text, items, nameOf) {
    var t = ' ' + norm(text) + ' ', best = null, score = 0;
    items.forEach(function (it) {
      var words = norm(nameOf(it)).split(' ').filter(function (w) { return w.length > 2 && !/^(inc|llc|the|and|dba|corp|llp|apc|law|office|offices)$/.test(w); });
      if (!words.length) return; var hit = words.filter(function (w) { return t.indexOf(' ' + w + ' ') >= 0; }).length; var s = hit / words.length;
      if (s > score) { score = s; best = it; }
    });
    return score >= 0.5 ? best : null;
  }

  // ---------- rulebook ----------
  var PLAN = { complaint: 11870, respIn: 11873, respInLA: 11874, served: 11871, discOut: 11872, cmc: 11875, tsc: 11876, trialInit: 11877, trialCur: 11878, trialCurOC: 11879, msj: 11880, mediation: 11881, answerOC: 11882, fscLA: 11883, mscRiv: 11884 };
  var TYPE = { deadline: 26, discovery: 5, cmc: 2, tsc: 23, trial: 21, mediation: 11, msc: 10, fsc: 35, hearing: 8, msj: 17, mc: 12 };
  function theirs(desc) { return /answer due|responses due|^defendant/i.test(desc); }
  // Discovery served on us (no CasePeer plan; built in)
  function discOnUsRules(f) {
    var label = f.what + (f.set ? ', Set ' + f.set : '') + (f.from ? ' (' + f.from + ')' : '');
    var rfa = /admission/i.test(f.what);
    return [
      { key: 'due', desc: 'LAST DAY: serve responses to ' + label + (rfa ? ' — RFAs are deemed admitted if late' : ''), days: 30, ext: true, side: 'ours', type: TYPE.discovery }
    ];
  }
  function compute(ruleList, trigger, method) {
    var done = {};
    return ruleList.map(function (r) {
      var base, notes = [];
      if (r.from) base = addDays(done[r.from], r.off);
      else if (typeof r.days !== 'number') throw new Error('Rule has no day count: ' + r.desc);
      else { base = addDays(trigger, (r.before ? -1 : 1) * r.days); if (r.ext) { var e = extend(base, method); base = e.d; if (e.note) notes.push(e.note); } }
      var fwd = !r.before && !r.from && (r.side === 'theirs');
      var rr = roll(base, fwd); if (rr.why) notes.push(rr.why + ' → moved ' + (fwd ? 'forward' : 'back'));
      done[r.key || r.desc] = rr.d;
      return { desc: r.desc, date: rr.d, type: r.type || TYPE.deadline, notes: notes, rid: r.id };
    });
  }
  function planRules(cid, planId, extAll) {
    return rules(cid, planId).then(function (rs) {
      return rs.map(function (r) { return { id: r.id, key: 'r' + r.id, desc: r.description, days: r.days_to_trigger, before: r.before_trigger_event, ext: !!extAll && !r.before_trigger_event, side: theirs(r.description) ? 'theirs' : 'ours', type: TYPE.deadline }; });
    });
  }

  // ---------- UI ----------
  var css = '#kl-root{position:fixed;top:0;right:0;width:min(780px,100vw);height:100vh;background:#fff;color:#111;z-index:2147483000;box-shadow:-6px 0 24px rgba(0,0,0,.25);font:14px/1.45 -apple-system,Segoe UI,Arial,sans-serif;display:flex;flex-direction:column}' +
    '#kl-root *{box-sizing:border-box}.kl-hd{background:#000;color:#fff;padding:12px 16px;display:flex;align-items:center;gap:10px}.kl-hd b{color:#C9A24A;font-size:16px}.kl-hd .v{color:#aaa;font-size:12px}.kl-x{margin-left:auto;background:none;border:0;color:#fff;font-size:22px;cursor:pointer}' +
    '.kl-tabs{display:flex;border-bottom:1px solid #ddd;background:#f6f6f6}.kl-tabs button{flex:1;padding:10px;border:0;background:none;font-weight:600;cursor:pointer;color:#555}.kl-tabs button.on{background:#fff;color:#000;border-bottom:3px solid #C9A24A}' +
    '.kl-body{flex:1;overflow:auto;padding:16px}.kl-h{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#666;margin:18px 0 8px;font-weight:700}' +
    '.kl-t{width:100%;border-collapse:collapse;font-size:13px}.kl-t th{text-align:left;background:#f5f5f5;padding:6px}.kl-t td{padding:6px;border-top:1px solid #eee;vertical-align:top}' +
    '.kl-btn{background:#000;color:#fff;border:0;border-radius:6px;padding:8px 13px;font-weight:600;cursor:pointer;margin:4px 6px 4px 0}.kl-btn.gold{background:#C9A24A;color:#000}.kl-btn.ghost{background:#fff;color:#000;border:1px solid #999}.kl-btn:disabled{opacity:.4;cursor:default}' +
    '.kl-pill{display:inline-block;padding:1px 7px;border-radius:10px;font-size:12px;font-weight:600}.p-ok{background:#e6f4ea;color:#0a7d3b}.p-warn{background:#fff3cd;color:#8a6100}.p-bad{background:#fdecea;color:#b00020}.p-mute{background:#eee;color:#555}' +
    '.kl-note{background:#fff8e1;border:1px solid #e5c67a;border-radius:6px;padding:9px;margin:8px 0}.kl-err{background:#fdecea;border:1px solid #f5c2c0;border-radius:6px;padding:9px;margin:8px 0}.kl-ok{color:#0a7d3b;font-weight:600}.kl-bad{color:#b00020;font-weight:600}.kl-mute{color:#777;font-size:12px}' +
    '.kl-box{border:2px solid #C9A24A;border-radius:10px;padding:12px}.kl-grid{display:grid;grid-template-columns:150px 1fr;gap:6px 10px;align-items:center;margin:8px 0}.kl-grid input,.kl-grid select{padding:5px;border:1px solid #bbb;border-radius:5px;font-size:13px;width:100%}' +
    '.kl-row{display:flex;gap:10px;align-items:center;padding:8px 10px;border-top:1px solid #eee}.kl-row:first-child{border-top:0}.kl-list{border:1px solid #e3e3e3;border-radius:8px}' +
    '.kl-in{cursor:pointer}.kl-in:hover{background:#faf6ea}.kl-in.sel{background:#fff3cd}.kl-arrow{width:14px;color:#8a6100;font-weight:700}' +
    '.kl-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-bottom:10px}.kl-st{text-align:center;padding:6px;border-radius:6px;background:#f1f1f1;color:#777;font-size:13px;font-weight:600}.kl-st.on{background:#000;color:#fff}.kl-st.dn{background:#e6f4ea;color:#0a7d3b}' +
    '.kl-ins{background:#f6f6f6;border-radius:6px;padding:8px 10px;margin:0 0 8px}.kl-top{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px}';
  var root = document.createElement('div'); root.id = 'kl-root';
  root.innerHTML = '<style>' + css + '</style><div class="kl-hd"><img alt="KAL" style="height:26px;display:block" src="data:image/png;base64,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"><b>Lit</b><span class="v">' + VERSION + '</span><button class="kl-x" title="Close">×</button></div>' +
    '<div class="kl-tabs"><button data-t="case">This case</button><button data-t="all">All cases</button></div><div class="kl-body"></div>';
  document.body.appendChild(root);
  var body = root.querySelector('.kl-body');
  root.querySelector('.kl-x').onclick = function () { root.remove(); };
  function esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function tab(t) { root.querySelectorAll('.kl-tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.t === t); }); (t === 'case' ? showCase : showAll)(); }
  root.querySelectorAll('.kl-tabs button').forEach(function (b) { b.onclick = function () { tab(b.dataset.t); }; });
  var CID = (location.pathname.match(/\/case\/(\d+)/) || [])[1];

  // ===== All cases =====
  var CLOSED = /disbursed|settled|subbed out|dropped|closed|referred accepted/i;
  function openEvents() { return getJSON('/api/v1/case/litigation-management/open-and-pending/?page_size=2000').then(function (r) { return r.results || []; }); }
  function pool(items, n, fn, prog) {
    var i = 0, done = 0, out = [];
    function next() { if (i >= items.length) return Promise.resolve(); var k = i++; return fn(items[k]).then(function (r) { out[k] = r; }, function () { out[k] = null; }).then(function () { done++; if (prog) prog(done, items.length); return next(); }); }
    var ws = []; for (var w = 0; w < n; w++) ws.push(next());
    return Promise.all(ws).then(function () { return out; });
  }
  function caseLink(cid, name) { return '<a href="/case/' + cid + '/litigation/" target="_top" style="color:#000;font-weight:600">' + esc(String(name || '').split(' - ')[0]) + '</a>'; }
  var ALL = {};
  var PLANR = null;
  var ANCH = [{ pid: PLAN.cmc, nm: 'The CMC', re: /case management/i }, { pid: PLAN.tsc, nm: 'The TSC', re: /trial setting/i }, { pid: 'trial', nm: 'Trial', re: /^trial$/i }, { pid: PLAN.mediation, nm: 'Mediation', re: /mediation/i }, { pid: PLAN.fscLA, nm: 'The FSC', re: /final status/i }, { pid: PLAN.mscRiv, nm: 'The MSC', re: /mandatory settlement/i }];
  function planBook(ev) {
    if (PLANR || !ev.length) return Promise.resolve(); var cid = ev[0].case.id, ids = [11870, 11871, 11872, 11873, 11874, 11875, 11876, 11877, 11878, 11879, 11880, 11881, 11882, 11883, 11884], out = {};
    return Promise.all(ids.map(function (p) { return rules(cid, p).then(function (r) { out[p] = r; }, function () { out[p] = []; }); })).then(function () { PLANR = out; });
  }
  function showAll() {
    if (FROM_ALL) { CID = PAGE_CID; FROM_ALL = false; }
    if (ALL.probs) return renderAll();
    body.innerHTML = 'Loading all cases…';
    Promise.all([litAll(), openEvents()]).then(function (r) { return planBook(r[1]).then(function () { return r; }); }).then(function (r) {
      ALL.lit = r[0]; ALL.ev = r[1];
      var t = today(), wk = addDays(t, 7), byCase = {}, fedCase = {};
      ALL.lit.forEach(function (c) { if (/\d:\d{2}-cv-\d+/i.test(c.courtcasenumber || '')) fedCase[c.case_id] = 1; });
      ALL.ev.forEach(function (e) { (byCase[e.case.id] = byCase[e.case.id] || []).push(e); });
      // next 7 days
      var next7 = ALL.ev.filter(function (e) { var d = evDate(e); return d && d >= t && d <= wk && /^LAST DAY/i.test(e.description || ''); }).sort(function (a, b) { return evDate(a) - evDate(b); });
      // problems
      var probs = [];
      ALL.ev.forEach(function (e) {
        var d = evDate(e); if (!d) return; var desc = e.description || '';
        FED = !!fedCase[e.case.id]; var h = holiday(d);
        var isDeadline = /^(LAST DAY|ALERT|Reminder|Post |Task)/i.test(desc) || /\bdue\b|deadline/i.test(desc);
        if (d >= t && !courtDay(d) && isDeadline) {
          var fw = theirs(desc), to = roll(d, fw).d, why = h || (d.getDay() === 0 ? 'a Sunday' : 'a Saturday');
          probs.push({ k: 'p-warn', l: h ? 'Holiday' : 'Weekend', act: 'fix', e: e, to: to, cid: e.case.id, name: e.case._casename, d: d, txt: desc + ' — ' + fmt(d) + ' is ' + why + '. Courts are closed. Move it to ' + fmt(to) + (fw ? ' (their deadline, so the later day is the safe one).' : '.') });
        }
        if (d < t && d >= addDays(t, -90) && /^LAST DAY/i.test(desc) && !/MISSED/.test(e.event_status_text || '')) probs.push({ k: 'p-bad', l: 'Past due', act: 'past', e: e, cid: e.case.id, name: e.case._casename, d: d, txt: desc + ' — was ' + fmt(d) + ', still open. Done or missed?' });
      });
      ALL.lit.forEach(function (c) {
        if (CLOSED.test(c.casestatus_name || '')) return;
        var evs = byCase[c.case_id] || [], hasDS = evs.some(function (e) { return /answer due|request default/i.test(e.description || ''); });
        (c.case_defendants || []).forEach(function (d) {
          if (d.served_date && !d.answered_date && !hasDS && fromIso(d.served_date) >= addDays(t, -120)) probs.push({ k: 'p-bad', l: 'Missing', act: fedCase[c.case_id] ? '' : 'missing', def: d, cid: c.case_id, name: c._casename, d: fromIso(d.served_date), txt: d.defendant_name + ' served ' + fmt(fromIso(d.served_date)) + ', no answer yet, and no answer-due or default deadline on the calendar.' });
        });
      });
      // hearings that moved, and hearings with no deadlines
      ALL.lit.forEach(function (c) {
        if (CLOSED.test(c.casestatus_name || '')) return; var evs = byCase[c.case_id] || []; if (!evs.length) return;
        var oc = /orange/i.test(c.court_contact_county || '');
        ANCH.forEach(function (a) {
          var pid = a.pid === 'trial' ? (oc ? PLAN.trialCurOC : PLAN.trialCur) : a.pid, rules = PLANR[pid] || []; if (!rules.length) return;
          var anchors = evs.filter(function (e) { var d = evDate(e); return d && d >= t && a.re.test(e.litigation_event_type || '') && !/^(reminder|last day|alert|task|post)/i.test(e.description || ''); }).sort(function (x, y) { return evDate(x) - evDate(y); });
          if (!anchors.length) return; var an = evDate(anchors[0]);
          var pe = evs.map(function (e) { return { e: e, r: rules.filter(function (r) { return r.description === e.description; })[0] }; }).filter(function (x) { return x.r; });
          if (!pe.length) { probs.push({ k: 'p-bad', l: 'No deadlines', act: fedCase[c.case_id] ? '' : 'addplan', pid: pid, an: an, cid: c.case_id, name: c._casename, d: an, txt: a.nm + ' is on ' + fmt(an) + ', but none of its deadlines are on the calendar.' }); return; }
          var trigs = pe.map(function (x) { return addDays(evDate(x.e), (x.r.before_trigger_event ? 1 : -1) * x.r.days_to_trigger); });
          var near = anchors.some(function (an2) { return trigs.some(function (tg) { return Math.abs(evDate(an2) - tg) <= 3 * 864e5; }); });
          if (!near) { var oldT = new Date(Math.max.apply(null, trigs)); probs.push({ k: 'p-bad', l: 'Moved', act: fedCase[c.case_id] ? '' : 'moveall', pid: pid, an: an, pe: pe, cid: c.case_id, name: c._casename, d: an, txt: a.nm + ' is now ' + fmt(an) + ', but its ' + pe.length + ' deadlines are still based on ' + fmt(oldT) + '.' }); }
        });
      });
      ALL.byCase = byCase; ALL.fedCase = fedCase;
      FED = false;
      probs.sort(function (a, b) { return a.d - b.d; });
      ALL.next7 = next7; ALL.probs = probs;
      renderAll();
    }).catch(function (e) { body.innerHTML = '<div class="kl-err">' + esc(e.message) + '</div>'; });
  }
  function renderAll() {
    var n7 = ALL.next7, pr = ALL.probs, nd = ALL.docs;
    if (nd) { var dn = {}; ALL.ev.forEach(function (e) { var m = String(e.event_status_text || '').match(/doc (\d+)/); if (m) dn[m[1]] = 1; }); nd = ALL.docs = nd.filter(function (d) { return !dn[d.id]; }); }
    body.innerHTML = '<div style="text-align:right"><button class="kl-btn ghost" id="kl-refresh" style="padding:4px 10px;font-size:12px">Refresh</button></div><div style="display:flex;gap:10px;margin-bottom:6px">' +
      [[nd ? nd.length : '—', 'new documents'], [pr.length, 'problems'], [n7.length, 'LAST DAYs in next 7 days']].map(function (x) { return '<div style="flex:1;border:1px solid #e3e3e3;border-radius:8px;padding:10px"><div style="font-size:22px;font-weight:700">' + x[0] + '</div><div class="kl-mute">' + x[1] + '</div></div>'; }).join('') + '</div>' +
      '<div class="kl-h">1 · New documents</div><div id="kl-nd">' + (nd ? docTable(nd) : '<div class="kl-mute">PDFs uploaded to Litigation folders in the last ' + NEW_DAYS + ' days that are not calendared yet. Checking every case takes about a minute.</div><button class="kl-btn" id="kl-scan">Find new documents</button>') + '</div>' +
      '<div class="kl-h">2 · Problems (' + pr.length + ')</div>' + (pr.length ? '<div class="kl-list">' + pr.map(function (p, i) {
        var b = p.act === 'fix' ? '<button class="kl-btn gold" data-pa="fix" data-i="' + i + '">Fix</button>' : p.act === 'past' ? '<button class="kl-btn" data-pa="done" data-i="' + i + '">Done</button><button class="kl-btn ghost" data-pa="missed" data-i="' + i + '">Missed</button>' : p.act === 'missing' ? '<button class="kl-btn gold" data-pa="missing" data-i="' + i + '">Add deadlines</button>' : p.act === 'moveall' ? '<button class="kl-btn gold" data-pa="moveall" data-i="' + i + '">Move all</button>' : p.act === 'addplan' ? '<button class="kl-btn gold" data-pa="addplan" data-i="' + i + '">Add deadlines</button>' : p.act === 'check' ? '<span class="kl-mute">Check by hand</span>' : '<span class="kl-mute">Federal — do this by hand</span>';
        return '<div class="kl-row"><span class="kl-pill ' + p.k + '">' + p.l + '</span><div style="flex:1">' + caseLink(p.cid, p.name) + ' — ' + esc(p.txt) + '<div class="kl-res" id="kl-pr-' + i + '"></div></div><div style="white-space:nowrap">' + b + '</div></div>'; }).join('') + '</div>' : '<div class="kl-mute">Nothing found.</div>') +
      '<div id="kl-dc" style="margin-top:8px">' + (ALL.discChecked ? '' : '<div class="kl-mute">Old discovery deadlines entered by hand: I can read the discovery PDFs and check if any date is later than the earliest possible due date. Takes a few minutes.</div><button class="kl-btn ghost" id="kl-dcb">Check old discovery dates</button>') + '</div>' +
      '<div class="kl-h">3 · LAST DAY — next 7 days (' + n7.length + ')</div>' + (n7.length ? '<table class="kl-t"><tr><th style="width:96px">Date</th><th>Case</th><th>Deadline</th><th></th></tr>' + n7.map(function (e, i) { return '<tr><td style="font-weight:700;color:#b00020">' + fmt(evDate(e)) + '</td><td>' + caseLink(e.case.id, e.case._casename) + '</td><td>' + esc(e.description) + '<div class="kl-res" id="kl-n7-' + i + '"></div></td><td><button class="kl-btn" data-na="done" data-i="' + i + '">Done</button></td></tr>'; }).join('') + '</table>' : '<div class="kl-mute">None.</div>');
    var sb = body.querySelector('#kl-scan'); if (sb) sb.onclick = scanDocs;
    body.querySelectorAll('[data-rd]').forEach(function (a) { a.onclick = function () { var d = ALL.docs[+a.dataset.rd]; jumpToCase(d.cid, function () { readDoc(d.id); }); }; });
    body.querySelectorAll('[data-pa]').forEach(function (b) { b.onclick = function () { probAction(b.dataset.pa, +b.dataset.i, b); }; });
    body.querySelectorAll('[data-na]').forEach(function (b) { b.onclick = function () { var e = ALL.next7[+b.dataset.i]; runAct(b, '#kl-n7-' + b.dataset.i, function () { return markDone(e.case.id, e.id).then(function () { return 'Marked complete and confirmed.'; }); }); }; });
    var dcb = body.querySelector('#kl-dcb'); if (dcb) dcb.onclick = checkDisc;
    var rf = body.querySelector('#kl-refresh'); if (rf) rf.onclick = function () { ALL = {}; showAll(); };
  }
  var ABUSY = false;
  function runAct(btn, resSel, fn) {
    if (ABUSY) return; ABUSY = true; var row = btn.parentNode; var res = body.querySelector(resSel);
    row.querySelectorAll('button').forEach(function (x) { x.disabled = true; }); res.innerHTML = '<span class="kl-mute">Working…</span>';
    fn().then(function (msg) { res.innerHTML = '<span class="kl-ok">✓ ' + esc(msg) + '</span>'; row.innerHTML = ''; }, function (e) { res.innerHTML = '<span class="kl-bad">✗ ' + esc(e.message) + '</span>'; row.querySelectorAll('button').forEach(function (x) { x.disabled = false; }); })
      .then(function () { ABUSY = false; });
  }
  function planPreview(p) {
    // returns [{e?, desc, from?, to, skip?}] for moveall/addplan
    FED = false;
    if (p.act === 'moveall') return Promise.resolve(p.pe.map(function (x) {
      var raw = addDays(p.an, (x.r.before_trigger_event ? -1 : 1) * x.r.days_to_trigger), to = roll(raw, !x.r.before_trigger_event && theirs(x.r.description)).d, from = evDate(x.e);
      return { e: x.e, desc: x.e.description, from: from, to: to, skip: same(from, to) ? 'already right' : to < today() ? 'new date has passed — check by hand' : '' };
    }));
    return planRules(p.cid, p.pid, false).then(function (rl) { return compute(rl, p.an, '').map(function (x) { return { desc: x.desc, to: x.date, type: x.type, skip: x.date < today() ? 'date has passed' : '' }; }); });
  }
  function probAction(a, i, btn) {
    var p = ALL.probs[i], sel = '#kl-pr-' + i;
    if (a === 'moveall' || a === 'addplan') {
      var res = body.querySelector(sel); if (res.dataset.open) { res.innerHTML = ''; delete res.dataset.open; return; }
      res.dataset.open = '1'; res.innerHTML = '<span class="kl-mute">Working out the dates…</span>';
      return planPreview(p).then(function (list) {
        p.list = list;
        res.innerHTML = '<table class="kl-t" style="margin-top:6px"><tr><th>' + (a === 'moveall' ? 'Now' : '') + '</th><th>New date</th><th>Deadline</th></tr>' + list.map(function (x) { return '<tr><td>' + (x.from ? fmt(x.from) : '') + '</td><td style="font-weight:700">' + fmt(x.to) + '</td><td>' + esc(x.desc) + (x.skip ? '<div class="kl-mute">Skipped: ' + esc(x.skip) + '</div>' : '') + '</td></tr>'; }).join('') + '</table><button class="kl-btn gold" data-cf="' + i + '">Confirm</button>';
        res.querySelector('[data-cf]').onclick = function () { confirmPlan(p, i, this); };
      }, function (e) { res.innerHTML = '<span class="kl-bad">✗ ' + esc(e.message) + '</span>'; });
    }
    if (a === 'missing') return jumpToCase(p.cid, function () { factsForm({ kind: 'summons_pos', method: 'personal', personalDate: fromIso(p.def.served_date), party: p.def.defendant_name }, null); });
    if (a === 'fix') return runAct(btn, sel, function () { return moveEvent(p.cid, p.e.id, p.to, p.note || ('Moved from ' + fmt(p.d) + ' (courts closed that day) by KAL Lit ' + fmt(today()) + '.')).then(function () { return 'Moved to ' + fmt(p.to) + '. Checked.'; }); });
    if (a === 'done') return runAct(btn, sel, function () { return markDone(p.cid, p.e.id).then(function () { return 'Marked complete and confirmed.'; }); });
    if (a === 'missed') return runAct(btn, sel, function () {
      var c = ALL.lit.filter(function (k) { return k.case_id === p.cid; })[0] || {};
      return userIdByName(p.cid, c.litigation_attorney || c.lead_attorney).then(function (uid) {
        var to = [uid || 14839]; var tk = { text: 'MISSED DEADLINE — ' + p.e.description + ' (was ' + fmt(p.d) + '). Review this case now.', due: today(), pri: 4 };
        return saveTask(tk, p.cid, to).then(function () { return tasksAll(p.cid); }).then(function (all) {
          if (!all.some(function (t) { return norm(taskText(t)) === norm(tk.text); })) throw new Error('Task not found after saving.');
          return setNote(p.cid, p.e.id, 'MISSED — flagged by KAL Lit ' + fmt(today()) + '.');
        }).then(function () { return 'Urgent task sent to ' + ((USERS || []).filter(function (u) { return u.id === to[0]; })[0] || { name: 'Kevin' }).name + ' and confirmed.'; });
      });
    });
  }
  function confirmPlan(p, i, btn) {
    if (ABUSY) return; ABUSY = true; btn.disabled = true; var res = body.querySelector('#kl-pr-' + i), log = [], seq = Promise.resolve();
    var todo = p.list.filter(function (x) { return !x.skip; });
    var stamp = 'KAL Lit ' + VERSION + ' ' + fmt(today()) + '.';
    todo.forEach(function (x) {
      seq = seq.then(function () {
        if (p.act === 'moveall') return moveEvent(p.cid, x.e.id, x.to, 'Moved from ' + fmt(x.from) + ' because the hearing moved to ' + fmt(p.an) + '. ' + stamp).then(function () { log.push(['ok', fmt(x.to) + ' ' + x.desc]); });
        return saveEvent({ type: x.type || TYPE.deadline, desc: x.desc, date: x.to }, getAssignees(), 'Added from the hearing on ' + fmt(p.an) + '. ' + stamp, p.cid).then(function () { log.push(['ok', fmt(x.to) + ' ' + x.desc]); });
      }).catch(function (e) { log.push(['bad', x.desc + ' — ' + e.message]); });
    });
    seq.then(function () { return p.act === 'addplan' ? events(p.cid) : null; }).then(function (ev) {
      if (ev) log.forEach(function (l) { if (l[0] !== 'ok') return; var x = todo.filter(function (y) { return l[1] === fmt(y.to) + ' ' + y.desc; })[0]; if (x && !ev.some(function (e) { return norm(e.description) === norm(x.desc) && same(evDate(e), x.to); })) { l[0] = 'bad'; l[1] += ' — NOT found after saving'; } });
    }).then(function () {
      ABUSY = false; var bad = log.filter(function (l) { return l[0] === 'bad'; }).length;
      res.innerHTML = '<div class="' + (bad ? 'kl-err' : 'kl-note') + '">' + (bad ? '<b>' + bad + ' problem(s). Check the case.</b>' : '<span class="kl-ok">All saved and checked.</span>') + '<br>' + log.map(function (l) { return '<span class="' + (l[0] === 'ok' ? 'kl-ok' : 'kl-bad') + '" style="font-weight:400">' + (l[0] === 'ok' ? '✓ ' : '✗ ') + esc(l[1]) + '</span>'; }).join('<br>') + '</div>';
      if (!bad) { var row = res.parentNode.parentNode.querySelector('div[style*="nowrap"]'); if (row) row.innerHTML = ''; }
    });
  }
  // ----- old hand-calendared discovery: find the PDF, use the earliest date
  function discCandidates() {
    var t = today(), planDesc = {}; Object.keys(PLANR || {}).forEach(function (k) { PLANR[k].forEach(function (r) { planDesc[r.description] = 1; }); });
    return ALL.ev.filter(function (e) {
      var d = evDate(e), s = e.description || '';
      return d && d >= t && !planDesc[s] && !/KAL Lit/.test(e.event_status_text || '') && /discovery|interrog|admission|production|\bRFA|\bRFP|SROG|FROG|respons/i.test(s) && !/reminder|motion|compel|cutoff|expert|depo|subpoena|their|from def|defendant'?s responses|responses from/i.test(s);
    });
  }
  function checkDisc() {
    var box = body.querySelector('#kl-dc'), cands = discCandidates();
    if (!cands.length) { box.innerHTML = '<div class="kl-mute">No hand-entered discovery deadlines to check.</div>'; return; }
    var byC = {}; cands.forEach(function (e) { (byC[e.case.id] = byC[e.case.id] || []).push(e); });
    var cids = Object.keys(byC); box.innerHTML = '<div class="kl-note" id="kl-dprog">Reading discovery in 0 of ' + cids.length + ' cases…</div>';
    var found = [];
    pool(cids, 3, function (cid) {
      return docs(cid).then(function (list) {
        var dd = list.filter(function (d) { return /discovery/i.test(d.path) && !/plaintiff propounding|verification|subpoena|depo|expert/i.test(d.path + ' ' + d.name); });
        var evs = byC[cid], minD = new Date(Math.min.apply(null, evs.map(evDate)));
        dd = dd.filter(function (d) { var c = pd(d.created); return c && c >= addDays(minD, -75) && c <= minD; });
        return pool(dd, 2, function (d) { return pdfPages(d.url).then(function (pg) { var f = KLP.read(pg); f.doc = d; return f; }); }).then(function (fs) {
          fs = fs.filter(function (f) { return f && f.kind === 'disc_on_us' && f.served; });
          evs.forEach(function (e) {
            var d = evDate(e); FED = /\d:\d{2}-cv-\d+/i.test(((ALL.lit.filter(function (k) { return String(k.case_id) === String(cid); })[0]) || {}).courtcasenumber || '');
            var m = fs.filter(function (f) { var gap = (d - f.served) / 864e5; return gap >= 28 && gap <= 45; }).sort(function (a, b) { return b.served - a.served; })[0];
            if (!m) { found.push({ k: 'p-warn', l: 'Discovery date', act: 'check', e: e, cid: +cid, name: e.case._casename, d: d, txt: e.description + ' on ' + fmt(d) + ' — I could not find the discovery PDF for this one. Check the date by hand.' }); return; }
            var known = !m.noPos && METHODS[m.method], mname = known ? (FED ? METHODS_FED : METHODS)[m.method][0].toLowerCase() : '';
            var early = roll(known ? extend(addDays(m.served, 30), m.method).d : addDays(m.served, 30), false).d;
            var why = known ? 'It was served ' + fmt(m.served) + ' by ' + mname + ' (' + m.doc.name + '), so the last day is ' + fmt(early) + '.' : 'It was served ' + fmt(m.served) + ' (' + m.doc.name + '). I can\'t tell how it was served, so I used the earliest date: ' + fmt(early) + '.';
            var nt = 'Moved earlier by KAL Lit ' + fmt(today()) + '. ' + why + (known ? '' : ' Check the proof of service.');
            if (d > early) found.push({ k: 'p-bad', l: 'Discovery date', act: 'fix', note: nt, e: e, to: early, cid: +cid, name: e.case._casename, d: d, txt: e.description + ' is on ' + fmt(d) + '. ' + why + ' Move it earlier.' });
          });
          FED = false;
        });
      });
    }, function (i, n) { var p = body.querySelector('#kl-dprog'); if (p) p.textContent = 'Reading discovery in ' + i + ' of ' + n + ' cases…'; }).then(function () {
      ALL.discChecked = true; ALL.probs = ALL.probs.concat(found).sort(function (a, b) { return a.d - b.d; }); renderAll();
    });
  }
  // open a case inside the panel (no page change)
  var PAGE_CID = CID, FROM_ALL = false;
  function jumpToCase(cid, after) { CID = String(cid); FROM_ALL = true; root.querySelectorAll('.kl-tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.t === 'case'); }); showCase(after); }
  function docTable(nd) {
    if (!nd.length) return '<div class="kl-mute">No new PDFs in the last ' + NEW_DAYS + ' days.</div>';
    return '<table class="kl-t"><tr><th style="width:90px">Uploaded</th><th>Case</th><th>Document</th><th></th></tr>' + nd.map(function (d, i) {
      return '<tr><td>' + esc(d.created.split(' ')[0]) + '</td><td>' + caseLink(d.cid, d.cname) + '</td><td>' + esc(d.name) + '<div class="kl-mute">' + esc(d.path.replace(/^\//, '')) + '</div></td><td><button class="kl-btn" data-rd="' + i + '">Read</button></td></tr>';
    }).join('') + '</table>';
  }
  function scanDocs() {
    var box = body.querySelector('#kl-nd'), t = today(), cutoff = addDays(t, -NEW_DAYS);
    var done = {}; ALL.ev.forEach(function (e) { var m = String(e.event_status_text || '').match(/doc (\d+)/); if (m) done[m[1]] = 1; });
    var withEv = {}; ALL.ev.forEach(function (e) { withEv[e.case.id] = 1; });
    var cases = ALL.lit.filter(function (c) { return !CLOSED.test(c.casestatus_name || '') && (withEv[c.case_id] || c.courtcasenumber || /litigation|deposition|trial/i.test(c.casestatus_name || '')); });
    box.innerHTML = '<div class="kl-note" id="kl-prog">Checking 0 of ' + cases.length + ' cases…</div>';
    pool(cases, 6, function (c) {
      return docs(c.case_id).then(function (list) { return list.filter(function (d) { return !done[d.id] && (pd(d.created) || 0) >= cutoff; }); }).then(function (list) { return markedIn(list).then(function (mk) { return list.filter(function (d) { return !mk[d.id]; }); }); }).then(function (list) { return list.map(function (d) { d.cid = c.case_id; d.cname = c._casename; return d; }); });
    }, function (i, n) { var p = body.querySelector('#kl-prog'); if (p) p.textContent = 'Checking ' + i + ' of ' + n + ' cases…'; }).then(function (res) {
      var all = [].concat.apply([], res.filter(Boolean)); all.sort(function (a, b) { return (pd(b.created) || 0) - (pd(a.created) || 0); });
      var failed = res.filter(function (x) { return x === null; }).length;
      ALL.docs = all; renderAll();
      if (failed) body.querySelector('#kl-nd').insertAdjacentHTML('beforeend', '<div class="kl-err">' + failed + ' case(s) could not be checked. Try again.</div>');
    });
  }

  // ===== This case =====
  var S = {};
  function showCase(after) {
    if (!CID) { body.innerHTML = '<div class="kl-note">Open a case in CasePeer, then click KAL Lit again.</div>'; return; }
    body.innerHTML = 'Loading case…';
    Promise.all([litAll().catch(function () { return []; }), events(CID).catch(function () { return []; })]).then(function (r) {
      var c = r[0].filter(function (k) { return String(k.case_id) === String(CID); })[0], nonLit = !c;
      if (!c) c = { case_id: CID, _casename: String(document.title || 'This case').split(' - ')[0], case_defendants: [] };
      S = { c: c, defs: c.case_defendants || [], ev: r[1], county: c.court_contact_county || '', nonLit: nonLit };
      S.fedCase = /\d:\d{2}-cv-\d+/i.test(c.courtcasenumber || '') || /district court|federal/i.test(S.county);
      S.cc = /orange/i.test(S.county) ? 'OC' : /los angeles/i.test(S.county) ? 'LA' : /riverside/i.test(S.county) ? 'RIV' : '';
      renderCase();
      return (S.nonLit ? Promise.resolve() : firmList(CID, S.defs[0] && S.defs[0].defendant_id)).then(function () {
        return Promise.all([docs(CID), topDocs(CID).catch(function () { return null; }), folderList(CID).catch(function () { return []; }), catList(CID)]);
      }).then(function (r) {
        S.docs = r[0]; S.inbox = r[1]; S.folders = r[2]; S.cats = r[3]; var cut = addDays(today(), -NEW_DAYS);
        return markedIn(S.docs.filter(function (d) { return (pd(d.created) || 0) >= cut; })).catch(function () { return {}; });
      }).then(function (mk) { S.marked = mk; renderInbox(); renderDocs(); if (typeof after === 'function') after(); });
    }).catch(function (e) { body.innerHTML = '<div class="kl-err">' + esc(e.message) + '</div>'; });
  }
  function evDate(e) { return pd(String(e.event_date).split(' ')[0]); }
  function processedIds() { var ids = {}; Object.keys(S.marked || {}).forEach(function (k) { ids[k] = 1; }); S.ev.forEach(function (e) { var m = String(e.event_status_text || '').match(/doc (\d+)/); if (m) ids[m[1]] = 1; }); return ids; }
  function renderCase() {
    var c = S.c, t = today();
    var dHtml = '<table class="kl-t"><tr><th>Defendant</th><th>Served</th><th>Answered</th><th>Defense firm</th></tr>' + S.defs.map(function (d) {
      return '<tr><td>' + esc(d.defendant_name) + '</td><td>' + esc(d.served_date ? fmt(fromIso(d.served_date)) : '—') + '</td><td>' + (d.answered_date ? esc(fmt(fromIso(d.answered_date))) : '<span class="kl-bad">—</span>') + '</td><td>' + esc(d.counsel_law_firm || '—') + '</td></tr>';
    }).join('') + '</table>';
    // needs attention
    var att = [];
    S.ev.forEach(function (e) {
      var d = evDate(e); if (!d) return; var h = holiday(d);
      if (d >= t && h && /LAST DAY|due|deadline/i.test(e.description || '')) att.push(['p-warn', 'Holiday', (e.description || '') + ' — ' + fmt(d) + ' is ' + h + '. Move it to ' + fmt(roll(addDays(d, -1), false).d) + ' by hand.']);
      if (d < t && /^LAST DAY/i.test(e.description || '') && !e.completed_date && !/complete/i.test(e.litigation_event_status || '')) att.push(['p-bad', 'Past due', (e.description || '') + ' — was ' + fmt(d) + ', not marked complete. Done or missed?']);
    });
    var hasDS = S.ev.some(function (e) { return /answer due|request default/i.test(e.description || ''); });
    S.defs.forEach(function (d) { if (d.served_date && !d.answered_date && !hasDS) att.push(['p-bad', 'Missing', d.defendant_name + ' served ' + fmt(fromIso(d.served_date)) + ' — no answer-due / default deadlines. Use “Enter facts” → Defendant served.']); });
    if (S.nonLit) {
      body.innerHTML = '<div style="font-size:17px;font-weight:700">' + esc(c._casename) + '</div><div class="kl-mute">Case ' + CID + ' · not a litigation case, so only filing is shown</div>' +
        '<div class="kl-h">Unfiled documents</div><div id="kl-inbox">Looking for unfiled documents…</div><div id="kl-card"></div><div id="kl-docs" style="display:none"></div><div id="kl-work"></div>';
      return;
    }
    body.innerHTML = (FROM_ALL ? '<button class="kl-btn ghost" id="kl-back" style="padding:4px 10px;font-size:12px">← Back to All cases</button> <a href="/case/' + CID + '/litigation/" target="_top" class="kl-mute">open this case in CasePeer</a>' : '') + '<div style="font-size:17px;font-weight:700">' + esc(c._casename.split(' - ')[0]) + '</div><div class="kl-mute">Case ' + CID + ' · ' + esc(S.county || 'county unknown') + (c.courtcasenumber ? ' · ' + esc(c.courtcasenumber) : '') + '</div>' +
      '<div class="kl-h">1 · Defendants</div>' + dHtml +
      '<div class="kl-h">2 · Needs attention (' + att.length + ')</div>' + (att.length ? '<div class="kl-list">' + att.map(function (a) { return '<div class="kl-row"><span class="kl-pill ' + a[0] + '">' + a[1] + '</span><div>' + esc(a[2]) + '</div></div>'; }).join('') + '</div>' : '<div class="kl-mute">Nothing found.</div>') +
      '<div class="kl-h">3 · Unfiled documents</div><div id="kl-inbox">Looking for unfiled documents…</div><div id="kl-card"></div>' +
      '<div class="kl-h">4 · Calendar a document that is already filed</div><div id="kl-docs">Finding litigation documents…</div><div id="kl-work"></div>';
    var bk = body.querySelector('#kl-back'); if (bk) bk.onclick = function () { tab('all'); };
  }
  function renderDocs() {
    var box = body.querySelector('#kl-docs'); if (!box) return;
    var done = processedIds(); var list = S.docs || [];
    var cutoff = addDays(today(), -NEW_DAYS);
    var fresh = list.filter(function (d) { return !done[d.id] && (pd(d.created) || 0) >= cutoff; });
    S.showAll = S.showAll || false; var show = S.showAll ? list : fresh;
    box.innerHTML = (list.length ? '<select id="kl-doc" style="width:100%;padding:6px">' + show.slice(0, 80).map(function (d) { return '<option value="' + d.id + '">' + esc(d.created.split(' ')[0] + ' · ' + d.path.replace(/^\//, '') + ' · ' + d.name) + (done[d.id] ? ' (already calendared)' : '') + '</option>'; }).join('') + '</select>' : '<div class="kl-mute">No PDFs in the Litigation folders.</div>') +
      '<div style="margin-top:6px"><button class="kl-btn" id="kl-read"' + (show.length ? '' : ' disabled') + '>Read this document</button><button class="kl-btn ghost" id="kl-prevdoc"' + (show.length ? '' : ' disabled') + '>Preview document</button><button class="kl-btn ghost" id="kl-nothing"' + (show.length ? '' : ' disabled') + '>Nothing to calendar</button><button class="kl-btn ghost" id="kl-manual">Enter facts by hand</button>' +
      '<label class="kl-mute" style="margin-left:8px"><input type="checkbox" id="kl-all"' + (S.showAll ? ' checked' : '') + '> show older and already-calendared</label></div>' +
      '<div class="kl-mute">' + fresh.length + ' new (uploaded in the last ' + NEW_DAYS + ' days, not calendared yet) · ' + (list.length - fresh.length) + ' older or already calendared</div>';
    var want = null; try { want = localStorage.getItem('kl-open-doc'); localStorage.removeItem('kl-open-doc'); } catch (e) { }
    if (want && box.querySelector('#kl-doc option[value="' + want + '"]')) box.querySelector('#kl-doc').value = want;
    box.querySelector('#kl-all').onchange = function () { S.showAll = this.checked; renderDocs(); };
    var rb = box.querySelector('#kl-read'); if (rb) rb.onclick = function () { readDoc(+box.querySelector('#kl-doc').value); };
    var nb = box.querySelector('#kl-nothing'); if (nb) nb.onclick = function () { nothingFor(+box.querySelector('#kl-doc').value, nb); };
    var pv = box.querySelector('#kl-prevdoc'); if (pv) pv.onclick = function () { var id = +box.querySelector('#kl-doc').value; openFile((S.docs || []).filter(function (x) { return x.id === id; })[0]); };
    box.querySelector('#kl-manual').onclick = function () { S.w = body.querySelector('#kl-work'); S.onSaved = null; S.onNothing = null; factsForm({ kind: 'disc_on_us' }, null); };
  }
  function readDoc(id) {
    var d = (S.docs || []).filter(function (x) { return x.id === id; })[0]; var w = S.w = body.querySelector('#kl-work'); S.onSaved = null; S.onNothing = null;
    w.innerHTML = '<div class="kl-note">Reading ' + esc(d.name) + '…</div>';
    pdfPages(d.url).then(function (pages) { var f = KLP.read(pages); factsForm(f, d); }).catch(function (e) { w.innerHTML = '<div class="kl-err">Could not read the PDF: ' + esc(e.message) + '. Use “Enter facts by hand”.</div>'; });
  }

  function nothingFor(id, btn, after) {
    if (!id) return; btn.disabled = true; var old = btn.textContent; btn.textContent = 'Saving…';
    markNothing(id).then(function () { S.marked = S.marked || {}; S.marked[id] = 1; renderDocs(); if (after) after(); }, function (e) { btn.disabled = false; btn.textContent = old; window.alert('Could not save: ' + e.message); });
  }
  // ---- unfiled documents: rename, file, calendar ----
  function openFile(d) { if (d && d.url) window.open(d.url, '_blank'); }
  function stepBar(n) {
    var names = ['Rename', 'File', 'Calendar'], done = ['Renamed', 'Filed', 'Calendared'];
    return '<div class="kl-steps">' + names.map(function (x, i) { var k = i + 1; return k < n || n > 3 ? '<div class="kl-st dn">✓ ' + done[i] + '</div>' : (n <= 2 ? k <= 2 : k === n) ? '<div class="kl-st on">' + k + ' · ' + x + '</div>' : '<div class="kl-st">' + k + ' · ' + x + '</div>'; }).join('') + '</div>';
  }
  function renderInbox() {
    var box = body.querySelector('#kl-inbox'); if (!box) return;
    if (S.inbox === null) { box.innerHTML = '<div class="kl-err">Could not read the top of Documents.</div>'; return; }
    var all = S.inbox || [], cut = addDays(today(), -INBOX_DAYS);
    var recent = all.filter(function (d) { return (pd(d.created) || 0) >= cut; }), older = all.length - recent.length;
    var list = S.inboxAll ? all : recent;
    var more = older ? '<div style="margin-top:6px"><a href="#" id="kl-older" class="kl-mute">' + (S.inboxAll ? 'Hide the ' + older + ' older file' + (older === 1 ? '' : 's') : 'Show ' + older + ' older file' + (older === 1 ? '' : 's') + ' at the top of Documents (more than ' + INBOX_DAYS + ' days old)') + '</a></div>' : '';
    function wireMore() { var a = box.querySelector('#kl-older'); if (a) a.onclick = function (e) { e.preventDefault(); S.inboxAll = !S.inboxAll; renderInbox(); }; }
    if (!list.length) { box.innerHTML = '<div class="kl-mute">Nothing new to file. New documents dropped at the top of Documents show up here.</div>' + more; wireMore(); if (!S.cardDone && !S.cardId) body.querySelector('#kl-card').innerHTML = ''; return; }
    box.innerHTML = '<div class="kl-top"><span class="kl-mute">' + list.length + ' document' + (list.length === 1 ? '' : 's') + ' at the top of Documents' + (S.inboxAll ? '' : ' (last ' + INBOX_DAYS + ' days)') + '</span><span class="kl-mute"><b>Click a document to open it</b></span></div><div class="kl-list">' + list.map(function (d) {
      var on = String(d.id) === String(S.cardId);
      return '<div class="kl-row kl-in' + (on ? ' sel' : '') + '" data-ib="' + d.id + '"><span class="kl-arrow">' + (on ? '▾' : '›') + '</span><div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(d.name) + ((S.skip || {})[d.id] ? ' <span class="kl-pill p-mute">skipped</span>' : '') + '</div><span class="kl-mute" style="white-space:nowrap">' + esc(String(d.created).split(' ')[0]) + (d.by ? ' · ' + esc(d.by) : '') + '</span></div>';
    }).join('') + '</div>' + more; wireMore();
    box.querySelectorAll('[data-ib]').forEach(function (r) { r.onclick = function () { openCard(+r.dataset.ib); }; });
    var first = recent.filter(function (x) { return !(S.skip || {})[x.id]; })[0];
    if (!S.cardId && !S.cardDone && first) openCard(first.id);
  }
  function findFolder(suffixes) {
    var F = S.folders || []; function n(x) { return norm(x).replace(/ s /g, ' '); }
    for (var i = 0; i < suffixes.length; i++) { var want = n(suffixes[i]); var hit = F.filter(function (f) { var p = n(f.path); return p === want || p.slice(-want.length - 1) === ' ' + want; })[0]; if (hit) return hit; }
    return null;
  }
  function findCat(names) { var C = S.cats || []; for (var i = 0; i < names.length; i++) { var h = C.filter(function (c) { return norm(c.name) === norm(names[i]); })[0]; if (h) return h; } return null; }
  function suggest(f, doc) {
    f = f || { kind: 'unknown' }; var k = f.statement ? 'cmc_statement' : f.kind, depo = /deposition/i.test(f.what || '');
    var setTxt = f.set ? ' Set ' + f.set.charAt(0).toUpperCase() + f.set.slice(1).toLowerCase() : '';
    var label = k === 'disc_on_us' || k === 'disc_by_us' ? (depo ? 'Deposition Notice' : (f.what || 'Discovery') + setTxt) : k === 'responses' ? 'Responses to ' + (f.what || 'Discovery') + setTxt :
      k === 'summons_pos' ? 'Proof of Service of Summons' : k === 'answer' ? 'Answer' : k === 'complaint' ? 'Complaint' : k === 'cmc_statement' ? 'CMC Statement' : k === 'notice' ? (f.title || 'Notice of Hearing') : k === 'depo' ? 'Deposition Notice' + (f.what && f.what !== 'Deposition' ? ' - ' + f.what.replace(/^Deposition of /, '') : '') : k === 'expert' ? 'Demand for Expert Exchange' : '';
    var def = label && k !== 'complaint' && k !== 'depo' ? bestMatch([f.from, f.party, f.defendant, f.region, f.region2].join(' '), S.defs || [], function (d) { return d.defendant_name; }) : null;
    var base = String(doc.name).replace(/\.[a-z0-9]{2,5}$/i, '');
    var dt = f.docDate || pd(doc.created) || today();
    var ours = f.filedBy && f.filedBy.us && /cmc_statement|notice/.test(k);
    var name = label ? iso(dt) + ' ' + label + (ours ? ' - Plaintiff' : def ? ' - DF ' + def.defendant_name : '') : (/^\d{4}-\d{2}-\d{2}\b/.test(base) ? base : iso(pd(doc.created) || today()) + ' ' + base);
    var fold = { disc_on_us: depo ? ['Discovery › Depositions'] : ['Discovery › Defendant Propounding'], disc_by_us: depo ? ['Discovery › Depositions'] : ['Discovery › Plaintiff Propounding'],
      responses: ['Plaintiff Propounding › Defendant Response', 'Plaintiff Propounding › Defendants Response', 'Discovery › Plaintiff Propounding'], summons_pos: ['Pleadings › Proof of Service'], answer: ['Pleadings › Answer'], complaint: ['Pleadings › Complaint'],
      cmc_statement: ['Pleadings › Case Management Statements'], depo: ['Discovery › Depositions'], expert: ['Discovery › Experts'], notice: f.what === 'msj' || /Motion|MSJ|MSA/.test(f.title || '') ? ['Pleadings › Motions'] : ['Pleadings › Notices'] }[k];
    var folder = fold ? findFolder(fold.concat(/disc|responses|depo|expert/.test(k) ? ['Litigation › Discovery'] : ['Litigation › Pleadings'], ['Litigation'])) : null;
    var cat = { disc_on_us: depo ? ['Depositions'] : ['Discovery'], disc_by_us: depo ? ['Depositions'] : ['Discovery'], responses: ['Discovery'], depo: ['Depositions'], expert: ['Expert Witnesses', 'Discovery'], summons_pos: ['Service Paperwork'], answer: ['Pleadings'], complaint: ['Pleadings'], cmc_statement: ['Pleadings'],
      notice: f.what === 'msj' || /Motion|MSJ|MSA/.test(f.title || '') ? ['Pleadings'] : ['Court Filings', 'Pleadings'] }[k];
    if (!fold) {
      var txt = (doc.name + ' ' + (f.region2 || '')).toLowerCase();
      var guess = [[/\blien|lien letter|notice of lien/, 'Liens', 'Lien Negotiations'], [/medical record|medical bill|itemized|billing statement|\bucr\b|radiology|mri|chiropract/, 'Medicals', 'Medical Treatment'],
        [/police|traffic collision|incident report/, 'Police Report', 'Incident Report'], [/property damage|repair estimate|total loss/, 'Property Damage', 'Property Damage'],
        [/health insurance|medi-cal|medicare|kaiser|blue shield|anthem/, 'Health Insurance', 'Health Insurance'], [/settlement|release of all claims|disbursement/, 'Settlement', 'Settlement'],
        [/invoice/, 'Invoices', 'Invoices'], [/adjuster|policy limits|declarations page|insurance/, 'Insurance', 'Defendant Insurance']].filter(function (g) { return g[0].test(txt); })[0];
      if (guess) { folder = findFolder([guess[1]]); var gc = findCat([guess[2]]); return { name: name.replace(/[\/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim(), folder: folder, cat: gc }; }
    }
    return { name: name.replace(/[\/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim(), folder: folder, cat: cat ? findCat(cat) : null };
  }
  function openCard(id) {
    var d = (S.inbox || []).filter(function (x) { return x.id === id; })[0]; if (!d) return;
    S.cardId = id; S.cardDone = false; S.onSaved = null; S.onNothing = null; renderInbox();
    var c = body.querySelector('#kl-card'), ext = (String(d.name).match(/\.[a-z0-9]{2,5}$/i) || [''])[0];
    c.innerHTML = '<div class="kl-box" style="margin-top:10px">' + stepBar(1) + '<div class="kl-top"><div style="font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(d.name) + '</div><button class="kl-btn ghost" id="kc-pv" style="padding:4px 10px;font-size:12px;white-space:nowrap">Preview document</button></div>' +
      '<div class="kl-ins" id="kc-ins">' + (d.pdf ? 'Reading the document…' : 'Type the new name and pick the folder. Then click <b>Rename and file</b>.') + '</div>' +
      '<div class="kl-grid"><span>New name</span><div style="display:flex;align-items:center;gap:6px"><input id="kc-name" style="flex:1"><span class="kl-mute">' + esc(ext) + '</span></div>' +
      '<span>Folder</span><select id="kc-fold"><option value="">— pick a folder —</option>' + (S.folders || []).map(function (f) { return '<option value="' + f.id + '">' + esc(f.path) + '</option>'; }).join('') + '</select>' +
      '<span>Category</span><select id="kc-cat"><option value="">— none —</option>' + (S.cats || []).map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + '</option>'; }).join('') + '</select></div>' +
      '<button class="kl-btn" id="kc-go">Rename and file</button><button class="kl-btn ghost" id="kc-skip">Skip for now</button><div id="kc-res"></div></div>';
    c.querySelector('#kc-pv').onclick = function () { openFile(d); };
    function fill(f) {
      if (String(S.cardId) !== String(id)) return; S.cf = f; var sg = suggest(f, d);
      c.querySelector('#kc-name').value = sg.name; if (sg.folder) c.querySelector('#kc-fold').value = sg.folder.id; if (sg.cat) c.querySelector('#kc-cat').value = sg.cat.id;
      c.querySelector('#kc-ins').innerHTML = f && f.kind !== 'unknown' && f.kind !== 'scan' ? 'The panel read the document and filled this in. Check it. Fix anything that\'s wrong. Then click <b>Rename and file</b>.' :
        'The panel could not tell what this document is. Type the new name and pick the folder. Then click <b>Rename and file</b>.';
    }
    if (d.pdf) pdfPages(d.url).then(function (pg) { fill(KLP.read(pg)); }).catch(function () { fill(null); }); else fill(null);
    c.querySelector('#kc-go').onclick = function () { fileIt(d, ext); };
    c.querySelector('#kc-skip').onclick = function () {
      S.skip = S.skip || {}; S.skip[id] = 1; S.cardId = null;
      var next = (S.inbox || []).filter(function (x) { return !S.skip[x.id]; })[0];
      if (next) openCard(next.id); else { c.innerHTML = '<div class="kl-mute" style="margin-top:8px">Skipped. It stays at the top of Documents until someone files it.</div>'; S.cardDone = true; renderInbox(); }
    };
  }
  var FBUSY = false;
  function fileIt(d, ext) {
    if (FBUSY) return; var c = body.querySelector('#kl-card'), res = c.querySelector('#kc-res');
    var nm = c.querySelector('#kc-name').value.replace(/[\/\\:*?"<>|]+/g, '-').trim(), fid = +c.querySelector('#kc-fold').value, cat = +c.querySelector('#kc-cat').value || 0;
    if (!nm) { res.innerHTML = '<div class="kl-err">Type the new name.</div>'; return; }
    if (!fid) { res.innerHTML = '<div class="kl-err">Pick a folder.</div>'; return; }
    var full = ext && nm.toLowerCase().slice(-ext.length) !== ext.toLowerCase() ? nm + ext : nm, fpath = ((S.folders || []).filter(function (f) { return f.id === fid; })[0] || {}).path || '';
    FBUSY = true; var go = c.querySelector('#kc-go'); go.disabled = true; res.innerHTML = '<div class="kl-mute">Renaming…</div>';
    var renamed = false, dupNote = '';
    getJSON('/api/v1/case/case-documents/' + CID + '/?page_size=300&folder_id=' + fid).then(function (r) {
      // same name already in that folder: add (2), (3)…
      var taken = {}; (r.results || []).forEach(function (x) { if (x.id !== d.id) taken[String(x.docname).toLowerCase()] = 1; });
      var stem = full.slice(0, full.length - (ext && full.toLowerCase().slice(-ext.length) === ext.toLowerCase() ? ext.length : 0)), n = 2, start = full;
      while (taken[full.toLowerCase()]) full = stem + ' (' + (n++) + ')' + (ext || '');
      if (full !== start) dupNote = ' That folder already had a file with this name, so this one is “' + full + '”.';
      return String(d.name) === full && !cat ? null : renameDoc(d.id, full, cat);
    }).then(function () { renamed = true; res.innerHTML = '<div class="kl-mute">Moving to ' + esc(fpath) + '…</div>'; return moveDoc(CID, d.id, fid); }).then(function () {
      FBUSY = false; S.inbox = (S.inbox || []).filter(function (x) { return x.id !== d.id; }); S.cardDone = true; S.cardId = null; renderInbox();
      docs(CID).then(function (x) { S.docs = x; renderDocs(); }).catch(function () { });
      step3({ id: d.id, name: full, url: d.url, created: d.created }, fpath, dupNote);
    }, function (e) {
      FBUSY = false; go.disabled = false;
      res.innerHTML = '<div class="kl-err">' + (renamed ? 'Renamed, but not moved: ' : 'Not renamed: ') + esc(e.message) + ' Nothing else changed. Try again, or do it in CasePeer.</div>';
    });
  }
  function step3(doc, fpath, dupNote) {
    var c = body.querySelector('#kl-card'), f = S.cf, cal = !S.nonLit && f && CAL_KINDS[f.kind];
    c.innerHTML = '<div class="kl-box" style="margin-top:10px"><div id="kc-bar">' + stepBar(3) + '</div><div class="kl-top"><div style="font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(doc.name) + '</div><button class="kl-btn ghost" id="kc-pv" style="padding:4px 10px;font-size:12px;white-space:nowrap">Preview document</button></div>' +
      '<div class="kl-ok" style="margin-bottom:8px">✓ Renamed and filed in ' + esc(fpath) + '. Checked.' + esc(dupNote || '') + '</div><div id="kc-cal"></div></div>';
    c.querySelector('#kc-pv').onclick = function () { openFile(doc); };
    var area = c.querySelector('#kc-cal');
    S.onSaved = function () { var b = c.querySelector('#kc-bar'); if (b) b.innerHTML = stepBar(4); };
    S.onNothing = function () { var b = c.querySelector('#kc-bar'); if (b) b.innerHTML = stepBar(3).replace('<div class="kl-st on">3 · Calendar</div>', '<div class="kl-st">No deadline</div>'); };
    if (cal) factsForm(f, doc, { target: area, inCard: true });
    else {
      if (S.nonLit) {
        area.innerHTML = '<div class="kl-ins">Filed. This is not a litigation case, so there is nothing to calendar here.</div><button class="kl-btn ghost" id="kc-next">Next document</button>';
        var b0 = c.querySelector('#kc-bar'); if (b0) b0.innerHTML = stepBar(3).replace('<div class="kl-st on">3 · Calendar</div>', '<div class="kl-st">Not litigation</div>');
      } else {
        area.innerHTML = '<div class="kl-ins">' + (f && f.kind === 'scan' ? 'The panel could not read this document (it is a picture, with no text).' : 'The panel did not find a deadline it knows how to calendar.') + ' If this document sets a deadline, click <b>Enter the facts</b>. If not, click <b>Nothing to calendar</b>.</div>' +
          '<button class="kl-btn" id="kc-man">Enter the facts</button><button class="kl-btn ghost" id="kc-none">Nothing to calendar</button><button class="kl-btn ghost" id="kc-next">Next document</button>';
        area.querySelector('#kc-man').onclick = function () { factsForm({ kind: 'notice' }, doc, { target: area, inCard: true }); };
        var nb2 = area.querySelector('#kc-none'); nb2.onclick = function () { nothingFor(doc.id, nb2, function () { area.innerHTML = '<div class="kl-ok" style="margin:6px 0">✓ Marked “nothing to calendar.”</div><button class="kl-btn ghost" id="kc-next">Next document</button>'; area.querySelector('#kc-next').onclick = function () { nextDoc(area); }; S.onNothing(); }); };
      }
      area.querySelector('#kc-next').onclick = function () { nextDoc(area); };
    }
  }

  // ---- facts form ----
  var KINDS = [['disc_on_us', 'Discovery served on us'], ['summons_pos', 'Defendant served (proof of service of summons)'], ['answer', 'Answer served'], ['notice', 'Court notice (CMC, trial, hearing…)'], ['disc_by_us', 'We served discovery'], ['responses', 'We got verified responses'], ['complaint', 'We filed the complaint'], ['depo', 'Deposition notice'], ['expert', 'Demand for expert exchange']];
  var CAL_KINDS = { depo: 1, expert: 1, disc_on_us: 1, summons_pos: 1, answer: 1, notice: 1, disc_by_us: 1, responses: 1, complaint: 1 };
  var NOTICES = [['cmc', 'Case Management Conference'], ['tsc', 'Trial Setting Conference'], ['trial1', 'Trial — FIRST trial date'], ['trialmoved', 'Trial — NEW date (continued)'], ['mediation', 'Mediation'], ['msj', 'Defense MSJ hearing'], ['msc', 'Mandatory Settlement Conf. (Riverside)'], ['fsc', 'Final Status Conference (LA)'], ['hearing', 'Other hearing']];
  function defOptions(sel) { return '<option value="">— pick —</option>' + S.defs.map(function (d) { return '<option value="' + d.defendant_id + '"' + (String(sel) === String(d.defendant_id) ? ' selected' : '') + '>' + esc(d.defendant_name) + '</option>'; }).join(''); }
  function factsForm(f, doc, opts) {
    opts = opts || {}; var w = S.w = opts.target || body.querySelector('#kl-work'); S.doc = doc; S.f = f;
    if (f.kind === 'scan' || f.kind === 'unknown' || !CAL_KINDS[f.kind]) { w.innerHTML = '<div class="kl-note">' + (f.kind === 'scan' ? 'This PDF is a scanned image — no text to read.' : 'I could not tell what this document is.') + ' Pick the type and fill in the facts below.</div>'; f = S.f = { kind: 'disc_on_us' }; }
    else w.innerHTML = '';
    // resolve names against CasePeer lists
    var defGuess = f.region || f.region2 || f.from || f.party || f.defendant ? bestMatch((f.from || '') + ' ' + (f.party || '') + ' ' + (f.defendant || '') + ' ' + (f.region || '') + ' ' + (f.region2 || ''), S.defs, function (d) { return d.defendant_name; }) : null;
    var firmGuess = f.kind === 'answer' && FIRMS ? bestMatch((f.firm || '') + ' ' + (f.head || ''), FIRMS, function (x) { return x.name; }) : null;
    var served = f.kind === 'summons_pos' ? (f.method === 'substituted' ? (f.mailDate || f.subDate) : f.personalDate) : /notice|depo|expert/.test(f.kind) ? f.date : f.served;
    var ins = '<div class="kl-ins">' + (opts.inCard ? 'This document sets a deadline. Check the facts. Fix anything that\'s wrong. Then click <b>Review deadlines</b>. Nothing is saved yet.' : doc ? 'Check the facts. Fix anything that\'s wrong. Then click <b>Review deadlines</b>. Nothing is saved yet.' : 'Enter the facts. Then click <b>Review deadlines</b>. Nothing is saved yet.') + '</div>';
    if (f.filedBy) ins += '<div style="margin:-2px 0 8px"><b>Filed by:</b> ' + esc(f.filedBy.us ? 'us (KAL, for plaintiff)' : f.filedBy.label) + '</div>';
    var h = (opts.inCard ? ins : '<div class="kl-box"><div class="kl-top"><div style="font-weight:700">' + (doc ? 'I read <i>' + esc(doc.name) + '</i> as:' : 'Enter the facts:') + '</div>' + (doc ? '<button class="kl-btn ghost" id="kf-pv" style="padding:4px 10px;font-size:12px">Preview document</button>' : '') + '</div>' + ins) + '<div class="kl-grid">' +
      '<span>Type</span><select id="kf-kind">' + KINDS.map(function (k) { return '<option value="' + k[0] + '"' + (k[0] === f.kind ? ' selected' : '') + '>' + k[1] + '</option>'; }).join('') + '</select>' +
      '<span>Court</span><select id="kf-court"><option value="ca">California state court</option><option value="fed"' + (f.federal || S.fedCase ? ' selected' : '') + '>Federal court</option></select>' +
      '<span class="kf-defr">Defendant</span><select class="kf-defr" id="kf-def">' + defOptions(defGuess && defGuess.defendant_id) + '</select>' +
      '<span class="kf-whatr">What</span><input class="kf-whatr" id="kf-what" value="' + esc(f.what || '') + '" placeholder="e.g. Special Interrogatories">' +
      '<span class="kf-setr">Set</span><input class="kf-setr" id="kf-set" value="' + esc(f.set || '') + '" placeholder="One">' +
      '<span class="kf-evr">Event</span><select class="kf-evr" id="kf-what2">' + NOTICES.map(function (n) { return '<option value="' + n[0] + '"' + (n[0] === (f.what === 'trial' ? 'trial1' : f.what) ? ' selected' : '') + '>' + n[1] + '</option>'; }).join('') + '</select>' +
      '<span class="kf-tdr">Time</span><input class="kf-tdr" type="time" id="kf-time" value="' + esc(to24(f.time)) + '" style="max-width:160px">' +
      '<span class="kf-tdr">Dept</span><input class="kf-tdr" id="kf-dept" value="' + esc(f.dept || '') + '" placeholder="C27" style="max-width:160px">' +
      '<span class="kf-ans">Defense firm</span><select class="kf-ans" id="kf-firm"><option value="">— not in contacts / leave as is —</option>' + (FIRMS || []).map(function (x) { return '<option value="' + x.id + '"' + (firmGuess && firmGuess.id === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select>' +
      '<span class="kf-sum">How served</span><select class="kf-sum" id="kf-sm"><option value="personal"' + (f.method === 'personal' ? ' selected' : '') + '>Personal</option><option value="substituted"' + (f.method === 'substituted' ? ' selected' : '') + '>Substituted (date = mailing date)</option></select>' +
      '<span id="kf-dl">Date</span><input type="date" id="kf-date" value="' + (served ? iso(served) : '') + '">' +
      '<span class="kf-meth">Served by</span><select class="kf-meth" id="kf-meth"><option value="">— pick —</option>' + Object.keys(METHODS).map(function (k) { return '<option value="' + k + '"' + (f.method === k ? ' selected' : '') + '>' + METHODS[k][0] + '</option>'; }).join('') + '</select>' +
      '</div>' + (f.noPos ? '<div class="kl-mute kl-bad" style="font-weight:400">No proof of service in this PDF. The date shown is the document date — check it and pick how it was served.</div>' : '') +
      (/^multi/.test(f.method || '') ? '<div class="kl-mute kl-bad" style="font-weight:400">The proof of service lists more than one method. Pick the one that is checked.</div>' : '') +
      '<button class="kl-btn" id="kf-go">Review deadlines</button>' + (doc && doc.id ? '<button class="kl-btn ghost" id="kf-none">Nothing to calendar</button>' : '') + '<div id="kl-prev"></div>' + (opts.inCard ? '' : '</div>');
    w.innerHTML += h;
    var pvb = w.querySelector('#kf-pv'); if (pvb) pvb.onclick = function () { openFile(doc); };
    var nob = w.querySelector('#kf-none'); if (nob) nob.onclick = function () { nothingFor(doc.id, nob, function () { w.innerHTML = '<div class="kl-ok" style="margin:8px 0">✓ Marked “nothing to calendar.” It won\'t show as new again.</div>'; if (typeof S.onNothing === 'function') S.onNothing(); }); };
    function sync() {
      var k = w.querySelector('#kf-kind').value;
      w.querySelectorAll('.kf-whatr').forEach(function (e) { e.style.display = /disc|depo/.test(k) ? '' : 'none'; });
      w.querySelectorAll('.kf-setr').forEach(function (e) { e.style.display = /disc/.test(k) ? '' : 'none'; });
      w.querySelectorAll('.kf-evr').forEach(function (e) { e.style.display = k === 'notice' ? '' : 'none'; });
      w.querySelectorAll('.kf-tdr').forEach(function (e) { e.style.display = k === 'notice' || k === 'depo' ? '' : 'none'; });
      w.querySelectorAll('.kf-ans').forEach(function (e) { e.style.display = k === 'answer' ? '' : 'none'; });
      w.querySelectorAll('.kf-sum').forEach(function (e) { e.style.display = k === 'summons_pos' ? '' : 'none'; });
      w.querySelectorAll('.kf-defr').forEach(function (e) { e.style.display = /summons_pos|answer|disc|responses|depo|expert/.test(k) ? '' : 'none'; });
      w.querySelectorAll('.kf-meth').forEach(function (e) { e.style.display = /disc|responses/.test(k) ? '' : 'none'; });
      w.querySelector('#kf-dl').textContent = k === 'depo' ? 'Deposition date' : k === 'expert' ? 'Exchange date (in the demand)' : k === 'notice' ? 'Event date (hearing date)' : k === 'summons_pos' ? (w.querySelector('#kf-sm').value === 'substituted' ? 'Mailing date' : 'Date served') : k === 'answer' ? 'Date answer served' : k === 'complaint' ? 'Date the complaint was filed' : k === 'responses' ? 'Date responses were served on us' : 'Date served';
      w.querySelector('#kl-prev').innerHTML = ''; var tn = w.querySelector('#kf-none'); if (tn) tn.style.display = '';
    }
    w.querySelectorAll('select,input').forEach(function (e) { e.onchange = sync; }); sync();
    w.querySelector('#kf-go').onclick = preview;
  }

  // ---- preview ----
  function readForm() {
    var w = S.w, g = function (id) { var e = w.querySelector(id); return e ? e.value : ''; };
    var tm = to12(g('#kf-time')), dp = g('#kf-dept').trim().replace(/^dept\.?\s*/i, '');
    return { fed: g('#kf-court') === 'fed', kind: g('#kf-kind'), def: g('#kf-def'), what: g('#kf-what'), set: g('#kf-set'), what2: g('#kf-what2'), time: [tm, dp ? 'Dept ' + dp : ''].filter(Boolean).join(' · '), firm: g('#kf-firm'), sm: g('#kf-sm'), date: fromIso(g('#kf-date')), meth: g('#kf-meth') };
  }
  function preview() {
    var F = readForm(), out = S.w.querySelector('#kl-prev'), err = [];
    if (!F.date) err.push('Enter the date.');
    var unknownNote = '';
    if (F.kind === 'disc_on_us' && !F.meth) unknownNote = 'Service method unknown — used the earliest date (no extra days). Check the proof of service.';
    if (F.kind === 'disc_by_us' && !F.meth) { F.meth = 'mail'; unknownNote = 'Service method unknown — used the latest date (mail). Check the proof of service.'; }
    if (F.kind === 'responses' && !F.meth) unknownNote = 'Service method unknown — used the earliest date (no extra days). Check the proof of service.';
    if ((F.kind === 'summons_pos' || F.kind === 'answer') && !F.def) err.push('Pick the defendant.');
    if (F.kind === 'disc_on_us' && /deposition/i.test(F.what)) err.push('This is a deposition notice. Change Type to “Deposition notice”.');
    if (F.fed && F.kind !== 'disc_on_us' && F.kind !== 'depo') err.push('Federal case: KAL Lit only does “Discovery served on us” for now. The KAL plans use California rules. Calendar this one by hand.');
    if (err.length) { out.innerHTML = '<div class="kl-err">' + err.join(' ') + '</div>'; return; }
    FED = F.fed;
    var defName = (S.defs.filter(function (d) { return String(d.defendant_id) === F.def; })[0] || {}).defendant_name || '';
    var plan = Promise.resolve([]), trig = F.date, method = F.meth, recordOps = [], mainEv = null, warn = [];
    if (unknownNote) warn.push(unknownNote);
    if (F.fed) warn.push('Federal rules: 30 days to respond (FRCP 33, 34, 36). No extra days for e-service. +3 days for mail, fax or overnight (FRCP 6(d)).');
    if (F.kind === 'disc_on_us') plan = Promise.resolve(discOnUsRules({ what: F.what || 'Discovery', set: F.set, from: defName }));
    else if (F.kind === 'disc_by_us') plan = planRules(CID, PLAN.discOut, true);
    else if (F.kind === 'responses') plan = planRules(CID, S.cc === 'LA' ? PLAN.respInLA : PLAN.respIn, true);
    else if (F.kind === 'complaint') plan = planRules(CID, PLAN.complaint, false);
    else if (F.kind === 'depo') {
      var who = F.what && !/^deposition$/i.test(F.what) ? F.what.replace(/^deposition of /i, '') : 'witness';
      mainEv = { desc: 'Deposition of ' + who + (F.time ? ' — ' + F.time.replace(/ · Dept.*$/, '') : ''), date: F.date, type: TYPE.deadline, typeName: /deposition/i, notes: [] };
      plan = Promise.resolve([{ key: 'obj', desc: 'LAST DAY: serve objections to deposition notice (CCP 2025.410) — ' + who, days: 3, before: true, side: 'ours' }]);
    } else if (F.kind === 'expert') {
      mainEv = { desc: 'LAST DAY: exchange expert witness information (CCP 2034.260)', date: F.date, type: TYPE.deadline, typeName: /expert/i, notes: [] };
      plan = Promise.resolve([{ key: 'supp', desc: 'LAST DAY: serve supplemental expert witness list (CCP 2034.280)', days: 20, before: false, side: 'ours' }]);
      warn.push('The exchange date is the one stated in the demand. Check it against the trial date: 50 days before trial, or 20 days after the demand was served, whichever is later.');
    }
    else if (F.kind === 'summons_pos') {
      trig = F.sm === 'substituted' ? addDays(F.date, 10) : F.date; method = '';
      if (F.sm === 'substituted') warn.push('Substituted service: service is complete 10 days after mailing (CCP 415.20) → ' + fmt(trig) + '.');
      plan = planRules(CID, PLAN.served, false);
      recordOps.push({ op: 'dates', def: F.def, set: { service_date: fmt(F.date), served_date: fmt(trig) }, label: defName + ': served ' + fmt(trig) + (F.sm === 'substituted' ? ' (substituted, mailed ' + fmt(F.date) + ')' : ' (personal)') });
    } else if (F.kind === 'answer') {
      recordOps.push({ op: 'dates', def: F.def, set: { answered_date: fmt(F.date), appeared_date: fmt(F.date) }, label: defName + ': answered ' + fmt(F.date) });
      if (F.firm) recordOps.push({ op: 'firm', def: F.def, firm: F.firm, label: defName + ': defense firm → ' + ((FIRMS || []).filter(function (x) { return x.id === F.firm; })[0] || {}).name });
      plan = S.cc === 'OC' ? planRules(CID, PLAN.answerOC, false) : Promise.resolve([]);
      if (S.cc !== 'OC') warn.push('No answer deadlines outside Orange County. Only the defendant record is updated.');
    } else if (F.kind === 'notice') {
      var w2 = F.what2, label = (NOTICES.filter(function (n) { return n[0] === w2; })[0] || [])[1] || 'Hearing';
      var ids = { cmc: [PLAN.cmc], tsc: [PLAN.tsc], trial1: [PLAN.trialInit, S.cc === 'OC' ? PLAN.trialCurOC : PLAN.trialCur], trialmoved: [S.cc === 'OC' ? PLAN.trialCurOC : PLAN.trialCur], mediation: [PLAN.mediation], msj: [PLAN.msj], msc: [PLAN.mscRiv], fsc: [PLAN.fscLA], hearing: [] }[w2] || [];
      if (w2 === 'msc' && S.cc !== 'RIV') warn.push('MSC plan is for Riverside; this case is ' + (S.county || 'unknown county') + '.');
      if (w2 === 'fsc' && S.cc !== 'LA') warn.push('FSC plan is for Los Angeles; this case is ' + (S.county || 'unknown county') + '.');
      if (w2 === 'trialmoved') warn.push('Trial moved: delete the OLD Current Trial Date events by hand (998, MSJ, notice to appear, trial order). Do not touch Initial Trial Date events.');
      mainEv = { desc: label + (F.time ? ' — ' + F.time : ''), date: F.date, type: { cmc: TYPE.cmc, tsc: TYPE.tsc, trial1: TYPE.trial, trialmoved: TYPE.trial, mediation: TYPE.mediation, msj: TYPE.msj, msc: TYPE.msc, fsc: TYPE.fsc }[w2] || TYPE.hearing, notes: [] };
      plan = Promise.all(ids.map(function (p) { return planRules(CID, p, false); })).then(function (a) { return [].concat.apply([], a); });
    }
    out.innerHTML = 'Working out dates…';
    Promise.all([plan, F.kind === 'disc_on_us' ? tasksAll(CID) : []]).then(function (pr) {
      var rl = pr[0], oldTasks = pr[1];
      var list = compute(rl, trig, method); if (mainEv) list.unshift(mainEv);
      var tasks = [];
      if (F.kind === 'disc_on_us' && list[0]) {
        var last = list[0].date, lbl = list[0].desc.replace(/^LAST DAY: serve responses to /, '').replace(/ — RFAs.*$/, '');
        [[10, 'Start responses to ', 2], [3, 'Finish and serve responses to ', 4]].forEach(function (k) {
          var due = roll(addDays(last, -k[0]), false).d;
          var tx = k[0] + ' DAYS LEFT — ' + k[1] + lbl + '. LAST DAY ' + fmt(last) + '.';
          var tk = { text: tx, due: due, pri: k[2], notes: [], add: due >= today() };
          if (!tk.add) tk.notes.push('in the past — skipped');
          if (oldTasks.some(function (o) { return norm(taskText(o)) === norm(tx); })) { tk.add = false; tk.notes.push('task already exists'); }
          tasks.push(tk);
        });
      }
      var t = today();
      var allServed = S.defs.length && S.defs.every(function (d) { return d.served_date; });
      var hre = HEARING_RE[F.kind === 'notice' ? F.what2 : F.kind] || null;
      list.forEach(function (x) {
        if (x.date < t) return lock(x, 'in the past');
        if (F.kind === 'complaint' && allServed && /3-year service/i.test(x.desc)) return lock(x, 'all defendants are served');
        if (x === mainEv && hre) { var hit = sameKindOn(hre, x.date); if (hit) return lock(x, 'already on calendar (“' + String(hit.description || '').slice(0, 60) + '”)'); }
        if (exactDupe(x.desc, x.date)) return lock(x, 'already on calendar');
        x.add = true;
        var mb = maybeDupe(x.desc, x.date); if (mb) x.maybe = 'Possible duplicate: “' + String(mb.description || '').slice(0, 70) + '” on ' + fmt(evDate(mb)) + '. Untick if it is the same deadline.';
      });
      tasks.forEach(function (x) { x.lock = !x.add; });
      var moved = null;
      if (mainEv && !mainEv.lock && F.kind === 'notice' && /^(cmc|tsc|mediation|msj|msc|fsc)$/.test(F.what2)) {
        var olds = S.ev.filter(function (e) { var d = evDate(e); return d && d >= t && !same(d, mainEv.date) && hre.test((e.litigation_event_type || '') + ' ' + (e.description || '')) && !NOT_ANCHOR.test(e.description || ''); })
          .sort(function (a, b) { return evDate(a) - evDate(b); });
        if (olds.length) moved = { old: olds[0], label: (NOTICES.filter(function (n) { return n[0] === F.what2; })[0] || [])[1] || 'hearing' };
      }
      list.sort(function (a, b) { return a.date - b.date; });
      S.plan = { list: list, ops: recordOps, F: F, tasks: tasks, extraNote: unknownNote, warn: warn, moved: moved, useMove: false, mainEv: mainEv, hre: hre };
      renderPlan();
    }).catch(function (e) { out.innerHTML = '<div class="kl-err">' + esc(e.message) + '</div>'; });
  }

  // ---- duplicate checks ----
  var HEARING_RE = { cmc: /case management|\bcmc\b/i, tsc: /trial setting|\btsc\b/i, trial1: /^(?!.*setting).*\btrial\b/i, trialmoved: /^(?!.*setting).*\btrial\b/i, mediation: /mediation/i, msj: /summary judg|\bmsj\b/i, msc: /settlement conf|\bmsc\b/i, fsc: /final status|\bfsc\b/i, hearing: /hearing/i, depo: /deposition|\bdepo\b/i, expert: /expert.{0,20}exchange|exchange.{0,20}expert/i };
  var NOT_ANCHOR = /^(reminder|last day|alert|post |start |task|\d+ days)/i;
  function lock(x, why) { x.add = false; x.lock = true; x.notes.push(why); }
  function sameKindOn(re, date) { return S.ev.filter(function (e) { return same(evDate(e), date) && re.test((e.litigation_event_type || '') + ' ' + (e.description || '')) && !NOT_ANCHOR.test(e.description || ''); })[0] || null; }
  function exactDupe(desc, date) { var k = norm(desc).slice(0, 40); return S.ev.filter(function (e) { return same(evDate(e), date) && norm(e.description).slice(0, 40) === k; })[0] || null; }
  var STOPW = /^(last|day|days|file|filed|and|the|for|with|due|serve|served|reminder|from|this|that|alert|date|before|after|confirm|exact|check|post|note)$/;
  function sigWords(s) { return norm(s).split(' ').filter(function (w) { return w.length > 2 && !STOPW.test(w) && !/^\d+$/.test(w); }); }
  function maybeDupe(desc, date) {
    var ws = sigWords(desc); if (ws.length < 2) return null;
    return S.ev.filter(function (e) {
      var d = evDate(e); if (!d || Math.abs(d - date) > 3 * 864e5) return false; if (norm(e.description).slice(0, 40) === norm(desc).slice(0, 40)) return false;
      var ew = ' ' + sigWords(e.description).join(' ') + ' '; var hit = ws.filter(function (w) { return ew.indexOf(' ' + w + ' ') >= 0; }).length;
      return hit / ws.length >= 0.6;
    })[0] || null;
  }
  function setMove(on) {
    var P = S.plan; P.useMove = on; var t = today();
    P.list.forEach(function (x) { x.moveFrom = null; });
    if (!on || !P.moved) return;
    P.mainEv.moveFrom = P.moved.old;
    P.list.forEach(function (x) {
      if (x === P.mainEv || x.lock || x.saved) return;
      var k = norm(x.desc).slice(0, 40);
      var old = S.ev.filter(function (e) { var d = evDate(e); return d && !same(d, x.date) && norm(e.description).slice(0, 40) === k && Math.abs(d - evDate(P.moved.old)) < 400 * 864e5; })
        .sort(function (a, b) { return Math.abs(evDate(a) - x.date) - Math.abs(evDate(b) - x.date); })[0];
      if (old) x.moveFrom = old;
    });
  }
  function rowHtml(x, i, box) {
    return '<tr><td>' + (box ? '<input type="checkbox" data-ev="' + i + '"' + (x.unticked ? '' : ' checked') + '>' : '') + '</td><td style="font-weight:700;white-space:nowrap' + (/^LAST DAY/i.test(x.desc) ? ';color:#b00020' : '') + '">' + fmt(x.date) + '</td><td>' + esc(x.desc) +
      (x.moveFrom ? '<div class="kl-ok" style="font-weight:400">Moves the entry now on ' + fmt(evDate(x.moveFrom)) + ' (nothing added twice)</div>' : '') +
      (x.maybe && box ? '<div style="color:#8a6100">⚠ ' + esc(x.maybe) + '</div>' : '') + (x.notes.length ? '<div class="kl-mute">' + esc(x.notes.join(' · ')) + '</div>' : '') + '</td></tr>';
  }
  function renderPlan() {
    var P = S.plan, out = S.w.querySelector('#kl-prev'), asg = getAssignees();
    var topNone = S.w.querySelector('#kf-none'); if (topNone) topNone.style.display = 'none'; // one "Nothing to calendar" at a time
    var act = [], skipped = [], saved = [];
    P.list.forEach(function (x, i) { (x.saved ? saved : x.lock ? skipped : act).push([x, i]); });
    var tAct = [], tSkip = [], tSaved = [];
    (P.tasks || []).forEach(function (x, i) { (x.saved ? tSaved : x.lock ? tSkip : tAct).push([x, i]); });
    var opsLeft = P.ops.map(function (o, i) { return [o, i]; }).filter(function (p) { return !p[0].saved; });
    var anything = act.length || tAct.length || opsLeft.length, done = saved.length || tSaved.length || P.ops.some(function (o) { return o.saved; });
    var bad = (P.log || []).filter(function (l) { return l[0] === 'bad'; }).length;
    var h = '';
    if (anything) h += '<div class="kl-ins" style="margin-top:10px">' + (bad ? '<b>Some entries did not save.</b> Only those are still ticked. Click <b>Try again</b>.' : 'Check the dates and who they are assigned to. Untick anything you don\'t want. Then click <b>Save to calendar</b>.') + '</div>';
    if (P.warn && P.warn.length && anything) h += '<div class="kl-note">' + P.warn.map(esc).join('<br>') + '</div>';
    if (P.moved && anything) h += '<div class="kl-note"><b>The calendar already has a ' + esc(P.moved.label) + ' on ' + fmt(evDate(P.moved.old)) + '</b> (“' + esc(String(P.moved.old.description || '').slice(0, 70)) + '”). This document says <b>' + fmt(P.mainEv.date) + '</b>.<br><label><input type="checkbox" id="kl-mv"' + (P.useMove ? ' checked' : '') + '> It moved. Move the old ' + esc(P.moved.label) + ' and its deadlines to the new dates.</label><div class="kl-mute">Leave this unticked if both dates are real. Then the new one is added and the old one stays.</div></div>';
    if (opsLeft.length) h += '<div class="kl-h">Defendant record</div>' + opsLeft.map(function (p) { return '<label style="display:block"><input type="checkbox" data-op="' + p[1] + '" checked> ' + esc(p[0].label) + ' <span class="kl-mute">(fills blanks only)</span></label>'; }).join('');
    if (act.length) h += '<div class="kl-h">' + (P.useMove ? 'Calendar — will be added or moved' : 'Calendar — will be added') + '</div><table class="kl-t"><tr><th></th><th style="width:96px">Date</th><th>Event</th></tr>' + act.map(function (p) { return rowHtml(p[0], p[1], true); }).join('') + '</table>';
    if (tAct.length) h += '<div class="kl-h">Tasks — to Ashley, Miguel, Juan</div><table class="kl-t">' + tAct.map(function (p) { var x = p[0]; return '<tr><td><input type="checkbox" data-tk="' + p[1] + '" checked></td><td style="font-weight:700;width:96px">' + fmt(x.due) + '</td><td>' + esc(x.text) + ' <span class="kl-pill ' + (x.pri === 4 ? 'p-bad' : 'p-mute') + '">' + (x.pri === 4 ? 'Urgent' : 'Regular') + '</span></td></tr>'; }).join('') + '</table>';
    if (saved.length || tSaved.length) h += '<div class="kl-h">Saved</div>' + saved.map(function (p) { return '<div class="kl-ok" style="font-weight:400">✓ ' + fmt(p[0].date) + ' ' + esc(p[0].desc) + (p[0].moveFrom ? ' (moved from ' + fmt(evDate(p[0].moveFrom)) + ')' : '') + '</div>'; }).join('') + tSaved.map(function (p) { return '<div class="kl-ok" style="font-weight:400">✓ Task ' + fmt(p[0].due) + ' ' + esc(p[0].text) + '</div>'; }).join('');
    var nSkip = skipped.length + tSkip.length;
    if (nSkip) h += '<details style="margin-top:10px"><summary class="kl-mute" style="cursor:pointer">' + nSkip + ' not added — in the past or already on the calendar (show)</summary><table class="kl-t">' + skipped.map(function (p) { return rowHtml(p[0], p[1], false); }).join('') + tSkip.map(function (p) { return '<tr><td></td><td style="width:96px">' + fmt(p[0].due) + '</td><td>' + esc(p[0].text) + '<div class="kl-mute">' + esc(p[0].notes.join(' · ')) + '</div></td></tr>'; }).join('') + '</table></details>';
    if (anything) {
      if (act.length) h += '<div class="kl-h">Assign calendar entries to</div>' + STAFF.map(function (s) { return '<label style="margin-right:10px"><input type="checkbox" data-as="' + s[0] + '"' + (asg.indexOf(s[0]) >= 0 ? ' checked' : '') + '> ' + s[1] + '</label>'; }).join('');
      h += '<div style="margin-top:10px"><button class="kl-btn gold" id="kl-apply">' + (bad ? 'Try again' : 'Save to calendar') + '</button></div>';
    } else if (done) {
      h += '<div class="kl-note" style="margin-top:10px"><span class="kl-ok">✓ All saved and checked.</span></div><button class="kl-btn" id="kl-next">Next document</button><button class="kl-btn ghost" id="kl-again">Refresh case</button>';
    } else {
      h += '<div class="kl-note" style="margin-top:10px"><b>Nothing new to add.</b> Everything here is already on the calendar or in the past.' + (S.doc && S.doc.id ? ' Click <b>Nothing to calendar</b> so it stops showing as new.' : '') + '</div>' +
        (S.doc && S.doc.id ? '<button class="kl-btn" id="kl-clear">Nothing to calendar</button>' : '') + '<button class="kl-btn ghost" id="kl-next">Next document</button>';
    }
    h += '<div id="kl-res">' + ((P.log || []).filter(function (l) { return l[0] === 'bad'; }).map(function (l) { return '<div class="kl-bad" style="font-weight:400">✗ ' + esc(l[1]) + '</div>'; }).join('')) + '</div>';
    out.innerHTML = h;
    out.querySelectorAll('[data-ev]').forEach(function (c) { c.onchange = function () { P.list[+c.dataset.ev].unticked = !c.checked; }; });
    var mv = out.querySelector('#kl-mv'); if (mv) mv.onchange = function () { setMove(mv.checked); renderPlan(); };
    var ap = out.querySelector('#kl-apply'); if (ap) ap.onclick = apply;
    var nx = out.querySelector('#kl-next'); if (nx) nx.onclick = function () { nextDoc(out.querySelector('#kl-res')); };
    var ag = out.querySelector('#kl-again'); if (ag) ag.onclick = function () { showCase(); };
    var cl = out.querySelector('#kl-clear'); if (cl) cl.onclick = function () { nothingFor(S.doc.id, cl, function () { cl.outerHTML = '<span class="kl-ok">✓ Cleared. It won\'t show as new again.</span>'; if (typeof S.onNothing === 'function') S.onNothing(); }); };
    if (done && !anything && !bad && typeof S.onSaved === 'function') S.onSaved();
  }

  // ---- apply ----
  var BUSY = false;

  function saveEvent(x, assign, note, cid) {
    var url = '/case/' + (cid || CID) + '/events/';
    return getDoc(url).then(function (doc) {
      var f = doc.querySelector('select[name=litigation_event_type]'); f = f && f.form; if (!f) throw new Error('Could not open the New Event form (logged out?).');
      var fd = new FormData(f); fd.delete('assigned');
      var tsel = doc.querySelector('select[name=litigation_event_type]'), byName = x.typeName && [].slice.call(tsel.options).filter(function (o) { return x.typeName.test(o.text); })[0];
      fd.set('litigation_event_type', byName ? byName.value : String(x.type)); fd.set('description', x.desc); fd.set('event_date', fmt(x.date));
      fd.set('start_time', ''); fd.set('end_time', ''); fd.set('event_status_text', note); fd.set('is_main_event', 'False'); fd.set('action', '');
      assign.forEach(function (a) { fd.append('assigned', String(a)); });
      return postForm(url, fd);
    });
  }
  function saveTask(x, cid, to) {
    var url = '/case/task/add/' + (cid || CID) + '/';
    return getDoc(url).then(function (doc) {
      var s = doc.querySelector('select[name=directedto]'); var f = s && s.form; if (!f) throw new Error('Could not open the Add Task form (logged out?).');
      var fd = new FormData(f); ['directedto', 'cc_to', 'add_reminder', 'action'].forEach(function (k) { fd.delete(k); });
      fd.set('task', '<div>' + esc(x.text) + '</div>'); fd.set('priority', String(x.pri)); fd.set('task_due_date', fmt(x.due)); fd.set('deadline_cushion', '0'); fd.set('submitButton', 'Submit');
      (to || TASK_TO).forEach(function (a) { fd.append('directedto', String(a)); });
      return postForm(url, fd);
    });
  }
  function moveEvent(cid, id, newDate, addNote) {
    var url = '/case/' + cid + '/events/' + id + '/';
    return getDoc(url).then(function (doc) {
      var f = doc.querySelector('select[name=litigation_event_type]'); f = f && f.form; if (!f) throw new Error('Could not open the event (logged out?).');
      var fd = new FormData(f); fd.set('event_date', fmt(newDate)); fd.set('action', '');
      if (addNote) fd.set('event_status_text', ((fd.get('event_status_text') || '') + ' ' + addNote).trim());
      return postForm(url, fd);
    }).then(function () { return events(cid); }).then(function (ev) {
      var e = ev.filter(function (x) { return x.id === id; })[0];
      if (!e || !same(evDate(e), newDate)) throw new Error('Date did not change. Check the case.');
    });
  }
  function setNote(cid, id, addNote) {
    var url = '/case/' + cid + '/events/' + id + '/';
    return getDoc(url).then(function (doc) {
      var f = doc.querySelector('select[name=litigation_event_type]'); f = f && f.form; if (!f) throw new Error('Could not open the event (logged out?).');
      var fd = new FormData(f); fd.set('action', ''); fd.set('event_status_text', ((fd.get('event_status_text') || '') + ' ' + addNote).trim());
      return postForm(url, fd);
    });
  }
  function markDone(cid, id) {
    return fetch('/api/v1/case/litigation-events/set-status/', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() }, body: JSON.stringify({ rows_selected: [id], status_name: 'complete' }) })
      .then(function (r) { if (!r.ok) throw new Error('CasePeer did not save (HTTP ' + r.status + ').'); return events(cid); })
      .then(function (ev) { var e = ev.filter(function (x) { return x.id === id; })[0]; if (!e || !(/complete/i.test(e.litigation_event_status || '') || e.completed_date)) throw new Error('Not marked complete. Check the case.'); });
  }
  var USERS = null;
  function userIdByName(cid, name) {
    var p = USERS ? Promise.resolve(USERS) : getDoc('/case/task/add/' + cid + '/').then(function (d) { var s = d.querySelector('select[name=directedto]'); USERS = s ? [].slice.call(s.options).map(function (o) { return { id: +o.value, name: o.text.trim() }; }) : []; return USERS; });
    return p.then(function (us) { var m = name ? bestMatch(name, us, function (u) { return u.name; }) : null; return m ? m.id : null; });
  }
  function fillDates(def, set) {
    var url = '/case/' + CID + '/defendant/' + def + '/edit-filing-dates/';
    return getDoc(url).then(function (doc) {
      var f = doc.querySelector('form'); var fd = new FormData(f); fd.delete('action'); var changed = [], kept = [];
      Object.keys(set).forEach(function (k) { var cur = (f.querySelector('[name=' + k + ']') || {}).value; if (cur) kept.push(k + ' already ' + cur); else { fd.set(k, set[k]); changed.push(k); } });
      if (!changed.length) return { changed: changed, kept: kept };
      fd.set('submitButton', 'Submit');
      return postForm(url, fd).then(function () { return getDoc(url); }).then(function (d2) {
        var bad = changed.filter(function (k) { return (d2.querySelector('[name=' + k + ']') || {}).value !== set[k]; }); if (bad.length) throw new Error('Date did not stick: ' + bad.join(', '));
        return { changed: changed, kept: kept };
      });
    });
  }
  function setFirm(def, firmId) {
    var url = '/case/' + CID + '/defendant/' + def + '/legal/';
    return getDoc(url).then(function (doc) {
      var s = doc.querySelector('select[name=counsel_law_firm]'); if (!s) throw new Error('Could not open the Legal page.'); if (s.value && s.value !== firmId) return 'kept (already has ' + s.options[s.selectedIndex].text.trim() + ')'; if (s.value === firmId) return 'already set';
      var fd = new FormData(s.form); fd.delete('action'); fd.set('counsel_law_firm', firmId); fd.set('submitButton', 'Submit');
      return postForm(url, fd).then(function () { return getDoc(url); }).then(function (d2) { if (d2.querySelector('select[name=counsel_law_firm]').value !== firmId) throw new Error('Firm did not stick.'); return 'set'; });
    });
  }
  function apply() {
    if (BUSY) return; var P = S.plan, out = S.w.querySelector('#kl-prev'), res = out.querySelector('#kl-res');
    function on(sel) { var c = out.querySelector(sel); return c && c.checked; }
    var evs = P.list.filter(function (x, i) { return !x.lock && !x.saved && on('[data-ev="' + i + '"]'); });
    var ops = P.ops.filter(function (o, i) { return !o.saved && on('[data-op="' + i + '"]'); });
    var tks = (P.tasks || []).filter(function (x, i) { return !x.lock && !x.saved && on('[data-tk="' + i + '"]'); });
    var asg = [].slice.call(out.querySelectorAll('[data-as]')).filter(function (c) { return c.checked; }).map(function (c) { return +c.dataset.as; });
    if (!evs.length && !ops.length && !tks.length) { res.innerHTML = '<div class="kl-err">Nothing is ticked.</div>'; return; }
    if (evs.length && !asg.length) { res.innerHTML = '<div class="kl-err">Pick at least one person to assign.</div>'; return; }
    setAssignees(asg); BUSY = true; out.querySelector('#kl-apply').disabled = true; res.innerHTML = '<div class="kl-mute">Saving…</div>';
    var stamp = 'KAL Lit ' + VERSION + ' ' + fmt(today()) + '.';
    var note = (S.doc ? 'Source: ' + S.doc.name + ' (doc ' + S.doc.id + '). ' : '') + (P.extraNote ? P.extraNote + ' ' : '') + 'Added by ' + stamp;
    var log = [], seq = events(CID).then(function (fresh) {
      // check again right before saving: someone else may have added it
      S.ev = fresh;
      evs = evs.filter(function (x) {
        if (x.moveFrom) return true;
        var hit = exactDupe(x.desc, x.date) || (x === P.mainEv && P.hre && sameKindOn(P.hre, x.date));
        if (hit) { lock(x, 'already on calendar (added by someone else just now)'); log.push(['ok', fmt(x.date) + ' ' + x.desc + ' — already on the calendar, not added again']); }
        return !hit;
      });
    });
    ops.forEach(function (o) {
      seq = seq.then(function () {
        return (o.op === 'dates' ? fillDates(o.def, o.set).then(function (r) { o.saved = true; log.push(['ok', o.label + (r.changed.length ? ' — saved' : '') + (r.kept.length ? ' (kept: ' + r.kept.join('; ') + ')' : '')]); })
          : setFirm(o.def, o.firm).then(function (r) { o.saved = true; log.push(['ok', o.label + ' — ' + r]); }));
      }).catch(function (e) { log.push(['bad', o.label + ' — ' + e.message]); });
    });
    evs.forEach(function (x) {
      seq = seq.then(function () {
        if (x.moveFrom) return moveEvent(CID, x.moveFrom.id, x.date, 'Moved from ' + fmt(evDate(x.moveFrom)) + ' because the ' + P.moved.label + ' moved to ' + fmt(P.mainEv.date) + '. ' + stamp).then(function () { x.saved = true; x.notes.push('moved from ' + fmt(evDate(x.moveFrom))); log.push(['ok', fmt(x.date) + ' ' + x.desc + ' — moved from ' + fmt(evDate(x.moveFrom)) + ' and checked']); });
        return saveEvent(x, asg, note).then(function () { x.pending = true; });
      }).catch(function (e) { log.push(['bad', fmt(x.date) + ' ' + x.desc + ' — not saved: ' + e.message]); });
    });
    tks.forEach(function (x) { seq = seq.then(function () { return saveTask(x).then(function () { x.pending = true; }); }).catch(function (e) { log.push(['bad', 'Task ' + x.text + ' — not saved: ' + e.message]); }); });
    seq.then(function () { return tks.some(function (x) { return x.pending; }) ? tasksAll(CID) : []; }).then(function (all) {
      tks.forEach(function (x) { if (!x.pending) return; x.pending = false; var hit = all.some(function (t) { return norm(taskText(t)) === norm(x.text) && t.task_due_date === fmt(x.due); }); if (hit) { x.saved = true; log.push(['ok', 'Task ' + fmt(x.due) + ' ' + x.text + ' — saved and checked']); } else log.push(['bad', 'Task ' + fmt(x.due) + ' ' + x.text + ' — not found after saving']); });
      return events(CID);
    }).then(function (after) {
      S.ev = after;
      evs.forEach(function (x) { if (!x.pending) return; x.pending = false; if (exactDupe(x.desc, x.date)) { x.saved = true; log.push(['ok', fmt(x.date) + ' ' + x.desc + ' — saved and checked']); } else log.push(['bad', fmt(x.date) + ' ' + x.desc + ' — not found on the calendar after saving']); });
      return litAll(true).then(function (lit) { var c = lit.filter(function (k) { return String(k.case_id) === String(CID); })[0]; if (c) { S.c = c; S.defs = c.case_defendants || []; } });
    }).catch(function (e) { log.push(['bad', e.message]); }).then(function () {
      BUSY = false; if (FROM_ALL) ALL.probs = null; P.tries = (P.tries || 0) + 1; P.log = log;
      renderPlan(); renderDocs();
    });
  }
  function nextDoc(msgEl) {
    var un = (S.inbox || []).filter(function (x) { return !(S.skip || {})[x.id]; });
    if (un.length) { openCard(un[0].id); var c = body.querySelector('#kl-card'); if (c) c.scrollIntoView({ behavior: 'smooth' }); return; }
    var done = processedIds(), cut = addDays(today(), -NEW_DAYS);
    var nx = (S.docs || []).filter(function (d) { return !done[d.id] && (pd(d.created) || 0) >= cut && !(S.doc && d.id === S.doc.id); })[0];
    if (nx) { var sel = body.querySelector('#kl-doc'); if (sel && sel.querySelector('option[value="' + nx.id + '"]')) sel.value = nx.id; readDoc(nx.id); var w = body.querySelector('#kl-docs'); if (w) w.scrollIntoView({ behavior: 'smooth' }); return; }
    if (msgEl) msgEl.innerHTML = '<div class="kl-note">No more new documents in this case.</div>';
  }

  tab(CID ? 'case' : 'all');
})();
