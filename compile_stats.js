const fs = require('fs');

const oceanRaw = fs.readFileSync('/sessions/magical-bold-meitner/ocean_raw.txt', 'utf8');
const mtnSunRaw = fs.readFileSync('/sessions/magical-bold-meitner/mountain_sunset_raw.txt', 'utf8');
const allRaw = oceanRaw + '\n' + mtnSunRaw;

function teamKey(teamStr) {
  const t = teamStr.toLowerCase();
  if (t.includes('nipomo')) return 'nip';
  if (t.includes('santa ynez')) return 'sy';
  if (t.includes('pvhs') || t.includes('pioneer valley')) return 'pv';
  if (t.includes('orcutt academy')) return 'oa';
  if (t.includes('santa maria') && !t.includes('st. joseph') && !t.includes('righetti')) return 'sm';
  if (t.includes('st. joseph') || t.includes('st joseph')) return 'sj';
  if (t.includes('arroyo grande')) return 'ag';
  if (t.includes('righetti')) return 'rhs';
  if (t.includes('morro bay')) return 'mb';
  if (t.includes('cabrillo') || t.includes('lompoc')) return 'cab';
  if (t.includes('mission prep')) return 'mp';
  if (t.includes('san luis obispo')) return 'slo';
  if (t.includes('templeton')) return 'temp';
  if (t.includes('atascadero')) return 'ata';
  if (t.includes('paso robles')) return 'paso';
  return 'unk';
}

function leagueOf(teamStr) {
  const t = teamStr.toLowerCase();
  if (t.includes('nipomo')||t.includes('santa ynez')||t.includes('pvhs')||t.includes('pioneer valley')||t.includes('orcutt academy')||(t.includes('santa maria')&&!t.includes('st. joseph')&&!t.includes('righetti'))) return 'ocean';
  if (t.includes('san luis obispo')||t.includes('templeton')||t.includes('atascadero')||t.includes('paso robles')||t.includes('cabrillo')||t.includes('lompoc')) return 'sunset';
  if (t.includes('st. joseph')||t.includes('st joseph')||t.includes('arroyo grande')||t.includes('righetti')||t.includes('morro bay')||t.includes('mission prep')) return 'mountain';
  return 'unknown';
}

// Parse IP string like "31.1" (31 and 1/3) to decimal 31.333
function parseIP(s) {
  if (!s || s === '0') return 0;
  const parts = s.trim().split('.');
  const whole = parseInt(parts[0]) || 0;
  const frac = parseInt(parts[1] || '0');
  return whole + frac / 3;
}

// Format decimal IP to MaxPreps style "31.1"
function formatIP(ip) {
  if (!ip) return '0';
  const whole = Math.floor(ip + 0.001);
  const frac = Math.round((ip - whole) * 3);
  if (frac === 0) return whole.toString();
  return `${whole}.${frac}`;
}

function parseSection(raw, header) {
  const lines = raw.split('\n');
  let inSection = false;
  const rows = [];
  for (const line of lines) {
    if (line.startsWith('=== ' + header)) { inSection = true; continue; }
    if (inSection && line.startsWith('===')) break;
    if (inSection && line.trim() && !line.startsWith('//')) {
      rows.push(line.trim().split('|'));
    }
  }
  return rows;
}

function buildHitterMap(baRows, obpRows, rbiRows, runsRows, sbRows) {
  const map = {};
  // BA: name|team|pa|h|ab|2b|3b|hr
  for (const r of baRows) {
    if (r.length < 8 || !r[0].trim()) continue;
    const name = r[0].trim(); const teamStr = r[1].trim();
    const key = name.toLowerCase() + '|' + teamStr.toLowerCase();
    map[key] = {
      name, team: teamKey(teamStr), league: leagueOf(teamStr),
      pa:+r[2]||0, ab:+r[4]||0, h:+r[3]||0, d:+r[5]||0, t:+r[6]||0, hr:+r[7]||0,
      r:0, rbi:0, bb:0, hbp:0, sf:0, k:0, sb:0, cs:0
    };
  }
  // OBP: name|team|bb|sf|hbp
  for (const r of obpRows) {
    if (r.length < 5) continue;
    const key = r[0].trim().toLowerCase() + '|' + r[1].trim().toLowerCase();
    if (map[key]) { map[key].bb=+r[2]||0; map[key].sf=+r[3]||0; map[key].hbp=+r[4]||0; }
  }
  // RBI: name|team|rbi
  for (const r of rbiRows) {
    if (r.length < 3) continue;
    const key = r[0].trim().toLowerCase() + '|' + r[1].trim().toLowerCase();
    if (map[key]) map[key].rbi = +r[2]||0;
  }
  // Runs: name|team|r
  for (const r of runsRows) {
    if (r.length < 3) continue;
    const key = r[0].trim().toLowerCase() + '|' + r[1].trim().toLowerCase();
    if (map[key]) map[key].r = +r[2]||0;
  }
  // SB: name|team|sb|sba
  for (const r of sbRows) {
    if (r.length < 3) continue;
    const key = r[0].trim().toLowerCase() + '|' + r[1].trim().toLowerCase();
    if (map[key]) {
      map[key].sb = +r[2]||0;
      const sba = +r[3]||0;
      map[key].cs = Math.max(0, sba - map[key].sb);
    }
  }
  return Object.values(map);
}

function buildPitcherMap(eraRows, kRows, wRows) {
  const map = {};
  // ERA: name|team|era|ip|er|[r|]bf  (may have 6 or 7 cols)
  for (const r of eraRows) {
    if (r.length < 6 || !r[0].trim()) continue;
    const name = r[0].trim(); const teamStr = r[1].trim();
    const key = name.toLowerCase() + '|' + teamStr.toLowerCase();
    const ipDecimal = parseIP(r[3].trim());
    // 6 cols: name|team|era|ip|er|bf  or 7 cols: name|team|era|ip|er|r|bf
    const er = +r[4]||0;
    const bf = r.length >= 7 ? (+r[6]||0) : (+r[5]||0);
    map[key] = {
      name, team: teamKey(teamStr), league: leagueOf(teamStr),
      g:0, gs:0, w:0, l:0, ip: ipDecimal,
      h:0, r:0, er, bb:0, k:0, hr:0, hbp:0, bf
    };
  }
  // K: name|team|k|bf|ip
  for (const r of kRows) {
    if (r.length < 4 || !r[0].trim()) continue;
    const key = r[0].trim().toLowerCase() + '|' + r[1].trim().toLowerCase();
    const k = +r[2]||0;
    const bf = +r[3]||0;
    if (map[key]) {
      map[key].k = k;
      if (!map[key].bf || map[key].bf < bf) map[key].bf = bf;
    } else {
      const ipDecimal = parseIP(r[4]||'0');
      map[key] = {
        name: r[0].trim(), team: teamKey(r[1].trim()), league: leagueOf(r[1].trim()),
        g:0, gs:0, w:0, l:0, ip: ipDecimal,
        h:0, r:0, er:0, bb:0, k, hr:0, hbp:0, bf
      };
    }
  }
  // W: name|team|w|l
  for (const r of wRows) {
    if (r.length < 4) continue;
    const key = r[0].trim().toLowerCase() + '|' + r[1].trim().toLowerCase();
    if (map[key]) { map[key].w=+r[2]||0; map[key].l=+r[3]||0; }
  }
  return Object.values(map);
}

// Parse sections
const oceanBA   = parseSection(allRaw, 'OCEAN BA PAGE');
const oceanOBP  = parseSection(allRaw, 'OCEAN OBP PAGE');
const oceanRBI  = parseSection(allRaw, 'OCEAN RBI PAGE');
const oceanRuns = parseSection(allRaw, 'OCEAN RUNS PAGE');
const oceanSB   = parseSection(allRaw, 'OCEAN SB PAGE');
const oceanERA  = parseSection(allRaw, 'OCEAN ERA PAGE');
const oceanK    = parseSection(allRaw, 'OCEAN K PAGE');
const oceanW    = parseSection(allRaw, 'OCEAN W PAGE');
const mtnBA     = parseSection(allRaw, 'MOUNTAIN BA PAGE');
const mtnOBP    = parseSection(allRaw, 'MOUNTAIN OBP PAGE');
const mtnRBI    = parseSection(allRaw, 'MOUNTAIN RBI PAGE');
const mtnRuns   = parseSection(allRaw, 'MOUNTAIN RUNS PAGE');
const mtnSB     = parseSection(allRaw, 'MOUNTAIN SB PAGE');
const mtnERA    = parseSection(allRaw, 'MOUNTAIN ERA PAGE');
const mtnK      = parseSection(allRaw, 'MOUNTAIN K PAGE');
const mtnW      = parseSection(allRaw, 'MOUNTAIN W PAGE');
const sunBA     = parseSection(allRaw, 'SUNSET BA PAGE');
const sunOBP    = parseSection(allRaw, 'SUNSET OBP PAGE');
const sunRBI    = parseSection(allRaw, 'SUNSET RBI PAGE');
const sunRuns   = parseSection(allRaw, 'SUNSET RUNS PAGE');
const sunERA    = parseSection(allRaw, 'SUNSET ERA PAGE');
const sunK      = parseSection(allRaw, 'SUNSET K PAGE');
const sunW      = parseSection(allRaw, 'SUNSET W PAGE');

const allHitters = [
  ...buildHitterMap(oceanBA, oceanOBP, oceanRBI, oceanRuns, oceanSB),
  ...buildHitterMap(mtnBA, mtnOBP, mtnRBI, mtnRuns, mtnSB),
  ...buildHitterMap(sunBA, sunOBP, sunRBI, sunRuns, [])
];
const allPitchers = [
  ...buildPitcherMap(oceanERA, oceanK, oceanW),
  ...buildPitcherMap(mtnERA, mtnK, mtnW),
  ...buildPitcherMap(sunERA, sunK, sunW)
];

// Quality filters
const qualHitters  = allHitters.filter(h => h.pa >= 15 && h.team !== 'unk' && h.league !== 'unknown');
const qualPitchers = allPitchers.filter(p => p.bf >= 25 && p.team !== 'unk' && p.league !== 'unknown');

function esc(s) { return s.replace(/'/g, "\\'"); }

function fmtHitter(h) {
  return `  {name:'${esc(h.name)}', team:'${h.team}', league:'${h.league}', pa:${h.pa}, ab:${h.ab}, h:${h.h}, d:${h.d}, t:${h.t}, hr:${h.hr}, r:${h.r}, rbi:${h.rbi}, bb:${h.bb}, hbp:${h.hbp}, sf:${h.sf}, k:${h.k}, sb:${h.sb}, cs:${h.cs}}`;
}

function fmtPitcher(p) {
  const ipStr = formatIP(p.ip);
  return `  {name:'${esc(p.name)}', team:'${p.team}', league:'${p.league}', w:${p.w}, l:${p.l}, ip:${p.ip.toFixed(4)}, bf:${p.bf||0}, er:${p.er}, k:${p.k}, hbp:${p.hbp}}`;
}

const hitterJS  = 'const RAW_HITTERS = [\n' + qualHitters.map(fmtHitter).join(',\n') + '\n];';
const pitcherJS = 'const RAW_PITCHERS = [\n' + qualPitchers.map(fmtPitcher).join(',\n') + '\n];';

fs.writeFileSync('/sessions/magical-bold-meitner/compiled_stats.js', hitterJS + '\n\n' + pitcherJS);

// Spot-check
const tj = qualPitchers.find(p => p.name === 'Tristin Jeckell');
const bh = qualHitters.find(h => h.name === 'Beau Hageman');
console.log(`✓ ${qualHitters.length} hitters, ${qualPitchers.length} pitchers`);
console.log('Tristin Jeckell:', JSON.stringify(tj));
console.log('Beau Hageman:', JSON.stringify(bh));

// Check league distribution
const byLeague = {};
for (const h of qualHitters) byLeague[h.league] = (byLeague[h.league]||0)+1;
console.log('Hitters by league:', byLeague);
const pl = {};
for (const p of qualPitchers) pl[p.league] = (pl[p.league]||0)+1;
console.log('Pitchers by league:', pl);
