/**
 * CCAA Baseball Stats Scraper
 * Scrapes all 16 MaxPreps team stats pages to get complete, accurate player data.
 * Runs via GitHub Actions daily at 7 AM PDT and injects data into ccaa-baseball.html.
 *
 * Why team pages instead of leaderboards?
 *   - Leaderboards only show top ~25 players per stat category.
 *   - Pitchers not on the ERA leaderboard get er=0, causing fake 0.00 ERAs (the Glover bug).
 *   - Team pages show EVERY player's complete stats: H, BB, K, ER, HR, HBP, etc.
 */

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

// ââ TEAM LIST âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const TEAMS = [
  // Mountain Division
  { id:'sj',   league:'mountain', url:'https://www.maxpreps.com/ca/santa-maria/st-joseph-knights/baseball/' },
  { id:'ag',   league:'mountain', url:'https://www.maxpreps.com/ca/arroyo-grande/arroyo-grande-eagles/baseball/' },
  { id:'rhs',  league:'mountain', url:'https://www.maxpreps.com/ca/santa-maria/righetti-warriors/baseball/' },
  { id:'mb',   league:'mountain', url:'https://www.maxpreps.com/ca/morro-bay/morro-bay-pirates/baseball/' },
  { id:'mp',   league:'mountain', url:'https://www.maxpreps.com/ca/san-luis-obispo/mission-college-prep-royals/baseball/' },
  { id:'lom',  league:'mountain', url:'https://www.maxpreps.com/ca/lompoc/lompoc-braves/baseball/' },
  // Sunset Division
  { id:'slo',  league:'sunset',   url:'https://www.maxpreps.com/ca/san-luis-obispo/san-luis-obispo-tigers/baseball/' },
  { id:'paso', league:'sunset',   url:'https://www.maxpreps.com/ca/paso-robles/paso-robles-bearcats/baseball/' },
  { id:'ata',  league:'sunset',   url:'https://www.maxpreps.com/ca/atascadero/atascadero-greyhounds/baseball/' },
  { id:'temp', league:'sunset',   url:'https://www.maxpreps.com/ca/templeton/templeton-eagles/baseball/' },
  { id:'cab',  league:'sunset',   url:'https://www.maxpreps.com/ca/lompoc/cabrillo-conquistadores/baseball/' },
  // Ocean Division
  { id:'pv',   league:'ocean',    url:'https://www.maxpreps.com/ca/santa-maria/pioneer-valley-panthers/baseball/' },
  { id:'nip',  league:'ocean',    url:'https://www.maxpreps.com/ca/nipomo/nipomo-titans/baseball/' },
  { id:'sy',   league:'ocean',    url:'https://www.maxpreps.com/ca/santa-ynez/santa-ynez-pirates/baseball/' },
  { id:'sm',   league:'ocean',    url:'https://www.maxpreps.com/ca/santa-maria/santa-maria-saints/baseball/' },
  { id:'oa',   league:'ocean',    url:'https://www.maxpreps.com/ca/orcutt/orcutt-academy-spartans/baseball/' },
];

// âââ HELPERS ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function cleanName(raw) {
  // "A. Bluem(Jr)" â "A. Bluem"
  return (raw || '').replace(/\s*\((Fr|So|Jr|Sr|8th|9th|10th|11th|12th)\)/gi, '').trim();
}

function parseIP(s) {
  // Convert baseball IP notation to decimal: "21.1" â 21.333, "21.2" â 21.667
  if (!s) return 0;
  const str = s.toString().trim();
  if (!str || str === '0') return 0;
  const parts = str.split('.');
  const whole = parseInt(parts[0]) || 0;
  const frac  = parseInt(parts[1] || 0);
  return whole + frac / 3;
}

const int = (s) => parseInt(s) || 0;

// âââ PAGE SCRAPING HELPERS âââââââââââââââââââââââââââââââââââââââââââââââââââ
async function clickSubTab(page, text) {
  try {
    // Try button first
    const btn = await page.$(`button:has-text("${text}")`);
    if (btn) { await btn.click(); await page.waitForTimeout(700); return; }
  } catch {}
  // Fall back to JS click
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
      ).filter(cells => cells.length > 0 && cells[1]); // skip empty & totals rows
      return { headers, rows };
    });
  });
}

// âââ SCRAPE ONE TEAM âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
async function scrapeTeam(page, team) {
  console.log(`\n[${team.id.toUpperCase()}] ${team.url}stats/`);

  try {
    await page.goto(team.url + 'stats/', {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });
    await page.waitForTimeout(2500);

    // ââ Click into Player Stats view ââ
    await clickSubTab(page, 'Player Stats');

    // ââ BATTING ââ
    await clickSubTab(page, 'Batting');
    const batTables = await scrapeTables(page);
    // bat0: #,Name,GP,Avg,PA,AB,R,H,RBI,2B,3B,HR,GS
    // bat1: #,Name,GP,SF,SH/B,BB,K,HBP,ROE,FC,LOB,OBP,SLG,OPS
    const bat0 = batTables[0] || { headers:[], rows:[] };
    const bat1 = batTables[1] || { headers:[], rows:[] };

    // ââ BASERUNNING ââ
    await clickSubTab(page, 'Baserunning');
    const brTables = await scrapeTables(page);
    // br0: #,Name,GP,SB,SBA
    const br0 = brTables[0] || { headers:[], rows:[] };

    // ââ PITCHING ââ
    await clickSubTab(page, 'Pitching');
    const pitTables = await scrapeTables(page);
    // pit0: #,Name,ERA,W,L,W%,APP,GS,CG,SO,SV,NH,PG
    // pit1: #,Name,IP,H,R,ER,BB,K,2B,3B,HR,BF,AB
    // pit2: #,Name,OBA,OBP,WP,HBP,SF,SH/B,#P,BK,PO,SB
    const pit0 = pitTables[0] || { headers:[], rows:[] };
    const pit1 = pitTables[1] || { headers:[], rows:[] };
    const pit2 = pitTables[2] || { headers:[], rows:[] };

    // ââ Helper: make col-keyed object from table row ââ
    function rowObj(table, rowIdx) {
      const { headers, rows } = table;
      const row = rows[rowIdx];
      if (!row) return {};
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    }

    // ââ Build HITTERS ââ
    const hitters = [];
    bat0.rows.forEach((_, i) => {
      const b0 = rowObj(bat0, i);
      const name = b0['Name'];
      if (!name || name === 'Season Totals') return;

      const b1 = rowObj(bat1, i);
      const brRow = br0.rows.find((r, j) => {
        const n = rowObj(br0, j)['Name'];
        return n === name;
      });
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

    // ââ Build PITCHERS ââ
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

    console.log(`  â ${hitters.length} hitters, ${pitchers.length} pitchers`);
    return { hitters, pitchers };

  } catch (err) {
    console.error(`  â ERROR: ${err.message}`);
    return { hitters: [], pitchers: [] };
  }
}

// âââ FORMAT OUTPUT ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function fmtHitter(p) {
  const n = JSON.stringify(p.name);
  return `   {name:${n}, team:'${p.team}', league:'${p.league}', pa:${p.pa}, ab:${p.ab}, h:${p.h}, d:${p.d}, t:${p.t}, hr:${p.hr}, r:${p.r}, rbi:${p.rbi}, bb:${p.bb}, hbp:${p.hbp}, sf:${p.sf}, k:${p.k, sb:${p.sb}, cs:${p.cs}}`;
}

function fmtPitcher(p) {
  const n = JSON.stringify(p.name);
  return `   {name:${n}, team:'${p.team}', league:'${p.league}', w:${p.v}, l:${p.l}, ip:${p.ip.toFixed(4)}, bf:${p.bf}, er:${p.er}, k:${p.k}, h:${p.h}, bb:${p.bb}, hr:${p.hr}, hbp:${p.hbp}}`;
}

// âââ INJECT INTO HTML âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function injectIntoHTML(allHitters, allPitchers, today) {
  const htmlPath = path.join(__dirname, '..', 'ccaa-baseball.html');
  if (!fs.existsSync(htmlPath)) {
    console.error('ccaa-baseball.html not found at:', htmlPath);
    return false;
  }

  let html = fs.readFileSync(htmlPath, 'utf8');

  const hitStr   = allHitters.map(fmtHitter).join(',\n');
  const pitchStr = allPitchers.map(fmtPitcher).join(',\n');

  // Replace RAW_HITTERS
  const hitPattern = /const RAW_HITTERS\s*=\s*\[[\s\S]*?\];/;
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
  HTML = html.replace(
    /Stats auto-updated.*?(?=<\/span>|\.)/,
    `Stats auto-updated ${today}`
  );

  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log(`\nâ Wrote ccaa-baseball.html (${allHitters.length} hitters, ${allPitchers.length} pitchers)`);
  return true;
}

// âââ MAIN âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
async function main() {
  const today = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short', day: 'numeric', year: 'numeric'
  });
  console.log(`\n=== CCAA Baseball Scraper â  ${today} ===\n`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 }
  });

  const page = await context.newPage();
  // Suppress console noise from MaxPreps
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
    // Small delay between teams
    await page.waitForTimeout(1500);
  }

  await browser.close();

  console.log(`\n=== RESULTS ===`);
  console.log(`Total hitters:  ${allHitters.length}`);
  console.log(`Total pitchers: ${allPitchers.length}`);
  if (errors.length) console.warn(`Teams with errors: ${errors.join(', ')}`);

  // Only update HTML if we got reasonable data
  if (allHitters.length < 10) {
    console.error('Too few hitters scraped â aborting HTML update to avoid data loss');
    process.exit(1);
  }

  const ok = injectIntoHTML(allHitters, allPitchers, today);
  if (!ok) process.exit(1);

  // Save JSON backup for debugging
  const backupPath = path.join(__dirname, 'last-scrape.json');
  fs.writeFileSync(backupPath, JSON.stringify({
    date: today,
    hitterCount: allHitters.length,
    pitcherCount: allPitchers.length,
    hitters: allHitters,
    pitchers: allPitchers
  }, null, 2));
  console.log(`â Backup saved to scraper/last-scrape.json`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
