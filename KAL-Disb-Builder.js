/* KAL Disbursement Builder — bookmarklet payload. v1.3-pilot (2026-09-30)
   Source of truth: OneDrive/Documents/Claude Skills/CONTEXT/Tools/KAL Skill Builder/KAL-Disb-Builder.js
   Served from: https://maguilar714.github.io/kal-ops/KAL-Disb-Builder.js
   Design decisions and reasoning: KAL-Disb-Builder-BUILD-LOG.md (same folder).
   Read-only: GET requests to CasePeer only. Contains no secrets and no client data. */
/* ===== DOCX GENERATOR (no external libraries) =====
   Builds a minimal .docx (Office Open XML) and zips it with a tiny
   "stored" (uncompressed) zip writer. Word opens stored zips fine.
   Why no library: CasePeer pages may block outside scripts, and the
   firm's existing tools avoid dependencies (see build log D16). */
var KDOCX = (function(){
  // ---- CRC32 + stored ZIP ----
  var CRC = (function(){ var t=[],c; for(var n=0;n<256;n++){c=n;for(var k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c>>>0;} return t; })();
  function crc32(b){ var c=0xFFFFFFFF; for(var i=0;i<b.length;i++) c=CRC[(c^b[i])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
  function utf8(s){ return new TextEncoder().encode(s); }
  function zip(files){ // files: [{name, data:string}]
    var parts=[], central=[], offset=0;
    files.forEach(function(f){
      var name=utf8(f.name), data=utf8(f.data), crc=crc32(data);
      var h=new DataView(new ArrayBuffer(30));
      h.setUint32(0,0x04034b50,true); h.setUint16(4,20,true); h.setUint16(6,0x0800,true); h.setUint16(8,0,true);
      h.setUint16(10,0,true); h.setUint16(12,0x21,true); h.setUint32(14,crc,true);
      h.setUint32(18,data.length,true); h.setUint32(22,data.length,true); h.setUint16(26,name.length,true); h.setUint16(28,0,true);
      parts.push(new Uint8Array(h.buffer),name,data);
      var c=new DataView(new ArrayBuffer(46));
      c.setUint32(0,0x02014b50,true); c.setUint16(4,20,true); c.setUint16(6,20,true); c.setUint16(8,0x0800,true); c.setUint16(10,0,true);
      c.setUint16(12,0,true); c.setUint16(14,0x21,true); c.setUint32(16,crc,true); c.setUint32(20,data.length,true); c.setUint32(24,data.length,true);
      c.setUint16(28,name.length,true); c.setUint16(30,0,true); c.setUint16(32,0,true); c.setUint16(34,0,true); c.setUint16(36,0,true);
      c.setUint32(38,0,true); c.setUint32(42,offset,true);
      central.push(new Uint8Array(c.buffer),name);
      offset+=30+name.length+data.length;
    });
    var csize=central.reduce(function(s,a){return s+a.length;},0);
    var e=new DataView(new ArrayBuffer(22));
    e.setUint32(0,0x06054b50,true); e.setUint16(8,files.length,true); e.setUint16(10,files.length,true);
    e.setUint32(12,csize,true); e.setUint32(16,offset,true);
    var all=parts.concat(central,[new Uint8Array(e.buffer)]);
    var total=all.reduce(function(s,a){return s+a.length;},0), out=new Uint8Array(total), p=0;
    all.forEach(function(a){out.set(a,p);p+=a.length;});
    return out;
  }

  // ---- XML helpers ----
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function run(text,o){ o=o||{}; var rp='';
    if(o.b) rp+='<w:b/>'; if(o.u) rp+='<w:u w:val="single"/>';
    var parts=String(text).split('\t'), x='';
    parts.forEach(function(t,i){ if(i) x+='<w:tab/>'; x+='<w:t xml:space="preserve">'+esc(t)+'</w:t>'; });
    return '<w:r>'+(rp?'<w:rPr>'+rp+'</w:rPr>':'')+x+'</w:r>'; }
  function para(runs,o){ o=o||{}; var pp='';
    if(o.align) pp+='<w:jc w:val="'+o.align+'"/>';
    pp+='<w:spacing w:before="'+(o.before||0)+'" w:after="'+(o.after==null?0:o.after)+'"/>';
    if(o.indent) pp+='<w:ind w:left="'+o.indent+'"'+(o.hanging?' w:hanging="'+o.hanging+'"':'')+'/>';
    if(o.tabs) pp+='<w:tabs>'+o.tabs.map(function(t){return '<w:tab w:val="left" w:pos="'+t+'"/>';}).join('')+'</w:tabs>';
    var body=Array.isArray(runs)?runs.join(''):String(runs==null?'':runs); if(body && body.indexOf('<w:r')!==0) body=run(body);
    return '<w:p><w:pPr>'+pp+'</w:pPr>'+body+'</w:p>'; }
  function cell(paras,w,noTop,noBot){ var bd=(noTop?'<w:top w:val="nil"/>':'')+(noBot?'<w:bottom w:val="nil"/>':'');
    return '<w:tc><w:tcPr><w:tcW w:w="'+w+'" w:type="dxa"/>'+(bd?'<w:tcBorders>'+bd+'</w:tcBorders>':'')+'</w:tcPr>'+(paras.length?paras.join(''):para(''))+'</w:tc>'; }
  function row(l,r,noTop,noBot){ return '<w:tr><w:trPr><w:cantSplit/></w:trPr>'+cell(l,4315,noTop,noBot)+cell(r,4315,noTop,noBot)+'</w:tr>'; }

  var TXT = {
    es: { title:'AUTORIZACIÓN DE DISTRIBUCIÓN Y PAGO FINAL', client:'NOMBRE DEL CLIENTE:', dol:'FECHA DE INCIDENTE:',
      gross:'MONTO TOTAL RECUPERADO:', fee:'HONORARIOS DE ABOGADO:', feeStd:'HONORARIOS DE ABOGADO (1/3):',
      kal:'KAL LAW, APC', prior:'Abogado anterior', costs:'GASTOS ADELANTADOS:', meds:'SALDOS MÉDICOS:',
      misc:'OTROS GRAVÁMENES:', adv:'ADELANTOS DE ACUERDO:', trust:'RETENIDO EN FIDEICOMISO:',
      total:'TOTAL:', net:'TOTAL PAGADO AL CLIENTE:', none:'N/A',
      reduced:function(a,o){return a+' (Reducido desde '+o+')';}, hiPaid:function(o){return 'Pagado por seguro médico (Originalmente '+o+')';},
      p1:'Este documento refleja el pago final de su caso. Al firmar abajo, confirma que está de acuerdo y autoriza a KAL LAW, APC a hacer los pagos correspondientes.',
      p2:'Responsabilidad por Saldos Pendientes: Todas las cuentas médicas y costos conocidos se han incluido en este pago final. Si después surgiera alguna factura o reclamación no proporcionada previamente a KAL LAW, APC, seguirá bajo su responsabilidad.',
      p2lead:null, date:'Fecha', pend:' (pendiente)',
      hhaLead:'Acuerdo de Exención de Responsabilidad (Hold Harmless Agreement) – Facturas Médicas Pendientes: ',
      hha1:'KAL LAW, APC no pagará de su acuerdo a los proveedores de la lista. Usted es responsable de pagarles.',
      hha2:'Si alguno de estos proveedores le pide el pago a KAL LAW, APC, usted se encargará de pagarlo. Al firmar abajo, usted acepta este Acuerdo de Exención de Responsabilidad. KAL LAW, APC no es responsable por estas facturas.' },
    en: { title:'SETTLEMENT DISBURSEMENT AUTHORIZATION', client:'CLIENT NAME:', dol:'DATE OF LOSS:',
      gross:'TOTAL AMOUNT RECOVERED:', fee:'ATTORNEY FEE:', feeStd:'ATTORNEY FEE (1/3):',
      kal:'KAL LAW, APC', prior:'Prior attorney', costs:'COSTS ADVANCED BY ATTORNEY:', meds:'LIENS (DEDUCTIONS):',
      misc:'OTHER LIENS:', adv:'SETTLEMENT ADVANCES:', trust:'HELD IN TRUST:',
      total:'TOTAL:', net:'TOTAL PAID TO CLIENT:', none:'N/A',
      reduced:function(a,o){return a+' (Reduced from '+o+')';}, hiPaid:function(o){return 'Paid by health insurance (Originally '+o+')';},
      p1:'This document represents the full and final disbursement of settlement funds related to your case. By signing below, you approve and authorize KAL LAW, APC to distribute the settlement funds as outlined above.',
      p2:'To the best of our knowledge, all known medical bills and costs have been included in this disbursement after a diligent review.  If any additional bills or claims appear later that were not previously provided to KAL LAW, APC, those would remain your responsibility.',
      p2lead:'Responsibility for Outstanding Balances: ', date:'Date', pend:' (pending)',
      hhaLead:'Hold Harmless Agreement – Unpaid Medical Bills: ',
      hha1:'KAL LAW, APC will not pay the providers listed below from your settlement. You are responsible for paying them.',
      hha2:'If any of these providers asks KAL LAW, APC for payment, you agree to take care of it. By signing below, you agree to this Hold Harmless Agreement. KAL LAW, APC is not responsible for these bills.' }
  };
  var LETTERS='abcdefghijklmnopqrstuvwxyz';
  function money(n){ return '$'+Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }

  // d = disbursement lines computed by the checker (see buildDisbursement in main file)
  function documentXml(d, lang, o){
    o=o||{}; var T=TXT[lang], b=[];
    var draft=!!o.draft;
    if(draft){ // D34: draft banner; signature lines removed so a draft can't be signed by mistake
      d=Object.assign({},d,{meds:d.medsDraft||d.meds, medsTotal:d.medsDraftTotal!=null?d.medsDraftTotal:d.medsTotal, medsOriginal:d.medsDraftOriginal!=null?d.medsDraftOriginal:d.medsOriginal, net:d.netDraft!=null?d.netDraft:d.net});
      b.push(para(run('BORRADOR / DRAFT – NOT FOR SIGNATURE',{b:1}),{align:'center',after:120}));
    }
    b.push(para(run(T.title,{b:1,u:1}),{align:'center',after:240}));
    var rows=[];
    rows.push(row([para(T.client)],[para(d.clientName)]));
    rows.push(row([para(T.dol)],[para(d.dol)]));
    rows.push(row([para(T.gross)],[para(money(d.gross))]));
    // Fee (with prior-attorney split if any — see D11)
    var feeL=[para(d.feeReduced?T.fee:T.feeStd)], feeR=[para(money(d.feeTotal))];
    if(d.priorAtty && d.priorAtty.length){
      feeL.push(para('    '+T.kal)); feeR.push(para(money(d.feeKal)));
      d.priorAtty.forEach(function(p){ feeL.push(para('    '+T.prior+' ('+p.payee+')')); feeR.push(para(money(p.amount))); });
    }
    rows.push(row(feeL,feeR));
    function listRow(label, items, fmt, total){
      // One table row per item (borders between them hidden) so a long payee
      // name that wraps never pushes amounts out of line with their names.
      if(!items.length) return row([para(label)],[para(T.none)]);
      var out=[row([para(label)],[para('')],false,true)];
      items.forEach(function(it,i){ out.push(row([para(LETTERS[i%26]+'.\t'+it.payee,{indent:720,hanging:360})],[para(fmt(it))],true,true)); });
      out.push(row([para(T.total,{before:120})],[para(total,{before:120})],true,false));
      return out.join('');
    }
    rows.push(listRow(T.costs, d.costs, function(c){return money(c.amount);}, money(d.costsTotal)));
    var medFmt=function(m){
      if(m.pending) return money(m.amount)+T.pend;
      if(m.hiPaidOnly) return T.hiPaid(money(m.original));
      if(m.original>m.amount+0.004) return T.reduced(money(m.amount), money(m.original));
      return money(m.amount); };
    rows.push(listRow(T.meds, d.meds, medFmt,
      d.medsOriginal>d.medsTotal+0.004 ? T.reduced(money(d.medsTotal),money(d.medsOriginal)) : money(d.medsTotal)));
    if(d.misc.length) rows.push(listRow(T.misc, d.misc, function(c){return money(c.amount);}, money(d.miscTotal)));
    if(d.advances.length) rows.push(listRow(T.adv, d.advances, function(c){return money(c.amount);}, money(d.advTotal)));
    if(d.trust.length) rows.push(listRow(T.trust, d.trust, function(c){return money(c.amount);}, money(d.trustTotal)));
    rows.push(row([para(run(T.net,{b:1}))],[para(run(money(d.net),{b:1}))]));
    var border='<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>';
    b.push('<w:tbl><w:tblPr><w:tblW w:w="8630" w:type="dxa"/><w:tblBorders>'+border+'</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4315"/><w:gridCol w:w="4315"/></w:tblGrid>'+rows.join('')+'</w:tbl>');
    b.push(para('',{after:120}));
    b.push(para(run(T.p1),{align:'both',after:240}));
    b.push(para((T.p2lead?run(T.p2lead,{b:1}):'')+run(T.p2),{align:'both',after:240}));
    // Hold Harmless Agreement (D29): wording approved by Moises 2026-09-30.
    if(d.hha && d.hha.length){
      b.push(para(run(T.hhaLead,{b:1})+run(T.hha1),{align:'both',after:120}));
      d.hha.forEach(function(x,i){ b.push(para(run(LETTERS[i%26]+'.\t'+x.payee+' — '+money(x.amount)),{indent:720,hanging:360,after:0})); });
      b.push(para(run(T.hha2),{align:'both',before:120,after:240}));
    }
    (d.extraParas||[]).forEach(function(p){ b.push(para(run(p),{align:'both',after:240})); });
    if(draft){
      b.push(para(run('Open items / Pendientes:',{b:1}),{before:240}));
      (o.openItems||[]).forEach(function(t){ b.push(para(run('• '+t),{indent:360})); });
    } else {
      b.push(para('',{before:480}));
      b.push(para(run('__________________________\t__________________________'),{tabs:[4680]}));
      b.push(para(run(T.date+'\t'+d.clientName),{tabs:[4680]}));
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+b.join('')+
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="1800" w:bottom="1440" w:left="1800" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>';
  }
  var STYLES='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>';
  function build(d, lang, o){
    return zip([
      {name:'[Content_Types].xml', data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'},
      {name:'_rels/.rels', data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'},
      {name:'word/_rels/document.xml.rels', data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'},
      {name:'word/document.xml', data:documentXml(d,lang,o)},
      {name:'word/styles.xml', data:STYLES}
    ]);
  }
  return { build:build, money:money, documentXml:documentXml };
})();


/* ===== READER + CHECKS =====
   Reads one CasePeer case (header, Settlement, Treatment JSON, Costs,
   Documents) using the user's own CasePeer session, then runs the checks.
   Read-only: only GET requests. Never reads the SSN field in the header. */
var KCORE = (function(){
  var APPROVERS_FEE = ['Mark Thiry','Moises Aguilar','Kevin Kunde'];                                   // D9
  var APPROVERS_ATTY = ['Mark Thiry','Moises Aguilar','Kevin Kunde','Kausar Sarwari','Bianca Salcedo']; // D10

  function T(s){ return String(s==null?'':s).replace(/ /g,' ').replace(/\s+/g,' ').trim(); }
  function num(s){ if(s==null) return null; var m=String(s).replace(/,/g,'').match(/-?\d+(\.\d+)?/); return m?parseFloat(m[0]):null; }
  function r2(n){ return Math.round((n+Number.EPSILON)*100)/100; }
  function eq(a,b){ return Math.abs((a||0)-(b||0))<0.005; }
  function money(n){ return '$'+Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function get(url){ return fetch(url,{credentials:'include'}).then(function(r){
    if(/\/login\//.test(r.url)) throw new Error('CasePeer session expired — log in again, then re-run.');
    if(!r.ok) throw new Error('Could not load '+url+' ('+r.status+')'); return r.text(); }); }
  function getJSON(url){ return get(url).then(function(t){ return JSON.parse(t); }); }
  function parse(h){ return new DOMParser().parseFromString(h,'text/html'); }
  function norm(s){ return T(s).toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\b(inc|llc|md|m d|dc|pc|apc|corp|group|medical|center|the)\b/g,' ').replace(/\s+/g,' ').trim(); }

  // ---------- table helpers ----------
  function rowsOf(doc,id){ var t=doc.getElementById(id); if(!t) return null;
    return Array.prototype.slice.call(t.querySelectorAll('tbody tr')).map(function(tr){
      var cells=Array.prototype.slice.call(tr.cells).map(function(td){return T(td.textContent);});
      var opts=cells[cells.length-1]||'';
      var hid=tr.querySelector('input[type=hidden][name$="-id"]');
      return { cells:cells, accepted:/\bUnaccept\b/.test(opts), notAccepted:/(^|\s)Accept(\s|$)/.test(opts) && !/\bUnaccept\b/.test(opts), lienId: hid?hid.value:null };
    }); }
  // Amount cell looks like "- $ 2,248.92" or "- $" (blank)
  function amt(s){ var v=num(String(s).replace(/^-\s*\$?/,'')); return v==null?null:Math.abs(v); }

  // ---------- readers ----------
  function readHeader(doc){
    var hdr=doc.getElementById('client-info-header'); if(!hdr) throw new Error('This page does not look like a CasePeer case.');
    var title=T((hdr.querySelector('.panel-title')||{}).textContent);
    var m=title.match(/^(.*?)\s*-\s*DOL\s*(\d{2}\/\d{2}\/\d{4})/);
    var info=hdr.querySelector('.panel-body span'); var infoTxt='';
    if(info){ var c=info.cloneNode(true); Array.prototype.forEach.call(c.querySelectorAll('input,.client-ssn'),function(e){e.remove();}); infoTxt=T(c.textContent); }
    var parts=infoTxt.split('|').map(T);
    var dob=(infoTxt.match(/\b(\d{2}\/\d{2}\/\d{4})\b/)||[])[1]||'';
    var age=num((infoTxt.match(/Age\s*(\d+)/)||[])[1]);
    var lang=parts.indexOf('Spanish')>=0?'es':'en';
    var flags=Array.prototype.map.call(hdr.querySelectorAll('.red'),function(e){return T(e.textContent);}).filter(Boolean);
    var lastFirst=m?T(m[1]):title; var nm=lastFirst.split(',');
    var clientName=nm.length>1?T(nm.slice(1).join(','))+' '+T(nm[0]):lastFirst;
    return { caseTitle:title, lastFirst:lastFirst, clientName:clientName, dol:m?m[2]:'', dob:dob, age:age, lang:lang, flags:flags };
  }
  function readSummary(doc){ var o={};
    Array.prototype.forEach.call(doc.querySelectorAll('.borderbox'),function(b){ var k=T((b.querySelector('strong')||{}).textContent).toLowerCase(); var v=num(T((b.querySelector('span')||{}).textContent).replace(/[^\d.,-]/g,' ')); if(k) o[k]=v; });
    return { projected:o['projected'], deposited:o['deposited'], liensCosts:o['liens & costs'], net:o['net to client'] }; }
  function sectionTotal(doc,label){ var r=null; Array.prototype.forEach.call(doc.querySelectorAll('.negotiationsitemrow'),function(row){
      var n=T((row.querySelector('.negotiationsitem')||{}).textContent); if(n.indexOf(label)===0){ var s=row.querySelectorAll('strong'); var v=amt(T(s[s.length-1].textContent)); r=v; } }); return r; }
  function readDemands(doc){
    var blocks=Array.prototype.filter.call(doc.querySelectorAll('div[class]'),function(d){return /Demands Summary/.test(d.className);});
    return blocks.map(function(b){
      var txt=T(b.textContent); var fl=txt.match(/Fee Logic\s*(.*?)\s*\|\s*Amount\s*(\S+)/);
      var tbl=b.parentElement.querySelector('table'); var offers=[];
      if(tbl) Array.prototype.forEach.call(tbl.querySelectorAll('tbody tr'),function(tr){
        var c=Array.prototype.map.call(tr.cells,function(td){return T(td.textContent);});
        offers.push({ date:c[0], note:c[1], status:c[2], amount:num(c[3]), accepted:/accepted/i.test(tr.getAttribute('data-name')||'')||/accepted|deposited/i.test(c[2]||'') }); });
      var acc=offers.filter(function(o){return o.accepted;});
      return { label:T(txt.split('Fee Logic')[0]), feeLogic:fl?T(fl[1]):'', feeAmount:fl?num(fl[2]):null, offers:offers, accepted:acc,
        amount:acc.length?acc[0].amount:null, deposited:acc.some(function(o){return /deposited/i.test(o.status);}), feesTaken:acc.some(function(o){return /fees taken/i.test(o.status);}) };
    }); }
  function readTreatment(html){
    var m=html.match(/window\.HEALTH_LIENS_DATA\s*=\s*JSON\.parse\("((?:[^"\\]|\\.)*)"\)/);
    if(!m) return null;
    try{ return JSON.parse(JSON.parse('"'+m[1]+'"')).map(function(x){ var d=(x.contact&&x.contact.details)||{};
      var lh=x.lien_holder; var lhName=lh?(typeof lh==='string'?lh:((lh.details&&(lh.details.company||lh.details.displayname))||lh.company||lh.displayname||'')):'';
      // Payee + mailing address for Kevin's email (D35): lien holder first, else provider; billing address first, else physical.
      function addrOf(det){ var a=(det&&det.addresses)||{}; var pick=[a.billing,a.physical].filter(function(z){return z&&z.street1;})[0];
        return { payee:T((a.billing&&a.billing.payee)||(a.physical&&a.physical.payee)||''), address: pick?T([pick.street1,pick.street2].filter(Boolean).join(', '))+', '+T(pick.city+', '+pick.state+' '+pick.zipcode):'' }; }
      var lhDet=(lh&&typeof lh==='object')?(lh.details||lh):null; var pa=lhDet?addrOf(lhDet):addrOf(d);
      var payTo=pa.payee||(lhDet?T(lhDet.company||lhName):T(d.company||d.displayname||''));
      return { id:String(x.id), provider:T(d.company||d.displayname||''), lienHolder:T(lhName), payTo:payTo, payAddress:pa.address, kind:x.kind, accepted:!!x.accepted, removed:!!x.removed,
        original:num(x.original_cost), final:num(x.final_cost), hiPaid:num(x.health_insurance_paid), stillOwed:num(x.still_owed),
        billing:x.billing_state, records:x.records_state }; }); }catch(e){ return null; } }
  function readCosts(doc){ var out=[];
    Array.prototype.forEach.call(doc.querySelectorAll('table tbody tr'),function(tr){ if(tr.cells.length<9) return;
      var payee=T((tr.cells[1].querySelector('strong')||tr.cells[1]).textContent);
      out.push({ payee:payee, memo:T(tr.cells[2].textContent), invoice:T(tr.cells[3].textContent), requested:T(tr.cells[4].textContent), paid:T(tr.cells[5].textContent), paidBy:T(tr.cells[6].textContent), amount:amt(tr.cells[7].textContent)||0 }); });
    return out; }
  function readLienAgreements(caseId){
    return getJSON('/api/v1/case/case-documents/'+caseId+'/?page_size=200').then(function(r){
      var s=(r.results||[]).find(function(x){return x.file_type==='Folder' && /^settlement$/i.test(T(x.docname));});
      if(!s) return {folder:false, files:[]};
      return getJSON('/api/v1/case/case-documents/'+caseId+'/?page_size=200&folder_id='+s.id).then(function(r2){
        var la=(r2.results||[]).find(function(x){return x.file_type==='Folder' && /lien\s*agreement/i.test(x.docname);});
        if(!la) return {folder:false, files:[]};
        return getJSON('/api/v1/case/case-documents/'+caseId+'/?page_size=200&folder_id='+la.id).then(function(r3){
          return {folder:true, files:(r3.results||[]).map(function(x){return T(x.docname);})}; }); }); }).catch(function(){ return {folder:null, files:[]}; }); }
  // Companion cases (same DOL, "+N" in case name): used only to spot a cost billed to both.
  function readCompanions(caseId, dol){
    if(!dol) return Promise.resolve([]);
    var eps=['/api/v1/case/disbursement-overview/','/api/v1/case/lien-negotiations-overview/'];
    return Promise.all(eps.map(function(e){ return getJSON(e+'?page_size=200').catch(function(){return {results:[]};}); })).then(function(rs){
      var seen={}, list=[]; rs.forEach(function(r){ (r.results||[]).forEach(function(x){ if(String(x.id)!==String(caseId) && x._casename && x._casename.indexOf(dol)>=0 && !seen[x.id]){ seen[x.id]=1; list.push(x); } }); });
      return Promise.all(list.slice(0,4).map(function(x){ return get('/case/'+x.id+'/costs/').then(function(h){ return {id:x.id, name:x._casename, costs:readCosts(parse(h))}; }).catch(function(){return null;}); }));
    }).then(function(a){ return a.filter(Boolean); }); }

  function read(caseId){
    var base='/case/'+caseId+'/';
    return Promise.all([ get(base+'settlement/negotiations/'), get(base+'medical/treatment/'), get(base+'costs/') ]).then(function(h){
      var sd=parse(h[0]), cd=parse(h[2]);
      var header=readHeader(sd);
      var c={ caseId:String(caseId), header:header, summary:readSummary(sd), demands:readDemands(sd),
        medpayTotal:sectionTotal(sd,'Medpay / PIP Proceeds'), costsSettlement:sectionTotal(sd,'Costs'), feesSection:sectionTotal(sd,'Settlement Fees'),
        medTable:rowsOf(sd,'dataTableHealthLiensSettlementNego')||[], hiTable:rowsOf(sd,'dataTableHealthInsLiensSettlementNego')||[],
        attyTable:rowsOf(sd,'dataTableAttorneyLiensSettlementNego')||[], miscTable:rowsOf(sd,'dataTableMiscLiensSettlementNego')||[],
        advTable:rowsOf(sd,'dataTableAdvanceSettlementNego')||[],
        treatment:readTreatment(h[1]), costs:readCosts(cd) };
      return Promise.all([ readLienAgreements(caseId), readCompanions(caseId, header.dol) ]).then(function(x){ c.agreements=x[0]; c.companions=x[1]; return c; });
    }); }

  // ---------- model + checks ----------
  // opts: { fee:number|null, feeApprover, attyApprover, priorAttyNoLien:bool, priorAttyApprover, trust:[{payee,amount}] }
  function evaluate(c, opts){
    opts=opts||{}; var B=[], W=[], P=[];
    function block(msg,fix,tab){ B.push({msg:msg,fix:fix,tab:tab}); }
    function warn(msg,fix,tab){ W.push({msg:msg,fix:fix,tab:tab}); }
    function pass(msg){ P.push({msg:msg}); }
    var h=c.header, tm={}; (c.treatment||[]).forEach(function(l){tm[l.id]=l;});

    // Client info
    if(!h.clientName||!h.dol) block('Client name or date of loss missing from the case header.','Fix the case index in CasePeer.','edit-case');
    else pass('Client: '+h.clientName+' · DOL '+h.dol);
    if(h.age!=null && h.age<18) warn('Client is a minor (age '+h.age+'). Minor settlements need court approval before disbursing.',null,null);
    var otherFlags=h.flags.filter(function(f){return !/PRIOR ATTY/i.test(f);}); if(otherFlags.length) warn('Case notes in red on the header: '+otherFlags.map(function(f){return '"'+f+'"';}).join('; '),null,null);

    // Settlement amount
    var acc=[]; c.demands.forEach(function(d){ d.accepted.forEach(function(o){ acc.push({demand:d,offer:o}); }); });
    var gross=r2(acc.reduce(function(s,a){return s+(a.offer.amount||0);},0));
    if(!acc.length || !gross) block('No accepted settlement offer found.','Accept the offer on the Settlement tab.','settlement/negotiations');
    else pass('Settlement '+money(gross)+(acc.length>1?' ('+acc.length+' accepted offers)':''));
    if(c.medpayTotal) block('MedPay/PIP proceeds ('+money(c.medpayTotal)+') are on this case. The builder does not handle MedPay yet — build this one manually.',null,'settlement/negotiations');
    if(gross && c.summary.deposited!=null && c.summary.deposited < gross-0.005) warn('Settlement check not fully deposited yet ('+money(c.summary.deposited)+' of '+money(gross)+').',null,null);
    else if(gross) pass('Settlement deposited');

    // Fee (D8, D9)
    var feeStd=r2(gross/3), casepeerFee=null;
    c.demands.forEach(function(d){ if(d.accepted.length && /dollar/i.test(d.feeLogic) && d.feeAmount!=null) casepeerFee=(casepeerFee||0)+d.feeAmount; });
    if(c.feesSection) casepeerFee=c.feesSection; // fees already taken in CasePeer win
    var feeTotal = opts.fee!=null ? r2(opts.fee) : (casepeerFee!=null ? r2(casepeerFee) : feeStd);
    var feeReduced = !eq(feeTotal,feeStd);
    if(feeReduced && feeTotal>feeStd) block('Fee '+money(feeTotal)+' is MORE than 1/3 ('+money(feeStd)+').','Fix the fee.',null);
    else if(feeReduced && !opts.feeApprover) block('Fee reduced to '+money(feeTotal)+' (1/3 = '+money(feeStd)+'). Pick who approved the reduction.','Choose Mark, Moises, or Kevin below.',null);
    else if(feeReduced) pass('Fee reduced to '+money(feeTotal)+' — approved by '+opts.feeApprover);
    else pass('Fee 1/3 = '+money(feeStd));
    if(c.feesSection) warn('Fees were already taken in CasePeer on this case ('+money(c.feesSection)+').',null,null);

    // Attorney liens (D10, D11)
    var atty=[]; c.attyTable.forEach(function(r){ var a=amt(r.cells[2]); var o=amt(r.cells[1]);
      if(!r.accepted||a==null) block('Attorney lien "'+r.cells[0]+'" is not finalized.','Accept it with the final amount on the Settlement tab.','settlement/negotiations');
      else atty.push({payee:r.cells[0], amount:a, original:o}); });
    var attyTotal=r2(atty.reduce(function(s,x){return s+x.amount;},0));
    var priorFlag=h.flags.some(function(f){return /PRIOR ATTY/i.test(f);});
    if(priorFlag && !c.attyTable.length && !opts.priorAttyNoLien) block('Case is flagged PRIOR ATTY. but has no attorney lien.','Add the prior attorney\'s lien in CasePeer, or confirm below that there is no lien.','settlement/negotiations');
    if(priorFlag && !c.attyTable.length && opts.priorAttyNoLien && !opts.priorAttyApprover) block('Confirmed no prior-attorney lien — pick who approved.',null,null);
    if(atty.length && !opts.attyApprover) block('Attorney lien total '+money(attyTotal)+' needs an approver.','Choose the approver below.',null);
    if(atty.length && opts.attyApprover) pass('Attorney lien '+money(attyTotal)+' — approved by '+opts.attyApprover+' (paid from KAL\'s fee)');
    if(attyTotal>feeTotal) block('Attorney liens ('+money(attyTotal)+') are larger than the fee ('+money(feeTotal)+').',null,null);
    var feeKal=r2(feeTotal-attyTotal);

    // Medical bills
    var meds=[], omitted=[], draftMeds=[], hha=[], hhaIds={}; (opts.hhaIds||[]).forEach(function(id){hhaIds[id]=1;});
    c.medTable.forEach(function(r){
      var t=tm[r.lienId]||{}; var name=t.provider||r.cells[0]; var orig=num(r.cells[1]); var a=amt(r.cells[10]);
      var hiPaid=num(r.cells[4])||t.hiPaid||0;
      if(/place\s*holder/i.test(r.cells[0]) || (!orig && !a)){ omitted.push(name); return; }
      var owed=num(r.cells[7]); if(owed==null) owed=(t.stillOwed!=null?t.stillOwed:orig);
      if(!r.accepted){
        // D33: an unaccepted provider can be moved to the Hold Harmless list (client pays directly).
        if(hhaIds[r.lienId]){ hha.push({payee:name, amount:r2(owed||orig||0), original:orig||0, lienId:r.lienId}); return; }
        B.push({msg:name+': lien not accepted / still pending.', fix:'Finalize and accept it on the Settlement tab — or, if the client will pay this provider directly, check the box.', tab:'settlement/negotiations', hhaId:r.lienId, hhaName:name, hhaAmount:r2(owed||orig||0)});
        draftMeds.push({payee:name, original:orig||0, amount:(a!=null?a:(owed||orig||0)), pending:true}); return; }
      if(a==null){ block(name+': no final amount entered.','Enter the final amount on the Settlement tab.','settlement/negotiations'); draftMeds.push({payee:name, original:orig||0, amount:owed||orig||0, pending:true}); return; }
      if(!orig && a>0){ block(name+': '+money(a)+' with no original bill amount.','Enter the original bill on the Medical Treatment tab.','medical/treatment'); return; }
      if(orig>0 && a>orig*0.7+0.005 && a>0) warn(name+': reduced only '+Math.round((1-a/orig)*100)+'% ('+money(orig)+' → '+money(a)+').',null,null);
      meds.push({ payee:name, lienHolder:t.lienHolder||'', payTo:t.payTo||name, payAddress:t.payAddress||'', original:orig||0, amount:a, hiPaidOnly:(a===0 && hiPaid>0) });
    });
    if(omitted.length) warn('Left off the document (blank or placeholder lines with no bill and $0): '+omitted.join(', ')+'.','Remove them from the case if they don\'t belong.','settlement/negotiations');
    // Providers on the Treatment tab that never made it to the Settlement tab (W2)
    if(c.treatment){ var inSet={}; c.medTable.forEach(function(r){ if(r.lienId) inSet[r.lienId]=1; });
      c.treatment.forEach(function(l){ if(!l.removed && l.kind!=='prior' && !inSet[l.id]) warn('Provider on the Treatment tab is not on the Settlement tab: '+l.provider+(l.original?' ('+money(l.original)+')':'')+'.','Add it to the settlement or remove it from the case.','medical/treatment'); });
    } else warn('Could not read the Medical Treatment tab, so providers were not cross-checked.',null,null);

    // Health insurance liens
    c.hiTable.forEach(function(r){ var name=r.cells[0]; if(/no insurance checked/i.test(name)) return;
      var o=amt(r.cells[1]), a=amt(r.cells[3]);
      if(!a && !o){ warn(name+' is listed as health insurance with no amount. Confirm there is no lien and save the no-lien letter.','Remove it, or enter the final lien.','settlement/negotiations'); return; }
      if(!r.accepted){ block(name+' health insurance lien is not accepted.','Accept the final lien on the Settlement tab.','settlement/negotiations'); return; }
      meds.push({ payee:name, payTo:name, payAddress:'', original:o||a||0, amount:a||0, isHI:true }); });

    // Addresses for Kevin's email (D35) — one warning per payee CasePeer has no address for.
    var noAddr={}; meds.forEach(function(m){ if(m.amount>0 && !m.payAddress) (noAddr[m.payTo]=noAddr[m.payTo]||[]).push(m.payee); });
    Object.keys(noAddr).forEach(function(p){ warn('No mailing address in CasePeer for '+p+(noAddr[p].join(', ')!==p?' (pays '+noAddr[p].join(', ')+')':'')+'. Kevin\'s email will say [ADDRESS NEEDED].','Add the address to the contact in CasePeer so it fills in next time.',null); });
    // Misc liens + advances (child support, loans)
    var misc=[], adv=[];
    c.miscTable.forEach(function(r){ var a=amt(r.cells[2]);
      if(!r.accepted||a==null) block('Lien "'+r.cells[0]+'" is not finalized.','Accept it with the final amount (enter $0 if released).','settlement/negotiations');
      else if(a>0) misc.push({payee:r.cells[0], amount:a}); });
    c.advTable.forEach(function(r){ var a=amt(r.cells[5]);
      if(!r.accepted||a==null) block('Settlement advance "'+r.cells[0]+'" is not finalized.','Accept the payoff amount on the Settlement tab.','settlement/negotiations');
      else if(a>0) adv.push({payee:r.cells[0], amount:a}); });
    if(misc.length||adv.length) pass('Other liens/advances included: '+misc.concat(adv).map(function(x){return x.payee+' '+money(x.amount);}).join(', '));

    // Costs
    var costSum=r2(c.costs.reduce(function(s,x){return s+x.amount;},0));
    if(c.costsSettlement!=null && !eq(costSum,c.costsSettlement)) block('Costs don\'t match: Costs tab adds up to '+money(costSum)+', Settlement tab shows '+money(c.costsSettlement)+'.','Update Running Costs on the Settlement tab, or fix the Costs tab.','costs');
    else pass('Costs '+money(costSum)+' ('+c.costs.length+' items)');
    c.costs.forEach(function(x){ if(/unknown/i.test(x.payee+' '+x.memo)) warn('Cost "'+x.payee+'" '+money(x.amount)+' — payee/memo says "unknown".','Fix the cost entry.','costs'); });
    // Reference numbers live in Invoice or in the memo (e.g. "REQ-20662217").
    function refs(x){ var r=[]; if(x.invoice && !/^n\/?a$/i.test(x.invoice)) r.push(x.invoice.toUpperCase());
      (String(x.memo).match(/REQ-?\d{5,}|\b\d{6,}\b/gi)||[]).forEach(function(t){ r.push(t.toUpperCase().replace('REQ','REQ-').replace('REQ--','REQ-')); }); return r; }
    var inv={}; c.costs.forEach(function(x){ refs(x).forEach(function(k){ (inv[k]=inv[k]||[]).push(x); }); });
    Object.keys(inv).forEach(function(k){ if(inv[k].length>1) warn('Reference '+k+' appears '+inv[k].length+' times in this case\'s costs.','Check for a double charge.','costs'); });
    (c.companions||[]).forEach(function(cp){ cp.costs.forEach(function(y){
      if(/split cost/i.test(y.memo)) return; var ry=refs(y);
      c.costs.forEach(function(x){ if(/split cost/i.test(x.memo) || !eq(x.amount,y.amount)) return;
        var shared=refs(x).filter(function(k){return ry.indexOf(k)>=0;});
        if(shared.length) warn('Cost '+x.payee+' '+money(x.amount)+' ('+shared[0]+') is also charged on companion case '+cp.name+'.','Split it, or remove it from one case.','costs'); }); }); });
    var costsGrouped=[], gi={}; c.costs.forEach(function(x){ var k=norm(x.payee)||x.payee; if(!gi[k]){ gi[k]={payee:x.payee, amount:0}; costsGrouped.push(gi[k]); } gi[k].amount=r2(gi[k].amount+x.amount); });

    // Lien agreements on file
    if(c.agreements && c.agreements.folder===false) warn('No "Lien Agreements" folder under Settlement documents. Save each reduction agreement there.',null,'documents/2/sort/0');
    else if(c.agreements && c.agreements.folder){ meds.forEach(function(m){ if(m.isHI||!m.amount) return; var n=norm(m.payee).split(' ')[0]; var lh=norm(m.lienHolder||'').split(' ')[0];
        var hit=c.agreements.files.some(function(f){ var nf=norm(f); return (n && nf.indexOf(n)>=0) || (lh && nf.indexOf(lh)>=0); });
        if(!hit) warn('No agreement in "Lien Agreements" that matches '+m.payee+'.','Upload the reduction agreement.','documents/2/sort/0'); }); }

    // Held in trust (D13)
    // D29/D33: Hold Harmless providers are NOT deducted — the client pays them directly.
    if(hha.length) warn('Hold Harmless Agreement added — client pays directly: '+hha.map(function(x){return x.payee+' '+money(x.amount);}).join(', ')+'. Reviewer: confirm.',null,null);
    var trust=(opts.trust||[]).filter(function(t){return t.payee && t.amount>0;}).map(function(t){return {payee:t.payee, amount:r2(t.amount)};});

    // Totals + completeness check against CasePeer's own box
    var medsTotal=r2(meds.reduce(function(s,m){return s+m.amount;},0));
    var medsOriginal=r2(meds.reduce(function(s,m){return s+(m.original||m.amount);},0));
    var miscTotal=r2(misc.reduce(function(s,x){return s+x.amount;},0)), advTotal=r2(adv.reduce(function(s,x){return s+x.amount;},0)), trustTotal=r2(trust.reduce(function(s,x){return s+x.amount;},0));
    var net=r2(gross-feeTotal-costSum-medsTotal-miscTotal-advTotal-trustTotal);
    // Draft mode (D34): includes pending lines at their current amount so the negotiator can see where the case stands.
    var medsDraft=meds.concat(draftMeds), medsDraftTotal=r2(medsDraft.reduce(function(s,m){return s+m.amount;},0));
    var medsDraftOriginal=r2(medsDraft.reduce(function(s,m){return s+(m.original||m.amount);},0));
    var netDraft=r2(gross-feeTotal-costSum-medsDraftTotal-miscTotal-advTotal-trustTotal);
    // CasePeer's box counts unaccepted lines at their original bill, so Hold Harmless lines are added back here (verified on Ibarra 2026-09-30).
    var hhaOrig=r2(hha.reduce(function(s,x){return s+(x.original||0);},0));
    var cpDeductions=r2((c.costsSettlement||0)+medsTotal+miscTotal+advTotal+attyTotal+hhaOrig);
    if(c.summary.liensCosts!=null && !eq(cpDeductions,c.summary.liensCosts) && !B.length)
      block('The builder could not account for every CasePeer deduction (CasePeer "liens & costs" '+money(c.summary.liensCosts)+' vs '+money(cpDeductions)+' found). Build this one manually and tell Moises.',null,'settlement/negotiations');
    if(gross && net<0) block('Client net is negative ('+money(net)+').',null,null);
    else if(gross) pass('Math ties — net to client '+money(net));

    var d={ clientName:h.clientName, dol:h.dol, gross:gross, feeTotal:feeTotal, feeStd:feeStd, feeReduced:feeReduced, feeKal:feeKal, priorAtty:atty,
      costs:costsGrouped, costsTotal:costSum, meds:meds, medsTotal:medsTotal, medsOriginal:medsOriginal,
      misc:misc, miscTotal:miscTotal, advances:adv, advTotal:advTotal, trust:trust, trustTotal:trustTotal, hha:hha, net:net, medsDraft:medsDraft, medsDraftTotal:medsDraftTotal, medsDraftOriginal:medsDraftOriginal, netDraft:netDraft, extraParas:[] };
    return { blocking:B, warnings:W, passed:P, disb:d, lang:h.lang };
  }
  // ---------- Kevin payment email (D35) ----------
  function buildEmail(c, R){
    var d=R.disb, h=c.header, NA='[ADDRESS NEEDED]', who=h.lastFirst, memo='Memo: '+who+' – DOB '+(h.dob||'[DOB]');
    var checks=d.meds.filter(function(m){return m.amount>0;}), zero=d.meds.filter(function(m){return !m.amount;});
    var others=[].concat(d.priorAtty.map(function(x){return {label:x.payee+' (prior attorney lien)', payTo:x.payee, amount:x.amount};}),
      d.misc.map(function(x){return {label:x.payee, payTo:x.payee, amount:x.amount};}), d.advances.map(function(x){return {label:x.payee+' (settlement advance)', payTo:x.payee, amount:x.amount};}));
    var medsPaid=r2(checks.reduce(function(s,m){return s+m.amount;},0));
    var rows=[['Settlement',money(d.gross)],['Attorney fee'+(d.feeReduced?' (reduced)':' (1/3)')+' – KAL Law, APC',money(d.feeKal)]];
    d.priorAtty.forEach(function(x){ rows.push(['Prior attorney – '+x.payee, money(x.amount)]); });
    rows.push(['Costs reimbursed – KAL Law, APC',money(d.costsTotal)],['Medical providers ('+checks.length+' check'+(checks.length===1?'':'s')+')',money(medsPaid)]);
    d.misc.forEach(function(x){ rows.push([x.payee, money(x.amount)]); }); d.advances.forEach(function(x){ rows.push([x.payee, money(x.amount)]); });
    if(d.trustTotal) rows.push(['Held in trust', money(d.trustTotal)]);
    rows.push(['Client',money(d.net)],['Total',money(r2(d.feeTotal+d.costsTotal+medsPaid+d.miscTotal+d.advTotal+d.trustTotal+d.net))]);
    var T=[], H=[];
    function both(t,hh){ T.push(t); H.push(hh==null?'<p>'+esc(t)+'</p>':hh); }
    function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    var subject='Disbursement Payment – '+who;
    both('Hello Kevin,'); both('Here are the payments for the '+who+' case. The client\'s signed disbursement and the settlement check are attached.');
    T.push(''); T.push('SUMMARY'); rows.forEach(function(r){ T.push(r[0]+': '+r[1]); });
    H.push('<p><b>Summary</b></p><table border="1" cellpadding="4" style="border-collapse:collapse">'+rows.map(function(r,i){return '<tr><td>'+esc(r[0])+'</td><td align="right">'+(i===rows.length-1?'<b>':'')+esc(r[1])+(i===rows.length-1?'</b>':'')+'</td></tr>';}).join('')+'</table>');
    T.push(''); T.push('PROVIDER PAYMENTS'); H.push('<p><b>Provider payments</b></p>');
    checks.concat(others).forEach(function(m){
      var label=m.label||m.payee; var addr=m.payAddress||NA;
      T.push(label+': '+money(m.amount)); T.push('Make check payable to: '+(m.payTo||label)); T.push(addr); T.push(memo); T.push('——————————————');
      H.push('<p><b>'+esc(label)+': '+esc(money(m.amount))+'</b><br>Make check payable to: '+esc(m.payTo||label)+'<br>'+(addr===NA?'<span style="background:#ff0">'+NA+'</span>':esc(addr))+'<br>'+esc(memo)+'</p><p>——————————————</p>'); });
    if(zero.length) both('No payment (reduced to $0.00): '+zero.map(function(m){return m.payee;}).join(', ')+'.');
    if(d.hha && d.hha.length) both('Client pays directly (Hold Harmless Agreement signed): '+d.hha.map(function(x){return x.payee+' '+money(x.amount);}).join(', ')+'.');
    if(d.trust.length) both('Held in trust: '+d.trust.map(function(x){return x.payee+' '+money(x.amount);}).join(', ')+'.');
    T.push(''); both('Thank you,');
    var head='To: Kevin Kunde | CC: Bianca Salcedo; Kausar Sarwari | BCC: '+c.caseId+'@bcc.casepeer.com\nSubject: '+subject+'\nAttach: signed disbursement + settlement check\n\n';
    return { subject:subject, text:head+T.join('\n'), html:H.join(''), missing:(T.join('\n').match(/\[ADDRESS NEEDED\]/g)||[]).length };
  }
  return { read:read, evaluate:evaluate, buildEmail:buildEmail, money:money, APPROVERS_FEE:APPROVERS_FEE, APPROVERS_ATTY:APPROVERS_ATTY };
})();


/* ===== PANEL UI =====
   A panel that slides in over the CasePeer case page. Uses a Shadow DOM so
   CasePeer's styles can't break it and it can't break CasePeer. */
(function(){
  var VERSION='1.3-pilot (2026-09-30)';
  var m=location.pathname.match(/\/case\/(\d+)\//);
  var old=document.getElementById('kal-disb-builder-host'); if(old) old.remove();
  var host=document.createElement('div'); host.id='kal-disb-builder-host';
  host.style.cssText='position:fixed;top:0;right:0;height:100vh;width:480px;max-width:100vw;z-index:2147483000;';
  document.body.appendChild(host);
  var root=host.attachShadow({mode:'open'});
  var CSS='*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}'+
    '.p{height:100%;background:#fff;border-left:1px solid #d0d5dd;box-shadow:-8px 0 24px rgba(0,0,0,.15);display:flex;flex-direction:column;color:#1d2433;font-size:13px}'+
    '.hd{background:#004d40;color:#fff;padding:12px 14px;display:flex;justify-content:space-between;align-items:flex-start}'+
    '.hd b{font-size:14px;letter-spacing:.3px}.hd .s{font-size:12px;opacity:.85;margin-top:2px}.x{background:none;border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1}'+
    '.bd{flex:1;overflow:auto;padding:12px 14px}.ft{border-top:1px solid #e4e7ec;padding:10px 14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}'+
    '.sec{margin-bottom:14px}.sec h4{margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.5px}'+
    '.it{padding:6px 8px;border-radius:6px;margin-bottom:4px;line-height:1.35}.it .f{font-size:12px;opacity:.85;margin-top:2px}'+
    '.bl{background:#fdecea;border-left:3px solid #c62828}.wa{background:#fff6e0;border-left:3px solid #e0a100}.ok{background:#eef7ee;border-left:3px solid #2e7d32}'+
    'a{color:#00695c}.btn{border:1px solid #00695c;background:#00695c;color:#fff;border-radius:6px;padding:7px 12px;cursor:pointer;font-size:13px}'+
    '.btn.sec2{background:#fff;color:#00695c}.btn[disabled]{opacity:.4;cursor:not-allowed}'+
    'table{width:100%;border-collapse:collapse;font-size:12px}td{padding:3px 4px;border-bottom:1px solid #f0f2f5;vertical-align:top}td.r{text-align:right;white-space:nowrap}tr.t td{font-weight:700;border-top:1px solid #98a2b3}'+
    '.box{border:1px solid #e4e7ec;border-radius:8px;padding:8px 10px;margin-bottom:10px}label{display:block;margin:4px 0}select,input[type=text],input[type=number]{font-size:12px;padding:3px 5px;border:1px solid #d0d5dd;border-radius:4px}'+
    '.seg{display:inline-flex;border:1px solid #00695c;border-radius:6px;overflow:hidden}.seg button{border:0;background:#fff;color:#00695c;padding:4px 10px;cursor:pointer}.seg button.on{background:#00695c;color:#fff}'+
    '.mut{color:#667085;font-size:11px}.big{font-size:15px;font-weight:700}.hide{display:none}.tog{cursor:pointer;color:#00695c;font-size:12px}';
  root.innerHTML='<style>'+CSS+'</style><div class="p"><div class="hd"><div><b>KAL DISBURSEMENT BUILDER</b><div class="s" id="cn">…</div></div><button class="x" id="x" title="Close">✕</button></div><div class="bd" id="bd"></div><div class="ft" id="ft"></div></div>';
  var $=function(id){return root.getElementById(id);};
  $('x').onclick=function(){host.remove();};
  var M=KDOCX.money;
  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  if(!m){ $('cn').textContent=''; $('bd').innerHTML='<div class="it wa">Open a case in CasePeer first, then click the bookmark again.</div>'; return; }
  var caseId=m[1], C=null, R=null, lang=null, showPassed=false;
  var opts={ fee:null, feeApprover:'', attyApprover:'', priorAttyNoLien:false, priorAttyApprover:'', trust:[], hhaIds:[] };

  function load(){
    $('bd').innerHTML='<div class="it">Reading CasePeer…<div class="f">Settlement · Treatment · Costs · Documents</div></div>'; $('ft').innerHTML='';
    KCORE.read(caseId).then(function(c){ C=c; if(lang==null) lang=c.header.lang; $('cn').textContent=c.header.caseTitle; render(); })
      .catch(function(e){ $('bd').innerHTML='<div class="it bl">'+esc(e.message)+'</div>'; $('ft').innerHTML='<button class="btn" id="rt">Try again</button>'; $('rt').onclick=load; });
  }
  function tabLink(t){ return t?' <a href="/case/'+caseId+'/'+t+'/" target="_blank">→ Open</a>':''; }
  function items(list,cls){ return list.map(function(x){ return '<div class="it '+cls+'">'+(cls==='bl'?'✗ ':cls==='wa'?'⚠ ':'✓ ')+esc(x.msg)+(x.fix||x.tab?'<div class="f">'+(x.fix?esc(x.fix):'')+tabLink(x.tab)+'</div>':'')+
      (x.hhaId?'<label class="f"><input type="checkbox" data-hha="'+x.hhaId+'"> Client pays directly (Hold Harmless) — '+M(x.hhaAmount)+'</label>':'')+'</div>'; }).join(''); }
  function sel(id,list,val){ return '<select id="'+id+'"><option value="">— approver —</option>'+list.map(function(a){return '<option'+(a===val?' selected':'')+'>'+esc(a)+'</option>';}).join('')+'</select>'; }

  function render(){
    R=KCORE.evaluate(C,opts); var d=R.disb, h=C.header;
    var hasAtty=C.attyTable.length>0, prior=h.flags.some(function(f){return /PRIOR ATTY/i.test(f);});
    var html='';
    html+='<div class="box"><div>Settlement <b>'+M(d.gross)+'</b> · Deposited '+M(C.summary.deposited)+'</div>'+
      '<div class="mut">DOL '+esc(h.dol)+' · '+(h.lang==='es'?'Spanish':'English')+'-speaking client</div></div>';
    // Inputs that change the result
    html+='<div class="box"><b>Attorney fee</b> <span class="mut">(rule: exactly 1/3 = '+M(d.feeStd)+')</span>'+
      '<label><input type="checkbox" id="fr"'+(d.feeReduced?' checked':'')+'> Fee was reduced</label>'+
      '<div id="frb" class="'+(d.feeReduced?'':'hide')+'">New fee $ <input type="number" step="0.01" id="fa" value="'+(d.feeReduced?d.feeTotal:'')+'" style="width:110px"> '+sel('fp',KCORE.APPROVERS_FEE,opts.feeApprover)+'</div>';
    if(hasAtty) html+='<div style="margin-top:6px"><b>Prior attorney lien</b> '+M(d.priorAtty.reduce(function(s,x){return s+x.amount;},0))+' <span class="mut">(comes out of KAL\'s fee)</span><br>Approved by '+sel('ap',KCORE.APPROVERS_ATTY,opts.attyApprover)+'</div>';
    if(prior && !hasAtty) html+='<div style="margin-top:6px"><label><input type="checkbox" id="pn"'+(opts.priorAttyNoLien?' checked':'')+'> Confirmed: prior attorney has <b>no</b> lien</label>'+(opts.priorAttyNoLien?'Approved by '+sel('pa',KCORE.APPROVERS_ATTY,opts.priorAttyApprover):'')+'</div>';
    html+='</div>';
    html+='<div class="box"><b>Held in trust</b> <span class="mut">(optional — money kept back for a pending bill)</span><div id="tr">'+
      opts.trust.map(function(t,i){return '<div style="margin-top:4px"><input type="text" placeholder="Payee" data-i="'+i+'" data-k="payee" value="'+esc(t.payee)+'" style="width:200px"> $ <input type="number" step="0.01" data-i="'+i+'" data-k="amount" value="'+(t.amount||'')+'" style="width:90px"> <a href="#" data-del="'+i+'">remove</a></div>';}).join('')+
      '</div><a href="#" id="ta" class="tog">+ add line</a></div>';
    if(d.hha.length) html+='<div class="box"><b>Hold Harmless Agreement</b> <span class="mut">(client pays directly — not deducted)</span>'+d.hha.map(function(x){return '<div>'+esc(x.payee)+' — '+M(x.amount)+' <a href="#" data-unhha="'+x.lienId+'">undo</a></div>';}).join('')+'</div>';
    // Results
    if(R.blocking.length) html+='<div class="sec"><h4 style="color:#c62828">✗ '+R.blocking.length+' must fix</h4>'+items(R.blocking,'bl')+'</div>';
    if(R.warnings.length) html+='<div class="sec"><h4 style="color:#b07d00">⚠ '+R.warnings.length+' to review</h4>'+items(R.warnings,'wa')+'</div>';
    html+='<div class="sec"><h4 style="color:#2e7d32">✓ '+R.passed.length+' passed <span class="tog" id="sp">'+(showPassed?'hide':'show')+'</span></h4>'+(showPassed?items(R.passed,'ok'):'')+'</div>';
    // Preview
    if(!R.blocking.length){
      html+='<div class="sec"><h4>Preview</h4><table>'+
        '<tr><td>Recovered</td><td class="r">'+M(d.gross)+'</td></tr><tr><td>Attorney fee'+(d.feeReduced?' (reduced)':' (1/3)')+'</td><td class="r">'+M(d.feeTotal)+'</td></tr>'+
        d.priorAtty.map(function(p){return '<tr><td class="mut">&nbsp;&nbsp;of which prior attorney: '+esc(p.payee)+'</td><td class="r mut">'+M(p.amount)+'</td></tr>';}).join('')+
        '<tr><td>Costs ('+d.costs.length+')</td><td class="r">'+M(d.costsTotal)+'</td></tr>'+
        d.meds.map(function(x){return '<tr><td>&nbsp;&nbsp;'+esc(x.payee)+(x.lienHolder&&x.lienHolder!==x.payee?' <span class="mut">('+esc(x.lienHolder)+')</span>':'')+'</td><td class="r">'+M(x.amount)+(x.original>x.amount+0.004?' <span class="mut">of '+M(x.original)+'</span>':'')+'</td></tr>';}).join('')+
        '<tr><td>Medical / liens</td><td class="r">'+M(d.medsTotal)+'</td></tr>'+
        (d.misc.length?'<tr><td>Other liens</td><td class="r">'+M(d.miscTotal)+'</td></tr>':'')+(d.advances.length?'<tr><td>Settlement advances</td><td class="r">'+M(d.advTotal)+'</td></tr>':'')+(d.trust.length?'<tr><td>Held in trust</td><td class="r">'+M(d.trustTotal)+'</td></tr>':'')+
        '<tr class="t"><td>NET TO CLIENT</td><td class="r big">'+M(d.net)+'</td></tr></table></div>';
    }
    html+='<div class="mut">Read-only: this tool never changes anything in CasePeer. v'+VERSION+'</div>';
    $('bd').innerHTML=html;
    $('ft').innerHTML='<span class="seg"><button id="les" class="'+(lang==='es'?'on':'')+'">Español</button><button id="len" class="'+(lang==='en'?'on':'')+'">English</button></span>'+
      '<button class="btn sec2" id="rc" title="Re-read CasePeer after you fix something">Re-check</button>'+
      '<button class="btn" id="bw"'+(R.blocking.length?' disabled title="Fix the red items first"':'')+'>Download Final</button>'+
      '<button class="btn sec2" id="bd2" title="Draft for your own review — marked NOT FOR SIGNATURE, no signature lines">Download Draft</button>'+
      '<button class="btn sec2" id="cr" title="Copy a text summary to paste in Teams">Copy report</button>'+
      '<button class="btn sec2" id="ce"'+(R.blocking.length?' disabled title="Fix the red items first"':'')+' title="Copy Kevin\'s payment email — paste into Outlook">Copy Kevin email</button>';
    wire();
  }
  function wire(){
    var fr=$('fr'); fr.onchange=function(){ if(fr.checked){ $('frb').className=''; } else { opts.fee=R.disb.feeStd; opts.feeApprover=''; render(); } };
    var fa=$('fa'); if(fa) fa.onchange=function(){ var v=parseFloat(fa.value); opts.fee=isNaN(v)?null:v; render(); };
    var fp=$('fp'); if(fp) fp.onchange=function(){ opts.feeApprover=fp.value; render(); };
    var ap=$('ap'); if(ap) ap.onchange=function(){ opts.attyApprover=ap.value; render(); };
    var pn=$('pn'); if(pn) pn.onchange=function(){ opts.priorAttyNoLien=pn.checked; render(); };
    var pa=$('pa'); if(pa) pa.onchange=function(){ opts.priorAttyApprover=pa.value; render(); };
    $('ta').onclick=function(e){ e.preventDefault(); opts.trust.push({payee:'',amount:0}); render(); };
    Array.prototype.forEach.call($('tr').querySelectorAll('input'),function(inp){ inp.onchange=function(){ var t=opts.trust[+inp.getAttribute('data-i')]; var k=inp.getAttribute('data-k'); t[k]=k==='amount'?(parseFloat(inp.value)||0):inp.value; render(); }; });
    Array.prototype.forEach.call($('tr').querySelectorAll('[data-del]'),function(a){ a.onclick=function(e){ e.preventDefault(); opts.trust.splice(+a.getAttribute('data-del'),1); render(); }; });
    Array.prototype.forEach.call(root.querySelectorAll('[data-hha]'),function(cb){ cb.onchange=function(){ var id=cb.getAttribute('data-hha'); if(cb.checked && opts.hhaIds.indexOf(id)<0) opts.hhaIds.push(id); render(); }; });
    Array.prototype.forEach.call(root.querySelectorAll('[data-unhha]'),function(a){ a.onclick=function(e){ e.preventDefault(); var id=a.getAttribute('data-unhha'); opts.hhaIds=opts.hhaIds.filter(function(x){return x!==id;}); render(); }; });
    $('sp').onclick=function(){ showPassed=!showPassed; render(); };
    $('les').onclick=function(){ lang='es'; render(); }; $('len').onclick=function(){ lang='en'; render(); };
    $('rc').onclick=load;
    function dl(draft){
      var bytes=KDOCX.build(R.disb,lang,{draft:draft, openItems:R.blocking.map(function(x){return x.msg;})});
      var blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
      var a=document.createElement('a'); a.href=URL.createObjectURL(blob);
      a.download=(draft?'DRAFT - ':'')+C.header.lastFirst+' - Disbursement ('+(lang==='es'?'ES':'EN')+') '+new Date().toISOString().slice(0,10)+'.docx';
      document.body.appendChild(a); a.click(); setTimeout(function(){URL.revokeObjectURL(a.href); a.remove();},1000); }
    $('bw').onclick=function(){ if(!R.blocking.length) dl(false); };
    $('bd2').onclick=function(){ dl(true); };
    $('ce').onclick=function(){ if(R.blocking.length) return; var e=KCORE.buildEmail(C,R);
      var done=function(){ $('ce').textContent=e.missing?'Copied — '+e.missing+' address'+(e.missing>1?'es':'')+' needed':'Copied ✓'; setTimeout(function(){$('ce').textContent='Copy Kevin email';},2500); };
      var fail=function(){ $('bd').insertAdjacentHTML('afterbegin','<textarea style="width:100%;height:200px">'+esc(e.text)+'</textarea>'); };
      try{ if(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write){
          navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([e.html],{type:'text/html'}),'text/plain':new Blob([e.text],{type:'text/plain'})})]).then(done,function(){ navigator.clipboard.writeText(e.text).then(done,fail); });
        } else navigator.clipboard.writeText(e.text).then(done,fail); }catch(x){ fail(); } };
    $('cr').onclick=function(){ var d=R.disb, L=[];
      L.push('Disbursement check — '+C.header.caseTitle); L.push('Settlement '+M(d.gross)+' | Fee '+M(d.feeTotal)+(d.feeReduced?' (reduced, approved by '+opts.feeApprover+')':' (1/3)')+' | Costs '+M(d.costsTotal)+' | Medical/liens '+M(d.medsTotal)+' | Net to client '+M(d.net));
      if(R.blocking.length){ L.push('MUST FIX:'); R.blocking.forEach(function(x){L.push(' - '+x.msg);}); }
      if(R.warnings.length){ L.push('REVIEW:'); R.warnings.forEach(function(x){L.push(' - '+x.msg);}); }
      L.push('Passed: '+R.passed.length+' checks. (KAL Disbursement Builder v'+VERSION+')');
      var t=L.join('\n'); (navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){ $('cr').textContent='Copied ✓'; setTimeout(function(){$('cr').textContent='Copy report';},1500); },function(){ $('bd').insertAdjacentHTML('afterbegin','<textarea style="width:100%;height:140px">'+esc(t)+'</textarea>'); }); };
  }
  load();
})();
