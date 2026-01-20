// Node 18+ (uses global fetch)
const fs = require('fs');
const path = require('path');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
  console.error('GITHUB_TOKEN not provided. Set the token in env.');
  process.exit(1);
}

const repoFull = process.env.GITHUB_REPOSITORY; // owner/repo
if (!repoFull) {
  console.error('GITHUB_REPOSITORY not found in env.');
  process.exit(1);
}
const owner = repoFull.split('/')[0];

const README_PATH = path.join(process.cwd(), 'README.md');
const START_MARKER = '<!--LANGUAGE_PIE_CHART_START-->';
const END_MARKER = '<!--LANGUAGE_PIE_CHART_END-->';

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      'User-Agent': 'github-readme-language-chart',
      Accept: 'application/vnd.github.v3+json'
    }
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}: ${await res.text()}`);
  }
  return res.json();
}

async function listRepos() {
  const perPage = 100;
  let page = 1;
  let all = [];
  while (true) {
    const url = `https://api.github.com/users/${owner}/repos?per_page=${perPage}&page=${page}&type=owner&sort=pushed`;
    const pageData = await fetchJson(url);
    if (!pageData || pageData.length === 0) break;
    all = all.concat(pageData);
    if (pageData.length < perPage) break;
    page++;
  }
  return all;
}

function pickColors(n) {
  const palette = [
    '#6366F1','#EF4444','#10B981','#F59E0B','#3B82F6','#8B5CF6',
    '#EC4899','#14B8A6','#F97316','#06B6D4','#A78BFA','#34D399'
  ];
  const colors = [];
  for (let i=0;i<n;i++) colors.push(palette[i % palette.length]);
  return colors;
}

function buildQuickChartUrl(labels, data, colors) {
  const chart = {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors
      }]
    },
    options: {
      rotation: -0.7,
      cutout: '50%',
      plugins: {
        legend: { position: 'right' }
      },
      elements: {
        arc: { borderWidth: 2 }
      }
    }
  };
  const encoded = encodeURIComponent(JSON.stringify(chart));
  return `https://quickchart.io/chart?c=${encoded}&width=780&height=360&format=png`;
}

async function main() {
  console.log('Listing repos for', owner);
  const repos = await listRepos();
  console.log(`Found ${repos.length} repos (counted).`);

  const langTotals = {};
  for (const repo of repos) {
    if (repo.fork || repo.archived) continue;
    try {
      const langs = await fetchJson(`https://api.github.com/repos/${owner}/${repo.name}/languages`);
      for (const [lang, bytes] of Object.entries(langs)) {
        langTotals[lang] = (langTotals[lang] || 0) + bytes;
      }
    } catch (err) {
      console.warn(`Skipping ${repo.name}: ${err.message}`);
    }
  }

  const entries = Object.entries(langTotals).sort((a,b) => b[1]-a[1]);
  if (entries.length === 0) {
    console.error('No language data found.');
    process.exit(1);
  }

  const top = entries.slice(0, 6);
  const others = entries.slice(6);
  const labels = top.map(e => e[0]);
  const data = top.map(e => e[1]);

  if (others.length > 0) {
    const otherBytes = others.reduce((s, e) => s + e[1], 0);
    labels.push('Other');
    data.push(otherBytes);
  }

  const total = data.reduce((s, v) => s + v, 0);
  const dataPercent = data.map(v => Math.round((v / total) * 100));

  const labelsWithPct = labels.map((l, i) => `${l} (${dataPercent[i]}%)`);
  const colors = pickColors(labels.length);
  const chartUrl = buildQuickChartUrl(labelsWithPct, data, colors);

  // Read README and replace between markers
  let readme = fs.readFileSync(README_PATH, 'utf8');
  const start = readme.indexOf(START_MARKER);
  const end = readme.indexOf(END_MARKER);

  if (start === -1 || end === -1 || end < start) {
    console.error('Markers not found or invalid in README.md. Make sure README contains the START/END markers.');
    process.exit(1);
  }

  const before = readme.slice(0, start + START_MARKER.length);
  const after = readme.slice(end);
  const newBlock = `\n<p align="center">\n  <img alt="Languages 3D-style Chart" src="${chartUrl}" />\n</p>\n`;
  const newReadme = before + newBlock + after;
  fs.writeFileSync(README_PATH, newReadme, 'utf8');
  console.log('README.md updated with new 3D-style language chart.');

  // Commit & push
  const { execSync } = require('child_process');
  execSync('git config user.name "github-actions[bot]"');
  execSync('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
  execSync('git add README.md');
  try {
    execSync(`git commit -m "chore: update 3D-style language chart" || true`, { stdio: 'inherit' });
    execSync('git push', { stdio: 'inherit' });
    console.log('Changes pushed.');
  } catch (err) {
    console.error('Failed to push changes:', err);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});