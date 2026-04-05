/**
 * CCAA Baseball Stats Scraper
 * Scrapes all 16 MaxPreps team stats pages to get complete, accurate player data.
 * Runs via GitHub Actions daily at 7 AM PDT and injects data into ccaa-baseball.html.
 *
 * Why team pages instead of leaderboards?
 *   - Leaderboards only show top ~25 players per stat category.
 *   - Pitchers not on the ERA leaderboard get er=0, causing fake 0.00 ERAs (the Glover bug).
 *   - Team pages show EVERY player's complete stats: H, BB, K, ER, HR, HBP, etc.
 *
 * Print page URLs (faster, single-page, no tab-clicking) are used for 13 of 16 teams.
 * 3 teams fall back to the tab-click approach on their regular stats page.
 */

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

// ─── SEASON ID & PRINT URL BUILDER ──────────────────────────────────────────
const SSID = '1278779e-84df-4e60-8d03-db0024535aa6';
const pu   = id =>
  `https://www.maxpreps.com/print/team_stats.aspx?admin=0&bygame=0&league=0&print=1&schoolid=${id}&ssid=${SSID}`;

// ─── TEAM LIST ──────────────────────────────────────────────────────────────
const TEAMS = [
  // Mountain Division
  { id:'sj',   league:'mountain',
    homeUrl:  'https://www.maxpreps.com/ca/santa-maria/st-joseph-knights/baseball/',
    printUrl: pu('d627010f-8cc6-4595-9671-4456885d7143') },
  { id:'ag',   league:'mountain',
    homeUrl:  'https://www.maxpreps.com/ca/arroyo-grande/arroyo-grande-eagles/baseball/',
    printUrl: pu('59e38f88-dd08-4300-a8a6-680a6516ac0a') },
  { id:'rhs',  league:'mountain',
    homeUrl:  'https://www.maxpreps.com/ca/santa-maria/righetti-warriors/baseball/',
    printUrl: pu('e6b0bf04-c252-41b4-b21a-bd3032b33b2c') },
  { id:'mb',   league:'mountain',
    homeUrl:  'https://www.maxpreps.com/ca/morro-bay/morro-bay-pirates/baseball/',
    printUrl: pu('494bf68f-157f-4cfa-af68-a897b6b940b4') },
  // mp and lom don't have player stats on MaxPreps — appear in standings only

  // Sunset Division
  { id:'slo',  league:'sunset',
    homeUrl:  'https://www.maxpreps.com/ca/san-luis-obispo/san-luis-obispo-tigers/baseball/',
    printUrl: pu('e3798ac4-f77c-4305-b7c1-ec498ea3adfc') },
  { id:'paso', league:'sunset',
    homeUrl:  'https://www.maxpreps.com/ca/paso-robles/paso-robles-bearcats/baseball/',
    printUrl: pu('2d42cf4d-74e8-4d22-b8c7-19225ea48c66') },
  { id:'ata',  league:'sunset',
    homeUrl:  'https://www.maxpreps.com/ca/atascadero/atascadero-greyhounds/baseball/',
    printUrl: pu('9843fbe7-3edf-4251-af14-2ddccb35806d') },
  { id:'temp', league:'sunset',
    homeUrl:  'https://www.maxpreps.com/ca/templeton/templeton-eagles/baseball/',
    printUrl: pu('1776def6-b0a7-4804-b98f-b7444a6e08ac') },
  { id:'cab',  league:'sunset',
    homeUrl:  'https://www.maxpreps.com/ca/lompoc/cabrillo-conquistadores/baseball/',
    printUrl: pu('fe0bbe85-0ab5-4eca-b6e5-f8d2eac48157') },

  // Ocean Division
  { id:'pv',   league:'ocean',
    homeUrl:  'https://www.maxpreps.com/ca/santa-maria/pioneer-valley-panthers/baseball/',
    printUrl: pu('af11ad42-5dd9-41e6-9d05-35a4707d5f45') },
  { id:'nip',  league:'ocean',
    homeUrl:  'https://www.maxpreps.com/ca/nipomo/nipomo-titans/baseball/',
    printUrl: pu('8deefa29-1f29-448b-a77e-b9b7973cd529') },
  { id:'sy',   league:'ocean',
    homeUrl:  'https://www.maxpreps.com/ca/santa-ynez/santa-ynez-pirates/baseball/',
    printUrl: pu('3b39e1dd-f577-417e-892a-2cbae905dfb2') },
  { id:'sm',   league:'ocean',
    homeUrl:  'https://www.maxpreps.com/ca/santa-maria/santa-maria-saints/baseball/',
    printUrl: pu('5fff6cdf-6099-4cfb-9297-5734517e28ff') },
  // oa doesn't have player stats on MaxPreps — appears in standings only
];

// ─── STANDINGS LEAGUE URLS (live from MaxPreps conference pages) ─────────────
const STANDINGS_LEAGUES = [
  { id:'mountain', name:'Mountain League', sub:'CCAA — Mountain', colorClass:'mountain',
    url:   'https://www.maxpreps.com/ca/baseball/25-26/league/ccaa--mountain/?leagueid=997fc154-7b9c-4f2c-b22f-242464a7c81c',
    mpUrl: 'https://www.maxpreps.com/ca/baseball/25-26/league/ccaa--mountain/?leagueid=997fc154-7b9c-4f2c-b22f-242464a7c81c' },
  { id:'sunset',   name:'Sunset League',   sub:'CCAA — Sunset',   colorClass:'sunset',
    url:   'https://www.maxpreps.com/ca/baseball/25-26/league/ccaa--sunset/?leagueid=fb2b85ea-c8d0-4acf-873c-3296a5780eff',
    mpUrl: 'https://www.maxpreps.com/ca/baseball/25-26/league/ccaa--sunset/?leagueid=fb2b85ea-c8d0-4acf-873c-3296a5780eff' },
  { id:'ocean',    name:'Ocean League',    sub:'CCAA — Ocean',    colorClass:'ocean',
    url:   'https://www.maxpreps.com/ca/baseball/25-26/league/ccaa--ocean/?leagueid=692cdcda-f9c9-46d2-a584-e075f5b97c75',
    mpUrl: 'https://www.maxpreps.com/ca/baseball/25-26/league/ccaa--ocean/?leagueid=692cdcda-f9c9-46d2-a584-e075f5b97c75' }
];

// ─── HELPERS ────────────────────────────────────────────────────────────────
function cleanName(raw) {
  // "A. Bluem(Jr)" → "A. Bluem"
  return (raw || '').replace(/\s*\((Fr|So|Jr|Sr|8th|9th|10th|11th|12th)\)/gi, '').trim();
}

function parseIP(s) {
  // Convert baseball IP notation to decimal: "21.1" → 21.333, "21.2" → 21.667
  if (!s) return 0;
  const str = s.toString().trim();
  if (!str || str === '0') return 0;
  const parts = str.split('.');
  const whole = parseInt(parts[0]) || 0;
  const frac  = parseInt(parts[1] || 0);
  return whole + frac / 3;
}

const int = (s) => parseInt(s) || 0;

// Look up a value in a row-object by trying multiple possible column names
function colVal(obj, ...keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== '') return obj[k];
  }
  return '';
}

// ─── STANDINGS SCRAPER (live from MaxPreps conference pages only) ────────────
async function scrapeStandings(page) {
  const result = {};
  console.log('\n=== Scraping standings from MaxPreps conference pages ===');

  for (const lg of STANDINGS_LEAGUES) {
    try {
      console.log(`  Loading ${lg.name}: ${lg.url}`);
      await page.goto(lg.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2500);

      const teams = await page.evaluate(() => {
        const rows = document.querySelectorAll('table tbody tr');
        return Array.from(rows).map((r, i) => {
          const cells = Array.from(r.querySelectorAll('td'));
          const link  = r.querySelector('a');

          // MaxPreps standings column layout:
          // 0:rank | 1:name | 2:conf W-L | 3:conf pct | 4:RS | 5:RA | 6:overall | 7:ov pct | 8:ovRS | 9:ovRA | 10:streak
          const confWL  = (cells[2]?.textContent.trim() || '0-0').split('-');
          const ovRaw   = cells[6]?.textContent.trim() || '0-0';
          const ovParts = ovRaw.split('-');
          const streakRaw = cells[10]?.textContent.trim() || '';
          const sNum  = parseInt(streakRaw) || 0;
          const sType = streakRaw.endsWith('W') ? 'W' : 'L';

          return {
            rank: i + 1,
            name: cells[1]?.textContent.trim() || '',
            url:  link?.href || '',
            cw:   parseInt(confWL[0]) || 0,
            cl:   parseInt(confWL[1]) || 0,
            ow:   parseInt(ovParts[0]) || 0,
            ol:   parseInt(ovParts[1]) || 0,
            ot:   parseInt(ovParts[2]) || 0,
            streak: sType + sNum
          };
        });
      });

      // Compute GB relative to first-place team
      if (teams.length > 0) {
        const lw = teams[0].cw;
        const ll = teams[0].cl;
        teams.forEach(t => {
          t.gb = t.rank === 1 ? 0 : ((lw - ll) - (t.cw - t.cl)) / 2;
        });
      }

      result[lg.id] = teams;
      console.log(`  ✓ ${lg.name}: ${teams.length} teams`);
    } catch (err) {
      console.error(`  ✗ ${lg.name} standings error: ${err.message}`);
      result[lg.id] = [];
    }
  }

  return result;
}

// ─── GENERATE STANDINGS HTML BLOCK ──────────────────────────────────────────
function generateStandingsHTML(standings) {
  const blocks = STANDINGS_LEAGUES.map(lg => {
    const teams = standings[lg.id] || [];

    const rows = teams.map((t, i) => {
      const rankClass = i === 0 ? 'rank first' : 'rank';
      const gbStr = t.gb === 0
        ? '—'
        : (t.gb % 1 === 0 ? String(t.gb) : t.gb.toFixed(1));
      const streakType = t.streak.charAt(0);
      const streakNum  = t.streak.slice(1);
      const streakSpan = streakType === 'W'
        ? `<span class="w-streak">W${streakNum}</span>`
        : `<span class="l-streak">L${streakNum}</span>`;
      const total = t.cw + t.cl;
      const pct   = total === 0 ? '.000' : (t.cw / total).toFixed(3).replace(/^0/, '');
      const ov    = t.ot ? `${t.ow}-${t.ol}-${t.ot}` : `${t.ow}-${t.ol}`;

      return `          <tr><td class="${rankClass}">${t.rank}</td><td class="team-name-cell"><a href="${t.url}" target="_blank">${t.name}</a></td><td class="w">${t.cw}</td><td class="l">${t.cl}</td><td class="pct">${pct}</td><td class="gb">${gbStr}</td><td class="streak">${streakSpan}</td><td style="color:var(--muted);font-size:.78rem">${ov}</td></tr>`;
    }).join('\n');

    return `    <div class="league-block" data-league="${lg.id}">
      <div class="league-block-header">
        <div class="league-color-bar ${lg.colorClass}"></div>
        <div><div class="league-block-name">${lg.name}</div><div class="league-block-sub">${lg.sub}</div></div>
        <a class="league-mp-link" href="${lg.mpUrl}" target="_blank">MaxPreps ↗</a>
      </div>
      <table class="standings-tbl">
        <thead><tr><th>#</th><th style="text-align:left">Team</th><th>W</th><th>L</th><th>PCT</th><th>GB</th><th>Str</th><th>Overall</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>`;
  }).join('\n');

  return `<!-- ══════════ STANDINGS ══════════ -->
<div id="standings" class="section">
  <div class="standings-grid">
${blocks}
  </div>
</div>

`;
}

// ─── PRINT PAGE SCRAPER ──────────────────────────────────────────────────────
async function scrapeFromPrintPage(page, team) {
  console.log(`[${team.id.toUpperCase()}] (print) ${team.printUrl}`);

  try {
    await page.goto(team.printUrl, { waitUntil: 'networkidle', timeout: 45000 });
    // Wait for at least one table to appear (print pages may render via JS)
    try {
      await page.waitForSelector('table', { timeout: 10000 });
    } catch {
      console.log(`  [${team.id.toUpperCase()}] No table found after 10s — falling back to tab-click`);
      return scrapeFromTeamPage(page, team);
    }
    await page.waitForTimeout(1000);

    // Extract all tables from the print page
    const tables = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('table')).map(t => {
        // Only use <thead> or first <tr> for headers (MaxPreps print pages use <th>
        // in tbody rows for player name cells, which would pollute the header list)
        const theadThs = t.querySelectorAll('thead th');
        const headerEls = theadThs.length
          ? Array.from(theadThs)
          : Array.from((t.querySelector('tr') || {querySelectorAll:()=>[]}).querySelectorAll('th, td'));
        const headers = headerEls.map(el =>
          el.textContent.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
        );
        // Include both <th> and <td> cells in each data row (player name is often a <th>)
        const rows = Array.from(t.querySelectorAll('tbody tr, tr')).slice(theadThs.length ? 0 : 1).map(tr =>
          Array.from(tr.querySelectorAll('th, td')).map(td => td.textContent.trim())
        ).filter(cells => cells.length > 1);
        return { headers, rows };
      });
    });

    // Log all table headers found (helps debug mismatches)
    console.log(`  tables found: ${tables.length}, headers: ${tables.map(t => '['+t.headers.join(',')+']').join(' ')}`);


    // Identify tables by their column headers
    let batTable  = null;
    let pitTable  = null;
    let brTable   = null;

    for (const tbl of tables) {
      const h = tbl.headers;
      if (h.includes('pa') && h.includes('ab')) {
        batTable = tbl;
      } else if (h.includes('ip') && (h.includes('er') || h.includes('era'))) {
        pitTable = tbl;
      } else if (h.includes('sb') && h.includes('sba') && !h.includes('ip')) {
        brTable = tbl;
      }
    }

    // Helper: build row object from normalized headers
    function makeRowObj(tbl, row) {
      const obj = {};
      tbl.headers.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    }

    // ── Build HITTERS ──
    const hitters = [];
    if (batTable) {
      batTable.rows.forEach(row => {
        const b = makeRowObj(batTable, row);
        const name = colVal(b, 'name', 'player', 'playername', 'athletename');
        if (!name) return;
        const lc = name.toLowerCase();
        if (lc.includes('total') || lc.includes('season')) return;

        // Stolen bases — prefer baserunning table if available, else use batting table columns
        let sb = 0, cs = 0;
        if (brTable) {
          const brRow = brTable.rows.find(r => {
            const n = makeRowObj(brTable, r);
            const rName = n['name'] || n['player'] || '';
            return cleanName(rName).toLowerCase() === cleanName(name).toLowerCase();
          });
          if (brRow) {
            const br = makeRowObj(brTable, brRow);
            sb = int(colVal(br, 'sb'));
            const sba = int(colVal(br, 'sba'));
            cs = Math.max(0, sba - sb);
          }
        } else {
          sb = int(colVal(b, 'sb'));
          const sba = int(colVal(b, 'sba'));
          cs = Math.max(0, sba - sb);
        }

        hitters.push({
          name:   cleanName(name),
          team:   team.id,
          league: team.league,
          pa:     int(colVal(b, 'pa')),
          ab:     int(colVal(b, 'ab')),
          h:      int(colVal(b, 'h', 'hits')),
          d:      int(colVal(b, '2b', 'doubles')),
          t:      int(colVal(b, '3b', 'triples')),
          hr:     int(colVal(b, 'hr')),
          r:      int(colVal(b, 'r', 'runs')),
          rbi:    int(colVal(b, 'rbi')),
          bb:     int(colVal(b, 'bb')),
          hbp:    int(colVal(b, 'hbp')),
          sf:     int(colVal(b, 'sf')),
          k:      int(colVal(b, 'k', 'so', 'strikeouts')),
          sb,
          cs,
        });
      });
    }

    // ── Build PITCHERS ──
    const pitchers = [];
    if (pitTable) {
      pitTable.rows.forEach(row => {
        const p = makeRowObj(pitTable, row);
        const name = colVal(p, 'name', 'player', 'playername', 'athletename');
        if (!name) return;
        const lc = name.toLowerCase();
        if (lc.includes('total') || lc.includes('season')) return;

        pitchers.push({
          name:   cleanName(name),
          team:   team.id,
          league: team.league,
          w:      int(colVal(p, 'w', 'wins')),
          l:      int(colVal(p, 'l', 'losses')),
          ip:     parseIP(colVal(p, 'ip')),
          bf:     int(colVal(p, 'bf')),
          er:     int(colVal(p, 'er')),
          k:      int(colVal(p, 'k', 'so', 'strikeouts')),
          h:      int(colVal(p, 'h', 'hits')),
          bb:     int(colVal(p, 'bb')),
          hr:     int(colVal(p, 'hr')),
          hbp:    int(colVal(p, 'hbp')),
        });
      });
    }

    // If print page yielded nothing, fall back to tab-click approach
    if (hitters.length === 0 && pitchers.length === 0) {
      console.log(`  [${team.id.toUpperCase()}] Print page yielded 0 results — falling back to tab-click`);
      return scrapeFromTeamPage(page, team);
    }

    console.log(`  ✓ ${hitters.length} hitters, ${pitchers.length} pitchers`);
    return { hitters, pitchers };

  } catch (err) {
    console.error(`  ✗ ERROR (print page): ${err.message} — falling back to tab-click`);
    return scrapeFromTeamPage(page, team);
  }
}

// ─── PAGE SCRAPING HELPERS (tab-click fallback) ──────────────────────────────
async function clickSubTab(page, text) {
  try {
    const btn = await page.$(`button:has-text("${text}")`);
    if (btn) { await btn.click(); await page.waitForTimeout(700); return; }
  } catch {}
  await page.evaluate((t) => {
    const els = Array.from(document.querySelectorAll('button, [role="tab"], span, a'));
    const el = els.find(e => e.textContent.trim() === t);
    if (el) el.click();
  }, text);
  await page.waitForTimeout(700);
}

async function scrapeTables(page) {
  return await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    return tables.map(t => {
      const headers = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim());
      const rows = Array.from(t.querySelectorAll('tr')).slice(1).map(tr =>
        Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim())
      ).filter(cells => cells.length > 0 && cells[1]);
      return { headers, rows };
    });
  });
}

// ─── TAB-CLICK FALLBACK SCRAPER ──────────────────────────────────────────────
async function scrapeFromTeamPage(page, team) {
  console.log(`[${team.id.toUpperCase()}] (tabs) ${team.homeUrl}stats/`);

  try {
    await page.goto(team.homeUrl + 'stats/', {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });
    await page.waitForTimeout(3500);

    await clickSubTab(page, 'Player Stats');

    // ── BATTING ──
    await clickSubTab(page, 'Batting');
    const batTables = await scrapeTables(page);
    const bat0 = batTables[0] || { headers:[], rows:[] };
    const bat1 = batTables[1] || { headers:[], rows:[] };

    // ── BASERUNNING ──
    await clickSubTab(page, 'Baserunning');
    const brTables = await scrapeTables(page);
    const br0 = brTables[0] || { headers:[], rows:[] };

    // ── PITCHING ──
    await clickSubTab(page, 'Pitching');
    const pitTables = await scrapeTables(page);
    const pit0 = pitTables[0] || { headers:[], rows:[] };
    const pit1 = pitTables[1] || { headers:[], rows:[] };
    const pit2 = pitTables[2] || { headers:[], rows:[] };

    function rowObj(table, rowIdx) {
      const { headers, rows } = table;
      const row = rows[rowIdx];
      if (!row) return {};
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    }

    // ── Build HITTERS ──
    const hitters = [];
    bat0.rows.forEach((_, i) => {
      const b0 = rowObj(bat0, i);
      const name = b0['Name'];
      if (!name || name === 'Season Totals') return;

      const b1 = rowObj(bat1, i);
      const brRow = br0.rows.find((r, j) => rowObj(br0, j)['Name'] === name);
      const brObj = brRow ? (() => {
        const obj = {};
        br0.headers.forEach((h, i) => { obj[h] = brRow[i] || ''; });
        return obj;
      })() : {};

      const sb  = int(brObj['SB']);
      const sba = int(brObj['SBA']);
      const cs  = Math.max(0, sba - sb);

      hitters.push({
        name:   cleanName(name),
        team:   team.id,
        league: team.league,
        pa:     int(b0['PA']),
        ab:     int(b0['AB']),
        h:      int(b0['H']),
        d:      int(b0['2B']),
        t:      int(b0['3B']),
        hr:     int(b0['HR']),
        r:      int(b0['R']),
        rbi:    int(b0['RBI']),
        bb:     int(b1['BB']),
        hbp:    int(b1['HBP']),
        sf:     int(b1['SF']),
        k:      int(b1['K']),
        sb,
        cs,
      });
    });

    // ── Build PITCHERS ──
    const pitchers = [];
    pit0.rows.forEach((_, i) => {
      const p0 = rowObj(pit0, i);
      const name = p0['Name'];
      if (!name || name === 'Season Totals') return;

      const p1 = rowObj(pit1, i);
      const p2 = rowObj(pit2, i);

      pitchers.push({
        name:   cleanName(name),
        team:   team.id,
        league: team.league,
        w:      int(p0['W']),
        l:      int(p0['L']),
        ip:     parseIP(p1['IP']),
        bf:     int(p1['BF']),
        er:     int(p1['ER']),
        k:      int(p1['K']),
        h:      int(p1['H']),
        bb:     int(p1['BB']),
        hr:     int(p1['HR']),
        hbp:    int(p2['HBP']),
      });
    });

    console.log(`  ✓ ${hitters.length} hitters, ${pitchers.length} pitchers`);
    return { hitters, pitchers };

  } catch (err) {
    console.error(`  ✗ ERROR: ${err.message}`);
    return { hitters: [], pitchers: [] };
  }
}

// ─── SCRAPE ONE TEAM (routes to print page or tab-click fallback) ─────────────
async function scrapeTeam(page, team) {
  if (team.printUrl) {
    return scrapeFromPrintPage(page, team);
  } else {
    return scrapeFromTeamPage(page, team);
  }
}

// ─── FORMAT OUTPUT  b��────────────────────────────────────────────────────────────
function fmtHitter(p) {
  const n = JSON.stringify(p.name);
  return `   {name:${n}, team:'${p.team}', league:'${p.league}', pa:${p.pa}, ab:${p.ab}, h:${p.h}, d:${p.d}, t:${p.t}, hr:${p.hr}, r:${p.r}, rbi:${p.rbi}, bb:${p.bb}, hbp:${p.hbp}, sf:${p.sf}, k:${p.k}, sb:${p.sb}, cs:${p.cs}}`;
}

function fmtPitcher(p) {
  const n = JSON.stringify(p.name);
  return `   {name:${n}, team:'${p.team}', league:'${p.league}', w:${p.w}, l:${p.l}, ip:${p.ip.toFixed(4)}, bf:${p.bf}, er:${p.er}, k:${p.k}, h:${p.h}, bb:${p.bb}, hr:${p.hr}, hbp:${p.hbp}}`;
}

// ─── INJECT INTO HTML ─────────────────────────────────────────────────────────
function injectIntoHTML(allHitters, allPitchers, standingsData, today) {
  const htmlPath = path.join(__dirname, '..', 'ccaa-baseball.html');
  if (!fs.existsSync(htmlPath)) {
    console.error('ccaa-baseball.html not found at:', htmlPath);
    return false;
  }

  let html = fs.readFileSync(htmlPath, 'utf8');

  const hitStr   = allHitters.map(fmtHitter).join(',\n');
  const pitchStr = allPitchers.map(fmtPitcher).join(',\n');

  // Replace RAW_HITTERS
  const hitPattern = /const RAW_HITTERS\s*=\S*\[[\s\S]*?\];/;
  if (!hitPattern.test(html)) {
    console.error('Could not find RAW_HITTERS in HTML');
    return false;
  }
  html = html.replace(hitPattern, `const RAW_HITTERS = [\n${hitStr}\n];`);

  // Replace RAW_PITCHERS
  const pitchPattern = /const RAW_PITCHERS\s*=\s*\[[\s\S]*?\];/;
  if (!pitchPattern.test(html)) {
    console.error('Could not find RAW_PITCHERS in HTML');
    return false;
  }
  html = html.replace(pitchPattern, `const RAW_PITCHERS = [\n${pitchStr}\n];`);

  // Update last-updated date in the stats notice
  html = html.replace(
    /Stats auto-updated.*?(?=<\/span>|\.)/,
    `Stats auto-updated ${today}`
  );

  // Ensure correct league assignments (Cabrillo=sunset, Morro Bay=mountain)
  html = html.replace(/(cab:\s*\{[^}]*?short:'CAB',\s*league:)'mountain'/, "$1'sunset'  ");
  html = html.replace(/(mb:\s*\{[^}]*?short:'MB',\s*league:)'sunset'\s*/, "$1'mountain'");

  // Replace the entire standings section with fresh data scraped live from MaxPreps conference pages
  if (standingsData) {
    const standingsPattern = /<!-- ══════════ STANDINGS ══════════ -->[\s\S]*?(?=<!-- ══════════ STATS)/;
    if (standingsPattern.test(html)) {
      html = html.replace(standingsPattern, generateStandingsHTML(standingsData));
      console.log('✓ Standings updated from live MaxPreps conference pages');
    } else {
      console.warn('Could not find STANDINGS section marker — skipping standings update');
    }
  }

  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log(`\n✓ Wrote ccaa-baseball.html (${allHitters.length} hitters, ${allPitchers.length} pitchers)`);
  return true;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const today = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short', day: 'numeric', year: 'numeric'
  });
  console.log(`\n=== CCAA Baseball Scraper — ${today} ===\n`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 }
  });

  const page = await context.newPage();
  page.on('console', () => {});

  const allHitters  = [];
  const allPitchers = [];
  const errors      = [];

  for (const team of TEAMS) {
    const { hitters, pitchers } = await scrapeTeam(page, team);
    if (hitters.length === 0 && pitchers.length === 0) {
      errors.push(team.id);
    }
    allHitters.push(...hitters);
    allPitchers.push(...pitchers);
    await page.waitForTimeout(1000);
  }

  // Scrape standings live from MaxPreps conference pages (not from any cached files)
  const standingsData = await scrapeStandings(page);

  await browser.close();

  console.log(`\n=== RESULTS ===`);
  console.log(`Total hitters:  ${allHitters.length}`);
  console.log(`Total pitchers: ${allPitchers.length}`);
  if (errors.length) console.warn(`Teams with errors: ${errors.join(', ')}`);

  if (allHitters.length < 10) {
    console.error('Too few hitters scraped — aborting HTML update to avoid data loss');
    process.exit(1);
  }

  const ok = injectIntoHTML(allHitters, allPitchers, standingsData, today);
  if (!ok) process.exit(1);

  const backupPath = path.join(__dirname, 'last-scrape.json');
  fs.writeFileSync(backupPath, JSON.stringify({
    date: today,
    hitterCount: allHitters.length,
    pitcherCount: allPitchers.length,
    hitters: allHitters,
    pitchers: allPitchers
  }, null, 2));
  console.log(`✓ Backup saved to scraper/last-scrape.json`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
