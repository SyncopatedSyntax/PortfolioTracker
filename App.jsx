import { useState, useEffect, useRef, Fragment } from "react";
import {
  LineChart, Line, PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, ReferenceLine
} from "recharts";

// ── Constants ─────────────────────────────────────────────────────────────────
const BANKS   = ["CIBC","TD","Coast Capital","Questrade","HSBC","Other"];
const ACCTS   = ["TFSA","RRSP","Non-Registered","Chequing","Savings","USD Account","GIC","Other"];
const SECTORS = ["Technology","Finance","Healthcare","Energy","Consumer","Real Estate","Utilities","Materials","Industrials","ETF / Index","Mutual Fund","Bonds","Other"];
const CURS    = ["CAD","USD","HKD"];
const EXCHS   = ["NYSE","NASDAQ","TSX","OTC","Other"];
const PAL     = ["#5cff8c","#5cd4c4","#ffd166","#ff9f5c","#c77dff","#74b8ff","#ff7070","#a8e063","#ffb347","#80cfff"];

const LK  = "inv_lots_v4";
const CK  = "inv_closed_v4";
const NK  = "inv_notes_v4";
const SK  = "inv_snaps_v1";

// ── CSV helpers ───────────────────────────────────────────────────────────────
function parseLine(line) {
  const r = []; let q = false, s = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i+1] === '"') { s += '"'; i++; } else q = !q; }
    else if (c === ',' && !q) { r.push(s.trim()); s = ""; }
    else s += c;
  }
  r.push(s.trim()); return r;
}

function pn(s) {
  if (!s || s === '--' || s === '-' || s === 'N/A') return 0;
  return parseFloat(String(s).replace(/[C$%,+\s]/g, '').replace(/^\((.+)\)$/, '-$1')) || 0;
}

// Convert MM/DD/YYYY → YYYY-MM-DD
function cvtDate(s) {
  if (!s) return '';
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  return s;
}

function exchToCur(ex) { return ex?.toUpperCase() === 'TSX' ? 'CAD' : 'USD'; }
function mkId(t, d, p, sh) { return `${t}|${d}|${p}|${sh}`; }
function normTick(t) {
  return t.replace(/\.O$/, '').replace(/\.K$/, '').replace(/\.PK$/, '')
          .replace(/^BRKb$/, 'BRK-B').replace(/^BRKa$/, 'BRK-A');
}

function parsePortfolioCSV(raw) {
  const text = raw.replace(/^\uFEFF/, '');
  const SECS = { 'Open Positions Summary': 'summary', 'Open Positions': 'open', 'Closed Positions': 'closed' };
  const SKIP = new Set(['Market Value','Open P/L','Daily P/L','Total P/L','Closed P/L']);
  let section = null, headers = null;
  const openRows = [], closedRows = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim(); if (!line) continue;
    const cells = parseLine(line); const c0 = cells[0], c1 = cells[1];
    if (SECS[c0]) { section = SECS[c0]; headers = null; continue; }
    if (SKIP.has(c0)) continue;
    if (c1 === 'Name') { headers = cells; continue; }
    if (!headers || !section || section === 'summary' || !c1) continue;
    const row = {}; cells.forEach((v, i) => { if (headers[i] !== undefined) row[headers[i]] = v; });
    if (!row.Name || !row.Symbol) continue;
    if (section === 'open')   openRows.push(row);
    if (section === 'closed') closedRows.push(row);
  }
  return { openRows, closedRows };
}

function rowToLot(row, bank, acct) {
  const ticker = row.Symbol, ex = row.Exchange;
  const shares = pn(row.Amount), price = pn(row['Open Price']);
  const openDate = cvtDate(row['Open Date'] || '');
  return {
    id: mkId(ticker, openDate, price, shares),
    ticker, name: row.Name, exchange: ex,
    currency: exchToCur(ex), bank, accountType: acct,
    sector: 'ETF / Index', type: row.Type?.toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
    openDate, shares, purchasePrice: price,
    currentPrice: pn(row['Current Price']) || price,
    commission: pn(row.Commission), dividendsReceived: 0,
    isMutualFund: false, lastUpdated: new Date().toISOString(),
  };
}

function rowToClosed(row) {
  const shares = pn(row.Amount), openPrice = pn(row['Open Price']);
  const openDate = cvtDate(row['Open Date'] || '');
  const closeDate = cvtDate(row['Close Date'] || '');
  return {
    id: mkId(row.Symbol, openDate, openPrice, shares) + '_c',
    ticker: row.Symbol, name: row.Name, exchange: row.Exchange,
    currency: exchToCur(row.Exchange),
    type: row.Type?.toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
    openDate, closeDate, shares, openPrice,
    closePrice: pn(row['Close Price']),
    gainPct: pn(row['Gain%']), netPL: pn(row['Net P/L']),
  };
}

// ── Export helpers ────────────────────────────────────────────────────────────
function makeCSV(cols, rows) {
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  return [cols.map(c => esc(c.label)).join(','), ...rows.map(r => cols.map(c => esc(r[c.key])).join(','))].join('\n');
}
function dlCSV(filename, csv) {
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Formatters ────────────────────────────────────────────────────────────────
const fU = x => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(x || 0);
const fC = x => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 }).format(x || 0);
const fF = (x, cur) => cur === 'CAD' ? fC(x) : fU(x);
const fP = x => `${(x || 0) >= 0 ? '+' : ''}${(x || 0).toFixed(2)}%`;
const fN = x => new Intl.NumberFormat('en-CA', { maximumFractionDigits: 4 }).format(x || 0);
const fShort = x => {
  const abs = Math.abs(x || 0);
  const sign = x < 0 ? '-' : '';
  if (abs >= 1e6) return `${sign}$${(abs/1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs/1e3).toFixed(0)}k`;
  return fU(x);
};

const BLK = () => ({
  ticker: '', name: '', exchange: 'NYSE', bank: 'Questrade', accountType: 'TFSA',
  currency: 'USD', sector: 'ETF / Index', type: 'BUY',
  openDate: new Date().toISOString().slice(0, 10),
  shares: '', purchasePrice: '', currentPrice: '', commission: '0',
  dividendsReceived: '0', isMutualFund: false,
});

const TFMT = { contentStyle: { background: '#112011', border: '1px solid #2e5c2e', fontSize: 12, fontFamily: "'DM Mono', monospace", color: '#c8e6c8', borderRadius: 4 }, itemStyle: { color: '#c8e6c8' }, labelStyle: { color: '#5cff8c' } };

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [lots,      setLots     ] = useState([]);
  const [closed,    setClosed   ] = useState([]);
  const [notes,     setNotes    ] = useState({});
  const [snapshots, setSnapshots] = useState([]);
  const [ready,     setReady    ] = useState(false);
  const [tab,       setTab      ] = useState('dashboard');
  const [fBank,     setFBank    ] = useState('All');
  const [fAcct,     setFAcct    ] = useState('All');
  const [exp,       setExp      ] = useState(new Set());
  const [allocView, setAllocView] = useState('sector');
  const [hSort,     setHSort    ] = useState('closeDate');
  const [tfRange,   setTfRange  ] = useState('ALL');
  const [showImp,   setShowImp  ] = useState(false);
  const [impData,   setImpData  ] = useState(null);
  const [iCBank,    setICBank   ] = useState('Questrade');
  const [iCAcct,    setICAcct   ] = useState('TFSA');
  const [iUBank,    setIUBank   ] = useState('Questrade');
  const [iUAcct,    setIUAcct   ] = useState('USD Account');
  const [iMode,     setIMode    ] = useState('merge');
  const [showF,     setShowF    ] = useState(false);
  const [editId,    setEditId   ] = useState(null);
  const [form,      setForm     ] = useState(BLK());
  const [noteFor,   setNoteFor  ] = useState(null);
  const [nForm,     setNForm    ] = useState({ thesis: '', notes: '', targetPrice: '', stopLoss: '', dividendsReceived: '0' });
  const [fetching,  setFetching ] = useState(false);
  const [fetSects,  setFetSects ] = useState(false);
  const [fLog,      setFLog     ] = useState('');
  const [clearConf, setClearConf] = useState(null);
  const [debugLog,  setDebugLog  ] = useState([]);
  const [testRun,   setTestRun   ] = useState(false);
  const fileRef = useRef(null);

  const addLog = (msg, type = 'info') => {
    const ts = new Date().toLocaleTimeString('en-CA', { hour12: false });
    setDebugLog(prev => [...prev.slice(-99), { ts, type, msg: String(msg) }]);
  };

  useEffect(() => {
    (async () => {
      const load = async (key, label, setter) => {
        try {
          const r = await window.storage.get(key);
          if (r && r.value) {
            const parsed = JSON.parse(r.value);
            setter(parsed);
            const count = Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length;
            addLog(`Loaded ${label}: ${count} record(s) from storage`, 'success');
          } else {
            addLog(`No data for ${label} (key: ${key})`, 'info');
          }
        } catch (e) {
          addLog(`Load error [${label}]: ${e.message}`, 'error');
        }
      };
      await load(LK, 'lots',      setLots);
      await load(CK, 'closed',    setClosed);
      await load(NK, 'notes',     setNotes);
      await load(SK, 'snapshots', setSnapshots);
      setReady(true);
    })();
  }, []);

  const storageSave = async (key, label, v) => {
    try {
      const serialized = JSON.stringify(v);
      const result = await window.storage.set(key, serialized);
      if (!result) {
        addLog(`WARN: storage.set(${key}) returned falsy — data may not be persisted!`, 'warn');
        return false;
      }
      return true;
    } catch (e) {
      addLog(`SAVE FAILED [${label}]: ${e.message}`, 'error');
      return false;
    }
  };

  const saveLots      = async v => { setLots(v);      await storageSave(LK, 'lots',      v); };
  const saveClosed    = async v => { setClosed(v);    await storageSave(CK, 'closed',    v); };
  const saveNotes     = async v => { setNotes(v);     await storageSave(NK, 'notes',     v); };
  const saveSnapshots = async v => { setSnapshots(v); await storageSave(SK, 'snapshots', v); };

  const addSnapshot = async (lotsData) => {
    const val  = lotsData.reduce((s, l) => {
      const mkt = l.type === 'BUY' ? l.currentPrice * l.shares : -(l.currentPrice * l.shares);
      return s + mkt;
    }, 0);
    const cost = lotsData.filter(l => l.type === 'BUY').reduce((s, l) => s + l.purchasePrice * l.shares, 0);
    const snap = { date: new Date().toISOString().slice(0, 10), ts: Date.now(), value: +val.toFixed(2), cost: +cost.toFixed(2) };
    const existing = await (async () => { try { const r = await window.storage.get(SK); return r ? JSON.parse(r.value) : []; } catch (_) { return []; } })();
    const filtered = existing.filter(s => s.date !== snap.date);
    const next = [...filtered, snap].slice(-365);
    await saveSnapshots(next);
  };

  // ── Import ────────────────────────────────────────────────────────────────
  const onFile = e => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { try { setImpData(parsePortfolioCSV(ev.target.result)); setShowImp(true); } catch (err) { alert('Parse error: ' + err.message); } };
    reader.readAsText(file, 'utf-8'); e.target.value = '';
  };

  const confirmImport = async () => {
    if (!impData) return;
    const newLots   = impData.openRows.map(row => { const cur = exchToCur(row.Exchange); return rowToLot(row, cur === 'CAD' ? iCBank : iUBank, cur === 'CAD' ? iCAcct : iUAcct); });
    const newClosed = impData.closedRows.map(rowToClosed);
    const finalLots = iMode === 'replace' ? newLots : (() => { const ids = new Set(lots.map(l => l.id)); return [...lots, ...newLots.filter(l => !ids.has(l.id))]; })();
    const cIds = new Set(closed.map(c => c.id));
    await saveLots(finalLots);
    await saveClosed([...closed, ...newClosed.filter(c => !cIds.has(c.id))]);
    await addSnapshot(finalLots);
    setShowImp(false); setImpData(null); setTab('holdings');
  };

  // ── Export ────────────────────────────────────────────────────────────────
  const exportHoldings = () => dlCSV(`holdings_${new Date().toISOString().slice(0,10)}.csv`, makeCSV(
    [{key:'ticker',label:'Ticker'},{key:'name',label:'Name'},{key:'exchange',label:'Exchange'},{key:'currency',label:'Currency'},{key:'bank',label:'Bank'},{key:'accountType',label:'Account Type'},{key:'sector',label:'Sector'},{key:'type',label:'Type'},{key:'openDate',label:'Open Date'},{key:'shares',label:'Shares'},{key:'purchasePrice',label:'Purchase Price'},{key:'currentPrice',label:'Current Price'},{key:'commission',label:'Commission'},{key:'dividendsReceived',label:'Dividends'}], lots));
  const exportHistory = () => dlCSV(`trade_history_${new Date().toISOString().slice(0,10)}.csv`, makeCSV(
    [{key:'ticker',label:'Ticker'},{key:'name',label:'Name'},{key:'type',label:'Type'},{key:'currency',label:'Currency'},{key:'openDate',label:'Open Date'},{key:'closeDate',label:'Close Date'},{key:'shares',label:'Shares'},{key:'openPrice',label:'Open Price'},{key:'closePrice',label:'Close Price'},{key:'gainPct',label:'Gain %'},{key:'netPL',label:'Net P/L'}], closed));
  const exportNotes = () => dlCSV(`notes_${new Date().toISOString().slice(0,10)}.csv`, makeCSV(
    [{key:'ticker',label:'Ticker'},{key:'thesis',label:'Thesis'},{key:'notes',label:'Notes'},{key:'targetPrice',label:'Target Price'},{key:'stopLoss',label:'Stop Loss'},{key:'dividendsReceived',label:'Dividends'}],
    Object.entries(notes).map(([ticker, n]) => ({ ticker, ...n }))));
  const exportAll = () => { exportHoldings(); setTimeout(exportHistory, 300); setTimeout(exportNotes, 600); };

  // ── Price fetch ───────────────────────────────────────────────────────────
  const fetchPrices = async () => {
    const el = lots.filter(l => !l.isMutualFund && l.ticker); if (!el.length) return;
    setFetching(true); setFLog('Fetching prices...');
    try {
      const raw = [...new Set(el.map(l => l.ticker))];
      const withEx = raw.map(t => { const lot = el.find(l => l.ticker === t); return `${normTick(t)} (${lot?.exchange || 'US'})`; });
      addLog(`Fetching prices for: ${raw.join(', ')}`, 'info');
      let res;
      try {
        res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, tools: [{ type: 'web_search_20250305', name: 'web_search' }], messages: [{ role: 'user', content: `Get current market prices for: ${withEx.join(', ')}.\nReturn ONLY raw JSON: {"TICKER":price}. Normalized ticker as key (no exchange suffix). No markdown.` }] })
        });
      } catch (fetchErr) {
        addLog(`Network error (prices): ${fetchErr.constructor.name}: ${fetchErr.message}`, 'error');
        throw fetchErr;
      }
      addLog(`API response status: ${res.status}`, res.ok ? 'info' : 'error');
      if (!res.ok) {
        const errBody = await res.text().catch(() => '(unreadable)');
        addLog(`API error body: ${errBody.slice(0, 300)}`, 'error');
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      const tb = data.content?.find(b => b.type === 'text');
      if (tb) {
        const raw2 = tb.text.replace(/```[\w]*/g, '').replace(/```/g, '').trim();
        addLog(`API price response: ${raw2.slice(0, 200)}`, 'info');
        const pm = JSON.parse(raw2);
        let upd = 0;
        const next = lots.map(l => { const n = normTick(l.ticker); const p = pm[n] ?? pm[n.toUpperCase()]; if (p != null) { upd++; return { ...l, currentPrice: p, lastUpdated: new Date().toISOString() }; } return l; });
        await saveLots(next);
        await addSnapshot(next);
        setFLog(`Updated ${upd}/${raw.length} prices — ${new Date().toLocaleTimeString()}`);
        addLog(`Prices updated: ${upd}/${raw.length} tickers`, 'success');
      } else {
        addLog(`No text block in API response. Content: ${JSON.stringify(data.content).slice(0,200)}`, 'warn');
      }
    } catch (e) { setFLog(`Error: ${e.message}`); addLog(`fetchPrices error: ${e.message}`, 'error'); }
    setFetching(false);
  };

  // ── Sector fetch ──────────────────────────────────────────────────────────
  const fetchSectors = async () => {
    if (!lots.length) return;
    setFetSects(true); setFLog('Fetching sectors...');
    try {
      const tickers = [...new Set(lots.map(l => normTick(l.ticker)))];
      addLog(`Fetching sectors for: ${tickers.join(', ')}`, 'info');
      let res;
      try {
        res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, tools: [{ type: 'web_search_20250305', name: 'web_search' }], messages: [{ role: 'user', content: `For each of these stock/ETF tickers, identify its market sector.\nTickers: ${tickers.join(', ')}\nUse ONLY these sector values: Technology, Finance, Healthcare, Energy, Consumer, Real Estate, Utilities, Materials, Industrials, ETF / Index, Bonds, Other\nReturn ONLY raw JSON: {"TICKER":"Sector"}. No markdown, no explanation.` }] })
        });
      } catch (fetchErr) {
        addLog(`Network error (sectors): ${fetchErr.constructor.name}: ${fetchErr.message}`, 'error');
        throw fetchErr;
      }
      addLog(`Sectors API status: ${res.status}`, res.ok ? 'info' : 'error');
      if (!res.ok) {
        const errBody = await res.text().catch(() => '(unreadable)');
        addLog(`Sectors API error: ${errBody.slice(0, 300)}`, 'error');
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      const tb = data.content?.find(b => b.type === 'text');
      if (tb) {
        const raw = tb.text.replace(/```[\w]*/g, '').replace(/```/g, '').trim();
        addLog(`Sectors response: ${raw.slice(0, 200)}`, 'info');
        const sm = JSON.parse(raw);
        const next = lots.map(l => { const n = normTick(l.ticker); const s = sm[n] ?? sm[n.toUpperCase()]; return s ? { ...l, sector: s } : l; });
        await saveLots(next);
        setFLog(`Sectors updated — ${new Date().toLocaleTimeString()}`);
        addLog(`Sectors updated for ${Object.keys(sm).length} tickers`, 'success');
      } else {
        addLog(`No text block in sectors response. Content: ${JSON.stringify(data.content).slice(0,200)}`, 'warn');
      }
    } catch (e) { setFLog(`Sector error: ${e.message}`); addLog(`fetchSectors error: ${e.message}`, 'error'); }
    setFetSects(false);
  };

  // ── Lot form ──────────────────────────────────────────────────────────────
  const openAdd  = () => { setForm(BLK()); setEditId(null); setShowF(true); };
  const openEdit = lot => {
    setForm({ ticker: lot.ticker, name: lot.name, exchange: lot.exchange, bank: lot.bank, accountType: lot.accountType, currency: lot.currency, sector: lot.sector, type: lot.type, openDate: lot.openDate, shares: String(lot.shares), purchasePrice: String(lot.purchasePrice), currentPrice: String(lot.currentPrice), commission: String(lot.commission || 0), dividendsReceived: String(lot.dividendsReceived || 0), isMutualFund: !!lot.isMutualFund });
    setEditId(lot.id); setShowF(true);
  };
  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const N  = s => parseFloat(s) || 0;
  const submitLot = async () => {
    const shares = N(form.shares), price = N(form.purchasePrice);
    const lot = { id: editId || mkId(form.ticker.toUpperCase(), form.openDate, price, shares), ticker: form.ticker.trim().toUpperCase(), name: form.name.trim(), exchange: form.exchange, bank: form.bank, accountType: form.accountType, currency: form.currency, sector: form.sector, type: form.type, openDate: form.openDate, shares, purchasePrice: price, currentPrice: N(form.currentPrice) || price, commission: N(form.commission), dividendsReceived: N(form.dividendsReceived), isMutualFund: form.isMutualFund, lastUpdated: new Date().toISOString() };
    const next = editId ? lots.map(l => l.id === editId ? lot : l) : [...lots, lot];
    await saveLots(next);
    setShowF(false); setEditId(null);
  };
  const delLot = async id => { if (!confirm('Delete this lot?')) return; await saveLots(lots.filter(l => l.id !== id)); };

  // ── Notes ─────────────────────────────────────────────────────────────────
  const openNote = ticker => {
    const n = notes[ticker] || {};
    setNForm({ thesis: n.thesis || '', notes: n.notes || '', targetPrice: String(n.targetPrice || ''), stopLoss: String(n.stopLoss || ''), dividendsReceived: String(n.dividendsReceived || 0) });
    setNoteFor(ticker);
  };
  const submitNote = async () => {
    await saveNotes({ ...notes, [noteFor]: { thesis: nForm.thesis, notes: nForm.notes, targetPrice: parseFloat(nForm.targetPrice) || 0, stopLoss: parseFloat(nForm.stopLoss) || 0, dividendsReceived: parseFloat(nForm.dividendsReceived) || 0 } });
    setNoteFor(null);
  };

  // ── Debug functions ─────────────────────────────────────────────────────────
  const runStorageTest = async () => {
    setTestRun(true);
    addLog('─── Storage diagnostic started ───', 'info');
    const testKey = 'debug_test_' + Date.now();
    const testVal = 'ping_' + Math.random().toString(36).slice(2);
    // Write test
    try {
      const wr = await window.storage.set(testKey, testVal);
      if (!wr) { addLog('WRITE: storage.set returned falsy (failure)', 'error'); }
      else { addLog('WRITE: OK', 'success'); }
    } catch (e) { addLog(`WRITE error: ${e.message}`, 'error'); }
    // Read test
    try {
      const rr = await window.storage.get(testKey);
      if (!rr)                    { addLog('READ: key not found after write!', 'error'); }
      else if (rr.value !== testVal) { addLog(`READ MISMATCH: wrote "${testVal}", got "${rr.value}"`, 'error'); }
      else                        { addLog('READ: OK — value matches', 'success'); }
    } catch (e) { addLog(`READ error: ${e.message}`, 'error'); }
    // Delete test
    try { await window.storage.delete(testKey); addLog('DELETE: OK', 'success'); } catch (e) { addLog(`DELETE error: ${e.message}`, 'error'); }
    // Check actual data keys
    for (const [key, label] of [[LK,'lots'],[CK,'closed'],[NK,'notes'],[SK,'snapshots']]) {
      try {
        const r = await window.storage.get(key);
        if (r && r.value) { addLog(`Key "${key}" (${label}): ${r.value.length} bytes found`, 'success'); }
        else              { addLog(`Key "${key}" (${label}): NOT FOUND in storage`, 'warn'); }
      } catch (e) { addLog(`Key "${key}" (${label}): ERROR — ${e.message}`, 'error'); }
    }
    addLog('─── Storage diagnostic done ───', 'info');
    setTestRun(false);
  };

  const runAPITest = async () => {
    setTestRun(true);
    addLog('─── API connectivity test started ───', 'info');
    addLog(`Fetching: https://api.anthropic.com/v1/messages`, 'info');
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 20, messages: [{ role: 'user', content: 'Reply with just the word OK.' }] })
      });
      addLog(`Response status: ${res.status} ${res.statusText}`, res.ok ? 'success' : 'error');
      const body = await res.text();
      addLog(`Response body (first 400 chars): ${body.slice(0, 400)}`, res.ok ? 'success' : 'error');
      if (res.ok) {
        try {
          const j = JSON.parse(body);
          addLog(`Parsed OK. Content: ${JSON.stringify(j.content)}`, 'success');
        } catch(_) { addLog('Body is not valid JSON', 'warn'); }
      }
    } catch (e) {
      addLog(`fetch() threw: ${e.constructor.name}: ${e.message}`, 'error');
      if (e.cause) addLog(`Cause: ${JSON.stringify(e.cause)}`, 'error');
    }
    addLog('─── API test done ───', 'info');
    setTestRun(false);
  };

  const copyDebug = () => {
    const storeSizes = [
      `${LK} (lots): ${JSON.stringify(lots).length} bytes, ${lots.length} records`,
      `${CK} (closed): ${JSON.stringify(closed).length} bytes, ${closed.length} records`,
      `${NK} (notes): ${JSON.stringify(notes).length} bytes, ${Object.keys(notes).length} tickers`,
      `${SK} (snapshots): ${JSON.stringify(snapshots).length} bytes, ${snapshots.length} entries`,
    ];
    const lines = [
      `=== Portfolio Tracker Debug Report ===`,
      `Date: ${new Date().toISOString()}`,
      `UserAgent: ${navigator.userAgent}`,
      ``,
      `=== Storage State ===`,
      ...storeSizes,
      ``,
      `=== Event Log ===`,
      ...debugLog.map(e => `[${e.ts}] [${e.type.toUpperCase()}] ${e.msg}`),
    ];
    navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
    addLog('Debug info copied to clipboard', 'success');
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const filtered = lots.filter(l => (fBank === 'All' || l.bank === fBank) && (fAcct === 'All' || l.accountType === fAcct));
  const groups = {};
  filtered.forEach(l => { if (!groups[l.ticker]) groups[l.ticker] = { ticker: l.ticker, name: l.name, currency: l.currency, lots: [] }; groups[l.ticker].lots.push(l); });

  const tGroups = Object.values(groups).map(g => {
    const buys  = g.lots.filter(l => l.type === 'BUY');
    const sells = g.lots.filter(l => l.type === 'SELL');
    const buyShares = buys.reduce((s, l) => s + l.shares, 0);
    const buyCost   = buys.reduce((s, l) => s + l.purchasePrice * l.shares, 0);
    const buyMkt    = buys.reduce((s, l) => s + l.currentPrice  * l.shares, 0);
    const sellCost  = sells.reduce((s, l) => s + l.purchasePrice * l.shares, 0);
    const sellMkt   = sells.reduce((s, l) => s + l.currentPrice  * l.shares, 0);
    const unrealGL  = (buyMkt - buyCost) + (sellCost - sellMkt);
    const mktValue  = buyMkt - sellMkt;
    const n         = notes[g.ticker] || {};
    const tickDiv   = (n.dividendsReceived || 0) + g.lots.reduce((s, l) => s + (l.dividendsReceived || 0), 0);
    const totalRet  = buyCost > 0 ? (unrealGL + tickDiv) / buyCost * 100 : 0;
    const avgCost   = buyShares > 0 ? buyCost / buyShares : 0;
    const newest    = g.lots.slice().sort((a, b) => (b.lastUpdated || '').localeCompare(a.lastUpdated || ''))[0];
    const latestPx  = newest?.currentPrice || 0;
    const comm      = g.lots.reduce((s, l) => s + (l.commission || 0), 0);
    const sector    = g.lots[0]?.sector || 'Other';
    return { ...g, buys, sells, buyCost, mktValue, unrealGL, tickDiv, totalRet, avgCost, latestPx, n, comm, sector };
  });

  const totMkt  = tGroups.reduce((s, g) => s + g.mktValue, 0);
  const totCost = tGroups.reduce((s, g) => s + g.buyCost, 0);
  const totDiv  = tGroups.reduce((s, g) => s + g.tickDiv, 0);
  const totUGL  = tGroups.reduce((s, g) => s + g.unrealGL, 0);
  const totRet  = totCost > 0 ? (totUGL + totDiv) / totCost * 100 : 0;
  const totReal = closed.reduce((s, c) => s + c.netPL, 0);
  const totComm = [...lots, ...closed].reduce((s, x) => s + (x.commission || 0), 0);

  // Allocation
  const allocData = (() => {
    const m = {};
    tGroups.forEach(g => {
      const k = allocView === 'sector' ? (g.sector || 'Other') : `${g.lots[0]?.bank} · ${g.lots[0]?.accountType}`;
      m[k] = (m[k] || 0) + g.mktValue;
    });
    return Object.entries(m).map(([name, value]) => ({ name, value: +value.toFixed(2) })).sort((a, b) => b.value - a.value);
  })();

  // Sector return %
  const sectorRetData = (() => {
    const m = {};
    tGroups.forEach(g => {
      if (!m[g.sector]) m[g.sector] = { gl: 0, cost: 0 };
      m[g.sector].gl   += g.unrealGL;
      m[g.sector].cost += g.buyCost;
    });
    return Object.entries(m)
      .map(([name, { gl, cost }]) => ({ name, ret: cost > 0 ? +(gl / cost * 100).toFixed(2) : 0 }))
      .sort((a, b) => b.ret - a.ret);
  })();

  // CAD vs USD exposure
  const currencyData = (() => {
    const m = {};
    tGroups.forEach(g => { m[g.currency] = (m[g.currency] || 0) + g.mktValue; });
    return Object.entries(m).map(([name, value]) => ({ name, value: +value.toFixed(2) }));
  })();

  // Monthly realized P/L (last 18 months)
  const monthlyPL = (() => {
    const m = {};
    closed.forEach(c => {
      const mo = c.closeDate?.slice(0, 7); if (!mo) return;
      m[mo] = (m[mo] || 0) + c.netPL;
    });
    return Object.entries(m).map(([month, pl]) => ({ month, pl: +pl.toFixed(2) })).sort((a, b) => a.month.localeCompare(b.month)).slice(-18);
  })();

  // Performance timeline
  const tfDays = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365, 'ALL': 99999 };
  const timelineData = (() => {
    const cutoff = new Date(Date.now() - tfDays[tfRange] * 86400000);
    const filtered = snapshots.filter(s => new Date(s.date) >= cutoff);
    if (!filtered.length && snapshots.length) return snapshots.slice(-2);
    return filtered;
  })();

  // Alerts
  const alerts = tGroups.filter(g => (g.n.targetPrice > 0 && g.latestPx >= g.n.targetPrice) || (g.n.stopLoss > 0 && g.latestPx <= g.n.stopLoss && g.latestPx > 0));

  // Trade history stats
  const wins     = closed.filter(c => c.netPL > 0).length;
  const winRate  = closed.length > 0 ? wins / closed.length * 100 : 0;
  const sClosed  = [...closed].sort((a, b) => {
    if (hSort === 'closeDate') return (b.closeDate || '').localeCompare(a.closeDate || '');
    if (hSort === 'gainPct')   return b.gainPct - a.gainPct;
    if (hSort === 'netPL')     return b.netPL   - a.netPL;
    return 0;
  });

  const togExp = ticker => setExp(s => { const ns = new Set(s); ns.has(ticker) ? ns.delete(ticker) : ns.add(ticker); return ns; });

  if (!ready) return (
    <div style={{ background: '#0d1a0d', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Mono', monospace" }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ color: '#5cff8c', fontSize: 16, letterSpacing: 3, marginBottom: 8 }}>PORTFOLIO SYS</div>
        <div style={{ color: '#2e5c2e', fontSize: 12, letterSpacing: 2 }}>Loading...</div>
      </div>
    </div>
  );

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;}
    ::-webkit-scrollbar{width:5px;height:5px;}
    ::-webkit-scrollbar-track{background:#0d1a0d;}
    ::-webkit-scrollbar-thumb{background:#2e5c2e;border-radius:2px;}
    ::-webkit-scrollbar-thumb:hover{background:#5cff8c;}
    .hrow:hover{background:rgba(92,255,140,.04);}
    .lrow:hover{background:rgba(92,255,140,.02);}
    .tab{background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;font-family:'DM Mono',monospace;font-size:12px;letter-spacing:1px;padding:13px 18px;color:#4a7a4a;transition:all .15s;}
    .tab.on{color:#5cff8c;border-bottom-color:#5cff8c;}
    .tab:hover:not(.on){color:#8cbf8c;}
    .btn{background:transparent;border:1px solid #3a7a3a;color:#a8d5a8;border-radius:4px;padding:8px 16px;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.5px;cursor:pointer;transition:all .15s;}
    .btn:hover{border-color:#5cff8c;color:#5cff8c;background:rgba(92,255,140,.06);}
    .btn:disabled{border-color:#1e3a1e;color:#2e5c2e;cursor:not-allowed;}
    .btn-sm{padding:5px 10px;font-size:10px;}
    .btn-ghost{background:transparent;border:1px solid #1e3a1e;color:#4a7a4a;border-radius:4px;padding:6px 12px;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.5px;cursor:pointer;transition:all .15s;}
    .btn-ghost:hover{border-color:#3a7a3a;color:#8cbf8c;}
    .btn-danger{background:transparent;border:1px solid #5c1a1a;color:#a85555;border-radius:4px;padding:6px 12px;font-family:'DM Mono',monospace;font-size:10px;cursor:pointer;transition:all .15s;}
    .btn-danger:hover{border-color:#ff7070;color:#ff7070;}
    .btn-x{background:transparent;border:none;color:#2e5c2e;font-family:'DM Mono',monospace;font-size:12px;cursor:pointer;padding:3px 7px;transition:color .15s;}
    .btn-x:hover{color:#ff7070;}
    .card{background:#112011;border:1px solid #1e3a1e;border-radius:6px;padding:20px;}
    .fi{width:100%;background:#0a130a;border:1px solid #1e3a1e;border-radius:4px;padding:8px 12px;color:#c8e6c8;font-family:'DM Mono',monospace;font-size:13px;outline:none;transition:border-color .15s;}
    .fi:focus{border-color:#3a7a3a;}
    .fi::placeholder{color:#2e5c2e;}
    select.fi option{background:#0d1a0d;color:#c8e6c8;}
    .lbl{font-size:11px;color:#4a7a4a;letter-spacing:.5px;display:block;margin-bottom:5px;}
    .g{color:#5cff8c;}.r{color:#ff7070;}.m{color:#4a7a4a;}.y{color:#ffd166;}.c{color:#5cd4c4;}
    .overlay{position:fixed;inset:0;background:rgba(5,12,5,.9);z-index:100;display:flex;align-items:center;justify-content:center;padding:16px;}
    .modal{background:#0d1a0d;border:1px solid #2e5c2e;border-radius:8px;width:100%;max-width:720px;max-height:93vh;overflow-y:auto;box-shadow:0 0 40px rgba(0,0,0,.6);}
    .msm{max-width:560px;}
    .mhdr{padding:18px 24px 14px;border-bottom:1px solid #1e3a1e;position:sticky;top:0;background:#0d1a0d;z-index:1;display:flex;justify-content:space-between;align-items:center;}
    .mbody{padding:20px 24px;display:flex;flex-direction:column;gap:14px;}
    .sh{display:inline-block;padding:1px 6px;background:rgba(255,112,112,.1);border:1px solid rgba(255,112,112,.25);color:#ff7070;border-radius:3px;font-size:10px;letter-spacing:.5px;margin-left:6px;}
    .sc{font-size:10px;padding:2px 7px;border-radius:3px;letter-spacing:.5px;}
    th{padding:11px 14px;font-size:10px;color:#4a7a4a;letter-spacing:.5px;font-weight:400;white-space:nowrap;border-bottom:1px solid #1e3a1e;}
    .thr{text-align:right;}.thl{text-align:left;}
    .sbtn{background:none;border:none;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;color:#4a7a4a;letter-spacing:.5px;font-weight:400;padding:0;white-space:nowrap;}
    .sbtn:hover,.sbtn.on{color:#5cff8c;}
    .section-title{font-size:11px;color:#4a7a4a;letter-spacing:1px;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid #1e3a1e;}
    .setting-row{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:14px 0;border-bottom:1px solid #132013;}
    .setting-desc{font-size:12px;color:#4a7a4a;margin-top:4px;line-height:1.5;}
    .tf-btn{background:transparent;border:1px solid #1e3a1e;color:#4a7a4a;border-radius:3px;padding:4px 10px;font-family:'DM Mono',monospace;font-size:10px;cursor:pointer;transition:all .12s;}
    .tf-btn:hover{border-color:#3a7a3a;color:#8cbf8c;}
    .tf-btn.on{border-color:#5cff8c;color:#5cff8c;background:rgba(92,255,140,.07);}
  `;

  return (
    <div style={{ background: '#0d1a0d', minHeight: '100vh', fontFamily: "'DM Mono', monospace", color: '#c8e6c8' }}>
      <style>{CSS}</style>

      {/* ── Header ── */}
      <div style={{ background: '#0a130a', borderBottom: '1px solid #1e3a1e' }}>
        <div style={{ maxWidth: 1340, margin: '0 auto', padding: '0 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontSize: 17, fontWeight: 500, color: '#5cff8c', letterSpacing: 2 }}>Portfolio</span>
              {alerts.length > 0 && <span style={{ border: '1px solid #ffd166', color: '#ffd166', padding: '3px 10px', borderRadius: 12, fontSize: 11 }}>⚡ {alerts.length} alert{alerts.length > 1 ? 's' : ''}</span>}
              {fLog && <span style={{ fontSize: 11, color: fLog.startsWith('Error') || fLog.startsWith('Sector error') ? '#ff7070' : '#4a7a4a' }}>{fLog}</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn btn-sm" onClick={fetchSectors} disabled={fetSects || lots.length === 0}>{fetSects ? 'Fetching sectors...' : 'Auto-Sectors'}</button>
              <button className="btn btn-sm" onClick={fetchPrices} disabled={fetching || lots.length === 0}>{fetching ? 'Refreshing...' : '↺ Refresh Prices'}</button>
              <button className="btn btn-sm" style={{ borderColor: '#5cff8c', color: '#5cff8c' }} onClick={openAdd}>+ Add Lot</button>
            </div>
          </div>
          <div style={{ display: 'flex' }}>
            {[['dashboard','Dashboard'],['holdings','Holdings'],['history','Trade Log'],['notes','Notes'],['settings','Settings']].map(([id, label]) => (
              <button key={id} className={`tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div style={{ background: '#0a130a', borderBottom: '1px solid #132013', padding: '8px 24px' }}>
        <div style={{ maxWidth: 1340, margin: '0 auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          <select className="fi" style={{ width: 'auto', padding: '5px 10px', fontSize: 12 }} value={fBank} onChange={e => setFBank(e.target.value)}>
            <option value="All">All banks</option>{BANKS.map(b => <option key={b}>{b}</option>)}
          </select>
          <select className="fi" style={{ width: 'auto', padding: '5px 10px', fontSize: 12 }} value={fAcct} onChange={e => setFAcct(e.target.value)}>
            <option value="All">All accounts</option>{ACCTS.map(a => <option key={a}>{a}</option>)}
          </select>
          <span style={{ fontSize: 11, color: '#2e5c2e', marginLeft: 6 }}>{tGroups.length} positions · {filtered.length} lots</span>
        </div>
      </div>

      <div style={{ maxWidth: 1340, margin: '0 auto', padding: '24px 24px 56px' }}>

        {/* ══════════════ DASHBOARD ══════════════ */}
        {tab === 'dashboard' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
              <KpiCard label="Market Value"    value={fShort(totMkt)}  sub={`Cost: ${fShort(totCost)}`} />
              <KpiCard label="Unrealized G/L"  value={fU(totUGL)}      vc={totUGL >= 0 ? 'g' : 'r'} sub={fP(totRet)} sc={totRet >= 0 ? 'g' : 'r'} />
              <KpiCard label="Realized P/L"    value={fU(totReal)}     vc={totReal >= 0 ? 'g' : 'r'} sub={`${closed.length} trades`} />
              <KpiCard label="Total G/L"       value={fU(totUGL + totReal + totDiv)} vc={(totUGL + totReal + totDiv) >= 0 ? 'g' : 'r'} sub={`+${fU(totDiv)} div`} />
              <KpiCard label="Commissions"     value={fU(totComm)}     vc="m" sub="all time" />
            </div>

            {/* Alerts */}
            {alerts.length > 0 && (
              <div style={{ background: '#1a1400', border: '1px solid #4d3800', borderRadius: 6, padding: '12px 16px' }}>
                <div style={{ fontSize: 11, color: '#ffd166', letterSpacing: 1, marginBottom: 8 }}>⚡ Price Alerts</div>
                {alerts.map(g => {
                  const hT = g.n.targetPrice > 0 && g.latestPx >= g.n.targetPrice;
                  const hS = g.n.stopLoss > 0 && g.latestPx <= g.n.stopLoss;
                  return (
                    <div key={g.ticker} style={{ fontSize: 13, display: 'flex', gap: 12, marginBottom: 4 }}>
                      <span style={{ color: '#5cff8c', minWidth: 80, fontWeight: 500 }}>{g.ticker}</span>
                      {hT && <span className="g">▲ Target {fU(g.n.targetPrice)} reached — now {fU(g.latestPx)}</span>}
                      {hS && <span className="r">▼ Stop {fU(g.n.stopLoss)} hit — now {fU(g.latestPx)}</span>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Performance Timeline */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 13, color: '#a8d5a8', marginBottom: 2 }}>Portfolio Performance</div>
                  <div style={{ fontSize: 11, color: '#4a7a4a' }}>Value vs Capital Invested over time — updates on each price refresh</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['1W','1M','3M','6M','1Y','ALL'].map(tf => (
                    <button key={tf} className={`tf-btn ${tfRange === tf ? 'on' : ''}`} onClick={() => setTfRange(tf)}>{tf}</button>
                  ))}
                </div>
              </div>
              {timelineData.length < 2 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#2e5c2e', fontSize: 12 }}>
                  Refresh prices to start building your performance history.<br/>
                  <span style={{ color: '#1e3a1e', fontSize: 11, marginTop: 6, display: 'block' }}>Each refresh stores a snapshot.</span>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={timelineData} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 6" stroke="#132013" />
                    <XAxis dataKey="date" stroke="#2e5c2e" tick={{ fontSize: 10, fontFamily: 'DM Mono, monospace', fill: '#4a7a4a' }} />
                    <YAxis stroke="#2e5c2e" tickFormatter={v => fShort(v)} tick={{ fontSize: 10, fontFamily: 'DM Mono, monospace', fill: '#4a7a4a' }} width={64} />
                    <Tooltip formatter={(v, name) => [fU(v), name === 'value' ? 'Portfolio Value' : 'Capital Invested']} {...TFMT} />
                    <Line type="monotone" dataKey="value" stroke="#5cff8c" strokeWidth={2} dot={{ r: 3, fill: '#5cff8c' }} activeDot={{ r: 5 }} name="value" />
                    <Line type="monotone" dataKey="cost"  stroke="#5cd4c4" strokeWidth={1.5} dot={{ r: 2, fill: '#5cd4c4' }} strokeDasharray="4 3" name="cost" />
                  </LineChart>
                </ResponsiveContainer>
              )}
              <div style={{ display: 'flex', gap: 20, marginTop: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#4a7a4a' }}><span style={{ width: 20, height: 2, background: '#5cff8c', display: 'inline-block' }} /> Portfolio Value</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#4a7a4a' }}><span style={{ width: 20, height: 2, background: '#5cd4c4', display: 'inline-block', opacity: .7 }} /> Capital Invested</div>
                <div style={{ marginLeft: 'auto', fontSize: 11, color: '#2e5c2e' }}>{timelineData.length} data point{timelineData.length !== 1 ? 's' : ''}</div>
              </div>
            </div>

            {/* Row 2: Allocation + Sector Return */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <span style={{ fontSize: 13, color: '#a8d5a8' }}>Allocation</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {['sector','account'].map(v => (
                      <button key={v} className="btn-ghost" style={{ fontSize: 10, padding: '3px 10px', borderColor: allocView === v ? '#5cff8c' : undefined, color: allocView === v ? '#5cff8c' : undefined }} onClick={() => setAllocView(v)}>{v}</button>
                    ))}
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={allocData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={38} paddingAngle={2} stroke="none">
                      {allocData.map((_, i) => <Cell key={i} fill={PAL[i % PAL.length]} />)}
                    </Pie>
                    <Tooltip formatter={v => fU(v)} {...TFMT} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 6 }}>
                  {allocData.slice(0, 8).map((d, i) => (
                    <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#4a7a4a' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: PAL[i % PAL.length], flexShrink: 0 }} />{d.name}
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <div style={{ fontSize: 13, color: '#a8d5a8', marginBottom: 14 }}>Return % by Sector</div>
                {sectorRetData.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: '#2e5c2e', fontSize: 12 }}>No sector data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={sectorRetData} layout="vertical" margin={{ left: 0, right: 30 }}>
                      <CartesianGrid strokeDasharray="3 6" stroke="#132013" />
                      <XAxis type="number" tickFormatter={v => `${v.toFixed(0)}%`} stroke="#2e5c2e" tick={{ fontSize: 10, fontFamily: 'DM Mono, monospace', fill: '#4a7a4a' }} />
                      <YAxis type="category" dataKey="name" stroke="#2e5c2e" tick={{ fontSize: 10, fontFamily: 'DM Mono, monospace', fill: '#8cbf8c' }} width={80} />
                      <Tooltip formatter={v => [`${v.toFixed(2)}%`, 'Return']} {...TFMT} />
                      <ReferenceLine x={0} stroke="#2e5c2e" />
                      <Bar dataKey="ret" radius={[0, 3, 3, 0]}>
                        {sectorRetData.map((d, i) => <Cell key={i} fill={d.ret >= 0 ? '#5cff8c' : '#ff7070'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Row 3: Top Positions + Monthly P/L */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="card">
                <div style={{ fontSize: 13, color: '#a8d5a8', marginBottom: 14 }}>Top Positions by Value</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={[...tGroups].sort((a,b)=>b.mktValue-a.mktValue).slice(0,8).map(g=>({name:g.ticker,v:+g.mktValue.toFixed(2)}))} layout="vertical" margin={{left:0,right:10}}>
                    <CartesianGrid strokeDasharray="3 6" stroke="#132013"/>
                    <XAxis type="number" tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} stroke="#2e5c2e" tick={{fontSize:10,fontFamily:'DM Mono,monospace',fill:'#4a7a4a'}}/>
                    <YAxis type="category" dataKey="name" stroke="#2e5c2e" tick={{fontSize:10,fontFamily:'DM Mono,monospace',fill:'#8cbf8c'}} width={56}/>
                    <Tooltip formatter={v=>fU(v)} {...TFMT}/>
                    <Bar dataKey="v" radius={[0,3,3,0]}>{tGroups.map((_,i)=><Cell key={i} fill={PAL[i%PAL.length]}/>)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card">
                <div style={{ fontSize: 13, color: '#a8d5a8', marginBottom: 14 }}>Monthly Realized P/L</div>
                {monthlyPL.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: '#2e5c2e', fontSize: 12 }}>No closed trade history</div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={monthlyPL} margin={{ left: 0, right: 10, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 6" stroke="#132013" />
                      <XAxis dataKey="month" stroke="#2e5c2e" tick={{ fontSize: 9, fontFamily: 'DM Mono, monospace', fill: '#4a7a4a' }} angle={-40} textAnchor="end" height={36} />
                      <YAxis stroke="#2e5c2e" tickFormatter={v => fShort(v)} tick={{ fontSize: 10, fontFamily: 'DM Mono, monospace', fill: '#4a7a4a' }} width={56} />
                      <Tooltip formatter={v => [fU(v), 'Net P/L']} {...TFMT} />
                      <ReferenceLine y={0} stroke="#2e5c2e" />
                      <Bar dataKey="pl" radius={[3, 3, 0, 0]}>
                        {monthlyPL.map((d, i) => <Cell key={i} fill={d.pl >= 0 ? '#5cff8c' : '#ff7070'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Row 4: CAD/USD + Performers */}
            <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 1fr', gap: 16 }}>
              <div className="card">
                <div style={{ fontSize: 13, color: '#a8d5a8', marginBottom: 14 }}>Currency Exposure</div>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={currencyData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={65} innerRadius={30} paddingAngle={3} stroke="none" label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                      {currencyData.map((_, i) => <Cell key={i} fill={i === 0 ? '#5cff8c' : '#5cd4c4'} />)}
                    </Pie>
                    <Tooltip formatter={v => fU(v)} {...TFMT} />
                  </PieChart>
                </ResponsiveContainer>
                {currencyData.map((d, i) => (
                  <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#8cbf8c', marginTop: 6 }}>
                    <span style={{ color: i === 0 ? '#5cff8c' : '#5cd4c4' }}>{d.name}</span>
                    <span>{fShort(d.value)}</span>
                  </div>
                ))}
              </div>

              <div className="card">
                <div style={{ fontSize: 13, color: '#a8d5a8', marginBottom: 12 }}>Top Performers</div>
                {[...tGroups].sort((a,b)=>b.totalRet-a.totalRet).slice(0,6).map(g=><PRow key={g.ticker} ticker={g.ticker} name={g.name} val={fP(g.totalRet)} pos={g.totalRet>=0}/>)}
              </div>
              <div className="card">
                <div style={{ fontSize: 13, color: '#a8d5a8', marginBottom: 12 }}>Underperformers</div>
                {[...tGroups].sort((a,b)=>a.totalRet-b.totalRet).slice(0,6).map(g=><PRow key={g.ticker} ticker={g.ticker} name={g.name} val={fP(g.totalRet)} pos={g.totalRet>=0}/>)}
              </div>
            </div>
          </div>
        )}

        {/* ══════════════ HOLDINGS ══════════════ */}
        {tab === 'holdings' && (
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>
                <th className="thl">Position</th><th className="thl">Account</th>
                <th className="thr">Lots</th><th className="thr">Avg Cost</th><th className="thr">Current</th>
                <th className="thr">Mkt Value</th><th className="thr">Unreal. G/L</th><th className="thr">Return</th>
                <th className="thr">Target / Stop</th><th className="thr">Sector</th><th className="thr">Comm.</th><th></th>
              </tr></thead>
              <tbody>
                {tGroups.length === 0 ? (
                  <tr><td colSpan={12} style={{ textAlign: 'center', padding: '60px 0', color: '#2e5c2e', fontSize: 13 }}>No holdings — import a CSV or add a lot</td></tr>
                ) : tGroups.map(g => {
                  const isOpen = exp.has(g.ticker);
                  const hT = g.n.targetPrice > 0 && g.latestPx >= g.n.targetPrice;
                  const hS = g.n.stopLoss > 0 && g.latestPx <= g.n.stopLoss && g.latestPx > 0;
                  return (
                    <Fragment key={g.ticker}>
                      <tr className="hrow" style={{ borderBottom: '1px solid #132013', cursor: 'pointer' }} onClick={() => togExp(g.ticker)}>
                        <td style={{ padding: '11px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ color: '#2e5c2e', fontSize: 11 }}>{isOpen ? '▼' : '▶'}</span>
                            <span style={{ color: '#5cff8c', fontWeight: 500, letterSpacing: .5 }}>{g.ticker}</span>
                            {g.sells.length > 0 && <span className="sh">SHORT</span>}
                          </div>
                          <div style={{ color: '#4a7a4a', fontSize: 11, marginTop: 2, paddingLeft: 20 }}>{g.name}</div>
                        </td>
                        <td style={{ padding: '11px 14px' }}>
                          <div style={{ color: '#8cbf8c', fontSize: 12 }}>{g.lots[0]?.bank}</div>
                          <div style={{ color: '#4a7a4a', fontSize: 11, marginTop: 2 }}>{g.lots[0]?.accountType} · {g.currency}</div>
                        </td>
                        <td style={{ padding: '11px 14px', textAlign: 'right', color: '#4a7a4a' }}>{g.lots.length}</td>
                        <td style={{ padding: '11px 14px', textAlign: 'right', color: '#8cbf8c' }}>{fF(g.avgCost, g.currency)}</td>
                        <td style={{ padding: '11px 14px', textAlign: 'right', color: '#c8e6c8' }}>{fF(g.latestPx, g.currency)}</td>
                        <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 500, color: '#c8e6c8' }}>{fF(g.mktValue, g.currency)}</td>
                        <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 500 }} className={g.unrealGL >= 0 ? 'g' : 'r'}>{fF(g.unrealGL, g.currency)}</td>
                        <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 500 }} className={g.totalRet >= 0 ? 'g' : 'r'}>{fP(g.totalRet)}</td>
                        <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                          {g.n.targetPrice > 0 && <div style={{ fontSize: 11, color: hT ? '#5cff8c' : '#4a7a4a' }}>{hT ? '▲ ' : ''}T: {fF(g.n.targetPrice, g.currency)}</div>}
                          {g.n.stopLoss > 0   && <div style={{ fontSize: 11, color: hS ? '#ff7070' : '#4a7a4a', marginTop: 2 }}>{hS ? '▼ ' : ''}S: {fF(g.n.stopLoss, g.currency)}</div>}
                        </td>
                        <td style={{ padding: '11px 14px', textAlign: 'right', color: '#4a7a4a', fontSize: 11 }}>{g.sector}</td>
                        <td style={{ padding: '11px 14px', textAlign: 'right', color: '#4a7a4a', fontSize: 12 }}>{fF(g.comm, g.currency)}</td>
                        <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                          <button className="btn-ghost" style={{ fontSize: 9, padding: '2px 8px' }} onClick={e => { e.stopPropagation(); openNote(g.ticker); }}>notes</button>
                        </td>
                      </tr>
                      {isOpen && g.lots.map(lot => {
                        const lgl  = lot.type === 'BUY' ? (lot.currentPrice - lot.purchasePrice) * lot.shares : (lot.purchasePrice - lot.currentPrice) * lot.shares;
                        const lret = lot.purchasePrice > 0 ? lgl / (lot.purchasePrice * lot.shares) * 100 : 0;
                        return (
                          <tr key={lot.id} className="lrow" style={{ borderBottom: '1px solid #0d180d', background: 'rgba(0,0,0,.2)' }}>
                            <td style={{ padding: '7px 14px 7px 40px', color: '#4a7a4a', fontSize: 12 }}>
                              <span style={{ color: '#2e5c2e', fontSize: 10, marginRight: 6 }}>└ lot</span>{lot.openDate}
                              {lot.type === 'SELL' && <span className="sh">SHORT</span>}
                            </td>
                            <td style={{ padding: '7px 14px', color: '#2e5c2e', fontSize: 11 }}>{lot.bank} · {lot.accountType}</td>
                            <td style={{ padding: '7px 14px', textAlign: 'right', color: '#4a7a4a', fontSize: 12 }}>{fN(lot.shares)}</td>
                            <td style={{ padding: '7px 14px', textAlign: 'right', color: '#4a7a4a', fontSize: 12 }}>{fF(lot.purchasePrice, lot.currency)}</td>
                            <td style={{ padding: '7px 14px', textAlign: 'right', color: '#4a7a4a', fontSize: 12 }}>{fF(lot.currentPrice, lot.currency)}</td>
                            <td style={{ padding: '7px 14px', textAlign: 'right', color: '#4a7a4a', fontSize: 12 }}>{fF(lot.currentPrice * lot.shares, lot.currency)}</td>
                            <td style={{ padding: '7px 14px', textAlign: 'right', fontSize: 12 }} className={lgl >= 0 ? 'g' : 'r'}>{fF(lgl, lot.currency)}</td>
                            <td style={{ padding: '7px 14px', textAlign: 'right', fontSize: 12 }} className={lret >= 0 ? 'g' : 'r'}>{fP(lret)}</td>
                            <td colSpan={2} style={{ padding: '7px 14px', textAlign: 'right', fontSize: 11, color: '#2e5c2e' }}>comm: {fF(lot.commission || 0, lot.currency)}</td>
                            <td colSpan={2} style={{ padding: '7px 14px', textAlign: 'right' }}>
                              <button className="btn-ghost" style={{ fontSize: 9, padding: '2px 7px', marginRight: 4 }} onClick={() => openEdit(lot)}>edit</button>
                              <button className="btn-x" onClick={() => delLot(lot.id)}>✕</button>
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
              {tGroups.length > 0 && (
                <tfoot><tr style={{ borderTop: '1px solid #2e5c2e', background: '#0a130a' }}>
                  <td colSpan={5} style={{ padding: '11px 14px', fontSize: 11, color: '#4a7a4a' }}>{tGroups.length} positions · {filtered.length} lots</td>
                  <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 500, color: '#c8e6c8' }}>{fU(totMkt)}</td>
                  <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 500 }} className={totUGL >= 0 ? 'g' : 'r'}>{fU(totUGL)}</td>
                  <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 500 }} className={totRet >= 0 ? 'g' : 'r'}>{fP(totRet)}</td>
                  <td colSpan={4} />
                </tr></tfoot>
              )}
            </table>
          </div>
        )}

        {/* ══════════════ TRADE LOG ══════════════ */}
        {tab === 'history' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 12 }}>
              <KpiCard label="Realized P/L"  value={fU(totReal)}   vc={totReal >= 0 ? 'g' : 'r'} />
              <KpiCard label="Closed Trades" value={String(closed.length)} />
              <KpiCard label="Win Rate"      value={fP(winRate).replace('+', '')} sub={`${wins}W / ${closed.length - wins}L`} />
              <KpiCard label="Best Trade"    value={closed.length ? fP(Math.max(...closed.map(c => c.gainPct))) : '—'} vc="g" />
              <KpiCard label="Worst Trade"   value={closed.length ? fP(Math.min(...closed.map(c => c.gainPct))) : '—'} vc="r" />
            </div>
            <div className="card" style={{ padding: 0, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr>
                  <th className="thl">Ticker / Name</th>
                  <th className="thr">Type</th><th className="thr">Shares</th>
                  <th className="thr">Opened</th><th className="thr">Open Price</th>
                  <th className="thr"><button className={`sbtn ${hSort==='closeDate'?'on':''}`} onClick={()=>setHSort('closeDate')}>Closed {hSort==='closeDate'?'↓':''}</button></th>
                  <th className="thr">Close Price</th>
                  <th className="thr"><button className={`sbtn ${hSort==='gainPct'?'on':''}`} onClick={()=>setHSort('gainPct')}>Gain % {hSort==='gainPct'?'↓':''}</button></th>
                  <th className="thr"><button className={`sbtn ${hSort==='netPL'?'on':''}`} onClick={()=>setHSort('netPL')}>Net P/L {hSort==='netPL'?'↓':''}</button></th>
                </tr></thead>
                <tbody>
                  {sClosed.length === 0 ? (
                    <tr><td colSpan={9} style={{ textAlign: 'center', padding: '60px 0', color: '#2e5c2e', fontSize: 13 }}>No closed trades — import a CSV to load history.</td></tr>
                  ) : sClosed.map(c => (
                    <tr key={c.id} className="hrow" style={{ borderBottom: '1px solid #132013' }}>
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ color: '#5cff8c', fontWeight: 500 }}>{c.ticker}</div>
                        <div style={{ color: '#4a7a4a', fontSize: 11, marginTop: 2 }}>{c.name}</div>
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                        <span className="sc" style={{ background: c.type === 'BUY' ? 'rgba(92,255,140,.1)' : 'rgba(255,112,112,.1)', color: c.type === 'BUY' ? '#5cff8c' : '#ff7070', border: `1px solid ${c.type === 'BUY' ? 'rgba(92,255,140,.25)' : 'rgba(255,112,112,.25)'}` }}>{c.type}</span>
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: '#8cbf8c' }}>{fN(c.shares)}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: '#4a7a4a', fontSize: 12 }}>{c.openDate}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: '#8cbf8c' }}>{fF(c.openPrice, c.currency)}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: '#4a7a4a', fontSize: 12 }}>{c.closeDate}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: '#8cbf8c' }}>{fF(c.closePrice, c.currency)}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500 }} className={c.gainPct >= 0 ? 'g' : 'r'}>{fP(c.gainPct)}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500 }} className={c.netPL >= 0 ? 'g' : 'r'}>{fF(c.netPL, c.currency)}</td>
                    </tr>
                  ))}
                </tbody>
                {sClosed.length > 0 && (
                  <tfoot><tr style={{ borderTop: '1px solid #2e5c2e', background: '#0a130a' }}>
                    <td colSpan={8} style={{ padding: '11px 14px', fontSize: 11, color: '#4a7a4a' }}>{closed.length} trades total</td>
                    <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 500 }} className={totReal >= 0 ? 'g' : 'r'}>{fU(totReal)}</td>
                  </tr></tfoot>
                )}
              </table>
            </div>
          </div>
        )}

        {/* ══════════════ NOTES ══════════════ */}
        {tab === 'notes' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {tGroups.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 0', color: '#2e5c2e', fontSize: 13 }}>No positions to annotate.</div>
            ) : tGroups.map(g => {
              const n = g.n, ret = g.totalRet;
              return (
                <div key={g.ticker} className="card" style={{ padding: '14px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <span style={{ color: '#5cff8c', fontWeight: 500, letterSpacing: .5, minWidth: 72, fontSize: 14 }}>{g.ticker}</span>
                      <span style={{ color: '#4a7a4a', fontSize: 12 }}>{g.name}</span>
                      <span className="sc" style={{ background: ret >= 0 ? 'rgba(92,255,140,.1)' : 'rgba(255,112,112,.1)', color: ret >= 0 ? '#5cff8c' : '#ff7070', border: `1px solid ${ret >= 0 ? 'rgba(92,255,140,.2)' : 'rgba(255,112,112,.2)'}` }}>{fP(ret)}</span>
                      {n.targetPrice > 0 && <span style={{ fontSize: 11, color: '#4a7a4a' }}>T:{fF(n.targetPrice, g.currency)}</span>}
                      {n.stopLoss > 0    && <span style={{ fontSize: 11, color: '#4a7a4a' }}>S:{fF(n.stopLoss, g.currency)}</span>}
                    </div>
                    <button className="btn-ghost" style={{ fontSize: 10, padding: '4px 12px', flexShrink: 0 }} onClick={() => openNote(g.ticker)}>Edit notes</button>
                  </div>
                  {(n.thesis || n.notes) ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
                      <div>
                        <div style={{ fontSize: 11, color: '#ffd166', letterSpacing: .5, marginBottom: 6 }}>Thesis</div>
                        <p style={{ fontSize: 13, color: '#8cbf8c', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{n.thesis || '—'}</p>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: '#5cd4c4', letterSpacing: .5, marginBottom: 6 }}>Notes & Plan</div>
                        <p style={{ fontSize: 13, color: '#8cbf8c', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{n.notes || '—'}</p>
                      </div>
                    </div>
                  ) : (
                    <p style={{ fontSize: 12, color: '#2e5c2e', fontStyle: 'italic', marginTop: 8 }}>No notes yet — click <strong style={{ color: '#5cff8c', fontStyle: 'normal' }}>Edit notes</strong> to add your thesis and plans.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ══════════════ SETTINGS ══════════════ */}
        {tab === 'settings' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 760 }}>

            <div className="card">
              <div className="section-title">Data Import</div>
              <div className="setting-row">
                <div>
                  <div style={{ fontSize: 13, color: '#c8e6c8' }}>Import Portfolio CSV</div>
                  <div className="setting-desc">TradingView multi-section format. Parses open lots and trade history. Auto-detects TSX (CAD) vs NYSE/NASDAQ/OTC (USD).</div>
                </div>
                <button className="btn" style={{ flexShrink: 0 }} onClick={() => fileRef.current?.click()}>Select File</button>
                <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={onFile} />
              </div>
            </div>

            <div className="card">
              <div className="section-title">Data Export</div>
              {[
                ['Export Holdings', 'All open lots — ticker, dates, cost basis, current price, account, sector.', exportHoldings, lots.length === 0],
                ['Export Trade History', 'All closed trades — open/close dates, prices, gain % and net P/L.', exportHistory, closed.length === 0],
                ['Export Notes', 'All ticker notes, thesis, target prices, and stop losses.', exportNotes, Object.keys(notes).length === 0],
              ].map(([label, desc, fn, disabled]) => (
                <div key={label} className="setting-row">
                  <div>
                    <div style={{ fontSize: 13, color: '#c8e6c8' }}>{label}</div>
                    <div className="setting-desc">{desc}</div>
                  </div>
                  <button className="btn-ghost" style={{ flexShrink: 0 }} onClick={fn} disabled={disabled}>Download CSV</button>
                </div>
              ))}
              <div className="setting-row" style={{ borderBottom: 'none' }}>
                <div>
                  <div style={{ fontSize: 13, color: '#5cff8c' }}>Export All</div>
                  <div className="setting-desc">Downloads all three CSVs at once — holdings, trade history, and notes.</div>
                </div>
                <button className="btn" style={{ flexShrink: 0 }} onClick={exportAll} disabled={lots.length === 0 && closed.length === 0}>Download All</button>
              </div>
            </div>

            <div className="card">
              <div className="section-title">Auto-Fetch Data</div>
              <div className="setting-row">
                <div>
                  <div style={{ fontSize: 13, color: '#c8e6c8' }}>Auto-Fetch Sectors</div>
                  <div className="setting-desc">Uses web search to identify the market sector for every ticker. Also available via the header button.</div>
                </div>
                <button className="btn" style={{ flexShrink: 0 }} onClick={fetchSectors} disabled={fetSects || lots.length === 0}>{fetSects ? 'Fetching...' : 'Fetch Sectors'}</button>
              </div>
              <div className="setting-row" style={{ borderBottom: 'none' }}>
                <div>
                  <div style={{ fontSize: 13, color: '#c8e6c8' }}>Refresh Prices</div>
                  <div className="setting-desc">Fetches current prices for all non-mutual-fund holdings and saves a portfolio snapshot for the timeline chart.</div>
                </div>
                <button className="btn" style={{ flexShrink: 0 }} onClick={fetchPrices} disabled={fetching || lots.length === 0}>{fetching ? 'Fetching...' : 'Refresh Prices'}</button>
              </div>
            </div>

            <div className="card" style={{ borderColor: '#3d1e1e' }}>
              <div className="section-title" style={{ color: '#a85555', borderBottomColor: '#3d1e1e' }}>Data Management</div>
              {[
                ['Clear Open Positions', 'Deletes all lots. Trade history and notes are preserved.', async () => { await saveLots([]); }, 'lots'],
                ['Clear Trade History',  'Deletes all closed trade records.',                         async () => { await saveClosed([]); }, 'closed'],
                ['Clear Notes',          'Deletes all ticker notes, thesis, and targets.',             async () => { await saveNotes({}); }, 'notes'],
                ['Clear Performance History', 'Deletes all price snapshots used for the timeline.',   async () => { await saveSnapshots([]); }, 'snaps'],
                ['Clear All Data',       'Wipes everything: lots, history, notes, and snapshots.',    async () => { await saveLots([]); await saveClosed([]); await saveNotes({}); await saveSnapshots([]); }, 'all'],
              ].map(([label, desc, action, key]) => (
                <div key={key} className="setting-row">
                  <div>
                    <div style={{ fontSize: 13, color: '#c87070' }}>{label}</div>
                    <div className="setting-desc" style={{ color: '#7a3a3a' }}>{desc}</div>
                  </div>
                  {clearConf === key ? (
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <button className="btn-danger" onClick={async () => { await action(); setClearConf(null); }}>Confirm Delete</button>
                      <button className="btn-ghost" onClick={() => setClearConf(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button className="btn-danger" style={{ flexShrink: 0 }} onClick={() => setClearConf(key)}>Delete</button>
                  )}
                </div>
              ))}
            </div>

            <div className="card">
              <div className="section-title">System Info</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px', fontSize: 12, color: '#4a7a4a', lineHeight: 2.2 }}>
                <div>Open lots: <span style={{ color: '#8cbf8c' }}>{lots.length}</span></div>
                <div>Closed trades: <span style={{ color: '#8cbf8c' }}>{closed.length}</span></div>
                <div>Annotated tickers: <span style={{ color: '#8cbf8c' }}>{Object.keys(notes).length}</span></div>
                <div>Unique tickers: <span style={{ color: '#8cbf8c' }}>{new Set(lots.map(l => l.ticker)).size}</span></div>
                <div>Institutions: <span style={{ color: '#8cbf8c' }}>{new Set(lots.map(l => l.bank)).size}</span></div>
                <div>Snapshots stored: <span style={{ color: '#8cbf8c' }}>{snapshots.length}</span></div>
              </div>
            </div>

            {/* DEBUG */}
            <div className="card" style={{ borderColor: '#1e3a5c' }}>
              <div className="section-title" style={{ color: '#5cd4c4', borderBottomColor: '#1e3a5c' }}>Debug Information</div>

              <div className="setting-row">
                <div>
                  <div style={{ fontSize: 13, color: '#c8e6c8' }}>Storage Diagnostic</div>
                  <div className="setting-desc">Write → Read → Delete a test key, then verify each data key exists in storage with its byte size.</div>
                </div>
                <button className="btn" style={{ flexShrink: 0, borderColor: '#5cd4c4', color: '#5cd4c4' }} onClick={runStorageTest} disabled={testRun}>
                  {testRun ? 'Running...' : 'Run Storage Test'}
                </button>
              </div>

              <div className="setting-row">
                <div>
                  <div style={{ fontSize: 13, color: '#c8e6c8' }}>API Connectivity Test</div>
                  <div className="setting-desc">Makes a minimal call to the Anthropic API and logs the full response (status, headers, body). Use this to diagnose network errors.</div>
                </div>
                <button className="btn" style={{ flexShrink: 0, borderColor: '#5cd4c4', color: '#5cd4c4' }} onClick={runAPITest} disabled={testRun}>
                  {testRun ? 'Running...' : 'Test API'}
                </button>
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, color: '#4a7a4a', marginBottom: 8, letterSpacing: .5 }}>Storage State (in-memory)</div>
                <div style={{ background: '#0a130a', border: '1px solid #1e3a5c', borderRadius: 4, padding: '10px 14px', fontSize: 12, fontFamily: "'DM Mono', monospace", color: '#8cbf8c', lineHeight: 2.1 }}>
                  {[
                    [`${LK}`, 'lots',      lots,      lots.length          + ' records'],
                    [`${CK}`, 'closed',    closed,    closed.length        + ' records'],
                    [`${NK}`, 'notes',     notes,     Object.keys(notes).length + ' tickers'],
                    [`${SK}`, 'snapshots', snapshots, snapshots.length     + ' entries'],
                  ].map(([key, label, data, count]) => (
                    <div key={key}>
                      <span style={{ color: '#5cd4c4' }}>{key}</span>
                      <span style={{ color: '#2e5c2e' }}> → </span>
                      <span style={{ color: '#c8e6c8' }}>{count}</span>
                      <span style={{ color: '#2e5c2e' }}> · </span>
                      <span style={{ color: '#4a7a4a' }}>{(JSON.stringify(data).length / 1024).toFixed(1)} KB</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: '#4a7a4a', letterSpacing: .5 }}>Event Log — {debugLog.length} entries</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-ghost" style={{ fontSize: 10, borderColor: '#1e3a5c', color: '#5cd4c4' }} onClick={() => setDebugLog([])}>Clear</button>
                    <button className="btn-ghost" style={{ fontSize: 10, borderColor: '#1e3a5c', color: '#5cd4c4' }} onClick={copyDebug}>Copy All</button>
                  </div>
                </div>
                <div style={{ background: '#0a130a', border: '1px solid #1e3a5c', borderRadius: 4, padding: '10px 14px', maxHeight: 300, overflowY: 'auto', fontSize: 11, fontFamily: "'DM Mono', monospace", lineHeight: 2 }}>
                  {debugLog.length === 0
                    ? <span style={{ color: '#2e5c2e' }}>No events yet — run a test or trigger an import / refresh.</span>
                    : [...debugLog].reverse().map((e, i) => (
                      <div key={i}>
                        <span style={{ color: '#2e5c2e', marginRight: 8 }}>{e.ts}</span>
                        <span style={{ marginRight: 8, color: e.type === 'error' ? '#ff7070' : e.type === 'success' ? '#5cff8c' : e.type === 'warn' ? '#ffd166' : '#4a7a4a' }}>[{e.type.toUpperCase()}]</span>
                        <span style={{ color: e.type === 'error' ? '#ff9090' : e.type === 'success' ? '#a0e8b0' : e.type === 'warn' ? '#ffe599' : '#8cbf8c' }}>{e.msg}</span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ══ IMPORT DIALOG ══ */}
      {showImp && impData && (
        <div className="overlay">
          <div className="modal">
            <div className="mhdr">
              <div>
                <div style={{ color: '#5cff8c', fontSize: 15, fontWeight: 500, marginBottom: 4 }}>Import Portfolio CSV</div>
                <div style={{ fontSize: 12, color: '#4a7a4a' }}>Found <strong style={{ color: '#c8e6c8' }}>{impData.openRows.length} open lots</strong> and <strong style={{ color: '#5cd4c4' }}>{impData.closedRows.length} closed trades</strong></div>
              </div>
              <button onClick={() => { setShowImp(false); setImpData(null); }} style={{ background: 'none', border: 'none', color: '#4a7a4a', cursor: 'pointer', fontSize: 22, fontFamily: 'DM Mono, monospace' }}>×</button>
            </div>
            <div className="mbody">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#4a7a4a', letterSpacing: .5, marginBottom: 10, borderBottom: '1px solid #1e3a1e', paddingBottom: 8 }}>CAD Holdings (TSX)</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div><label className="lbl">Bank</label><select className="fi" value={iCBank} onChange={e => setICBank(e.target.value)}>{BANKS.map(b => <option key={b}>{b}</option>)}</select></div>
                    <div><label className="lbl">Account Type</label><select className="fi" value={iCAcct} onChange={e => setICAcct(e.target.value)}>{ACCTS.map(a => <option key={a}>{a}</option>)}</select></div>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#4a7a4a', letterSpacing: .5, marginBottom: 10, borderBottom: '1px solid #1e3a1e', paddingBottom: 8 }}>USD Holdings (NYSE / NASDAQ / OTC)</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div><label className="lbl">Bank</label><select className="fi" value={iUBank} onChange={e => setIUBank(e.target.value)}>{BANKS.map(b => <option key={b}>{b}</option>)}</select></div>
                    <div><label className="lbl">Account Type</label><select className="fi" value={iUAcct} onChange={e => setIUAcct(e.target.value)}>{ACCTS.map(a => <option key={a}>{a}</option>)}</select></div>
                  </div>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#4a7a4a', marginBottom: 10 }}>Import Mode</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  {[['merge','Merge (add new lots only)'],['replace','Replace all open positions']].map(([v, l]) => (
                    <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: iMode === v ? '#c8e6c8' : '#4a7a4a', cursor: 'pointer', padding: '8px 14px', background: iMode === v ? 'rgba(92,255,140,.06)' : 'transparent', border: `1px solid ${iMode === v ? '#3a7a3a' : '#1e3a1e'}`, borderRadius: 4, flex: 1, transition: 'all .15s' }}>
                      <input type="radio" value={v} checked={iMode === v} onChange={() => setIMode(v)} style={{ accentColor: '#5cff8c' }} />{l}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#4a7a4a', marginBottom: 8 }}>Preview — first 5 lots</div>
                <div style={{ background: '#0a130a', border: '1px solid #1e3a1e', borderRadius: 4, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead><tr style={{ borderBottom: '1px solid #1e3a1e' }}>
                      {['Ticker','Name','Exchange','Date','Type','Shares','Open Price'].map((h, i) => <th key={i} style={{ padding: '7px 12px', textAlign: i < 2 ? 'left' : 'right', fontSize: 10, color: '#4a7a4a', fontWeight: 400 }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {impData.openRows.slice(0, 5).map((r, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #132013' }}>
                          <td style={{ padding: '6px 12px', color: '#5cff8c' }}>{r.Symbol}</td>
                          <td style={{ padding: '6px 12px', color: '#4a7a4a', fontSize: 11 }}>{r.Name?.slice(0, 26)}{r.Name?.length > 26 ? '…' : ''}</td>
                          <td style={{ padding: '6px 12px', textAlign: 'right', color: '#4a7a4a' }}>{r.Exchange}</td>
                          <td style={{ padding: '6px 12px', textAlign: 'right', color: '#4a7a4a' }}>{r['Open Date']}</td>
                          <td style={{ padding: '6px 12px', textAlign: 'right', color: r.Type === 'BUY' ? '#5cff8c' : '#ff7070' }}>{r.Type}</td>
                          <td style={{ padding: '6px 12px', textAlign: 'right', color: '#8cbf8c' }}>{r.Amount}</td>
                          <td style={{ padding: '6px 12px', textAlign: 'right', color: '#8cbf8c' }}>{r['Open Price']}</td>
                        </tr>
                      ))}
                      {impData.openRows.length > 5 && <tr><td colSpan={7} style={{ padding: '6px 12px', textAlign: 'center', color: '#2e5c2e', fontSize: 11 }}>…and {impData.openRows.length - 5} more lots</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn" style={{ flex: 1, padding: '10px 0', fontSize: 12 }} onClick={confirmImport}>Import {impData.openRows.length} lots + {impData.closedRows.length} trades</button>
                <button className="btn-ghost" style={{ padding: '10px 20px' }} onClick={() => { setShowImp(false); setImpData(null); }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ ADD/EDIT LOT ══ */}
      {showF && (
        <div className="overlay">
          <div className="modal">
            <div className="mhdr">
              <span style={{ color: '#5cff8c', fontSize: 15, fontWeight: 500 }}>{editId ? 'Edit Lot' : 'Add Lot'}</span>
              <button onClick={() => { setShowF(false); setEditId(null); }} style={{ background: 'none', border: 'none', color: '#4a7a4a', cursor: 'pointer', fontSize: 22, fontFamily: 'DM Mono, monospace' }}>×</button>
            </div>
            <div className="mbody">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#4a7a4a', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.isMutualFund} onChange={e => sf('isMutualFund', e.target.checked)} style={{ accentColor: '#5cff8c' }} />Mutual Fund / GIC (skip price fetch)
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <FF label="Ticker" value={form.ticker} onChange={v => sf('ticker', v.toUpperCase())} placeholder="AAPL, XIU.TO…" />
                <FF label="Name" value={form.name} onChange={v => sf('name', v)} placeholder="Full name" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <FS label="Bank" value={form.bank} onChange={v => sf('bank', v)} opts={BANKS} />
                <FS label="Account Type" value={form.accountType} onChange={v => sf('accountType', v)} opts={ACCTS} />
                <FS label="Currency" value={form.currency} onChange={v => sf('currency', v)} opts={CURS} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <FS label="Exchange" value={form.exchange} onChange={v => sf('exchange', v)} opts={EXCHS} />
                <FS label="Sector" value={form.sector} onChange={v => sf('sector', v)} opts={SECTORS} />
                <FS label="Type" value={form.type} onChange={v => sf('type', v)} opts={['BUY','SELL']} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <FF label="Open Date" type="date" value={form.openDate} onChange={v => sf('openDate', v)} />
                <FF label="Shares" type="number" value={form.shares} onChange={v => sf('shares', v)} placeholder="100" />
                <FF label="Purchase Price" type="number" value={form.purchasePrice} onChange={v => sf('purchasePrice', v)} placeholder="50.00" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <FF label="Current Price" type="number" value={form.currentPrice} onChange={v => sf('currentPrice', v)} placeholder="Auto-fetched" />
                <FF label="Commission" type="number" value={form.commission} onChange={v => sf('commission', v)} placeholder="0.00" />
                <FF label="Dividends Received" type="number" value={form.dividendsReceived} onChange={v => sf('dividendsReceived', v)} placeholder="0.00" />
              </div>
              <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
                <button className="btn" style={{ flex: 1, padding: '10px 0' }} onClick={submitLot}>{editId ? 'Update Lot' : 'Add Lot'}</button>
                <button className="btn-ghost" style={{ padding: '10px 20px' }} onClick={() => { setShowF(false); setEditId(null); }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ NOTE EDITOR ══ */}
      {noteFor && (
        <div className="overlay">
          <div className="modal msm">
            <div className="mhdr">
              <span style={{ color: '#5cff8c', fontSize: 15, fontWeight: 500 }}>Notes — {noteFor}</span>
              <button onClick={() => setNoteFor(null)} style={{ background: 'none', border: 'none', color: '#4a7a4a', cursor: 'pointer', fontSize: 22, fontFamily: 'DM Mono, monospace' }}>×</button>
            </div>
            <div className="mbody">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <FF label="Target Price" type="number" value={nForm.targetPrice} onChange={v => setNForm(f => ({ ...f, targetPrice: v }))} placeholder="Optional" />
                <FF label="Stop Loss" type="number" value={nForm.stopLoss} onChange={v => setNForm(f => ({ ...f, stopLoss: v }))} placeholder="Optional" />
                <FF label="Dividends Received" type="number" value={nForm.dividendsReceived} onChange={v => setNForm(f => ({ ...f, dividendsReceived: v }))} placeholder="0.00" />
              </div>
              <div><label className="lbl">Investment Thesis</label>
                <textarea className="fi" rows={4} value={nForm.thesis} onChange={e => setNForm(f => ({ ...f, thesis: e.target.value }))} placeholder="Why did you invest? What's the long-term view?" style={{ resize: 'vertical' }} />
              </div>
              <div><label className="lbl">Notes & Action Plan</label>
                <textarea className="fi" rows={4} value={nForm.notes} onChange={e => setNForm(f => ({ ...f, notes: e.target.value }))} placeholder="Current thoughts, planned moves, reminders…" style={{ resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn" style={{ flex: 1, padding: '10px 0' }} onClick={submitNote}>Save Notes</button>
                <button className="btn-ghost" style={{ padding: '10px 20px' }} onClick={() => setNoteFor(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, vc = '', sc = 'm' }) {
  return (
    <div className="card">
      <div style={{ fontSize: 11, color: '#4a7a4a', letterSpacing: .5, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500 }} className={vc || 'g'}>{value}</div>
      {sub && <div style={{ fontSize: 12, marginTop: 5 }} className={sc}>{sub}</div>}
    </div>
  );
}
function PRow({ ticker, name, val, pos }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #132013' }}>
      <div>
        <span style={{ color: '#5cff8c', fontSize: 13, display: 'inline-block', width: 72, fontWeight: 500 }}>{ticker}</span>
        <span style={{ color: '#4a7a4a', fontSize: 11 }}>{name?.slice(0, 22)}</span>
      </div>
      <span style={{ fontSize: 13, fontWeight: 500 }} className={pos ? 'g' : 'r'}>{val}</span>
    </div>
  );
}
function FF({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label className="lbl">{label}</label>
      <input type={type} className="fi" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
function FS({ label, value, onChange, opts }) {
  return (
    <div>
      <label className="lbl">{label}</label>
      <select className="fi" value={value} onChange={e => onChange(e.target.value)}>{opts.map(o => <option key={o}>{o}</option>)}</select>
    </div>
  );
}
