#!/usr/bin/env node
// Generates assets/stats-card.svg and assets/langs-card.svg from the GitHub GraphQL API.
// Design: replica of github-readme-stats (github_dark) framed as a terminal window
// to match assets/terminal.svg. Run in CI with GITHUB_TOKEN, or locally via `gh auth token`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOGIN = process.env.GH_LOGIN || "francis-ohara";
// GH_STATS_TOKEN (a PAT with repo read access) lets the language card count
// private repos; the Actions GITHUB_TOKEN can only see public ones.
const TOKEN = process.env.GH_STATS_TOKEN || process.env.GITHUB_TOKEN;
const INCLUDE_PRIVATE = Boolean(process.env.GH_STATS_TOKEN);
if (!TOKEN) {
  console.error("GITHUB_TOKEN is required");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS = JSON.parse(fs.readFileSync(path.join(__dirname, "octicons.json"), "utf8"));
const OUT_DIR = path.join(__dirname, "..", "assets");

const QUERY = `
query ($login: String!, $privacy: RepositoryPrivacy) {
  user(login: $login) {
    name
    followers { totalCount }
    pullRequests(first: 1) { totalCount }
    issues(first: 1) { totalCount }
    contributionsCollection {
      totalCommitContributions
      restrictedContributionsCount
      totalPullRequestReviewContributions
    }
    repositoriesContributedTo(
      first: 1
      includeUserRepositories: false
      contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]
    ) { totalCount }
    repositories(
      first: 100
      ownerAffiliations: OWNER
      isFork: false
      privacy: $privacy
      orderBy: { field: STARGAZERS, direction: DESC }
    ) {
      nodes {
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

async function fetchStats() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: QUERY,
      variables: { login: LOGIN, privacy: INCLUDE_PRIVATE ? null : "PUBLIC" },
    }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors ?? json));
  return json.data.user;
}

// Rank algorithm from github-readme-stats (src/calculateRank.js).
function calculateRank({ commits, prs, issues, reviews, stars, followers }) {
  const expCdf = (x) => 1 - 2 ** -x;
  const logNormCdf = (x) => x / (1 + x);
  const params = [
    [commits, 250, 2, expCdf],
    [prs, 50, 3, expCdf],
    [issues, 25, 1, expCdf],
    [reviews, 2, 1, expCdf],
    [stars, 50, 4, logNormCdf],
    [followers, 10, 1, logNormCdf],
  ];
  const totalWeight = params.reduce((s, [, , w]) => s + w, 0);
  const score = params.reduce((s, [v, med, w, f]) => s + w * f(v / med), 0) / totalWeight;
  const percentile = (1 - score) * 100;
  const THRESHOLDS = [1, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100];
  const LEVELS = ["S", "A+", "A", "A-", "B+", "B", "B-", "C+", "C"];
  return { level: LEVELS[THRESHOLDS.findIndex((t) => percentile <= t)], percentile };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n) => n.toLocaleString("en-US");

// Shared chrome: terminal window with traffic lights, matching assets/terminal.svg.
const C = {
  bg: "#161b22",
  border: "#30363d",
  bar: "#30363d",
  barText: "#9198a1",
  title: "#58a6ff",
  icon: "#ff8c42",
  label: "#c9d1d9",
  value: "#e6edf3",
  ringTrack: "#21262d",
  mono: "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
};

function windowChrome(width, height, barLabel) {
  return `
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="${C.bg}" stroke="${C.border}"/>
  <line x1="0.5" y1="28" x2="${width - 0.5}" y2="28" stroke="${C.bar}"/>
  <circle cx="16" cy="14.5" r="5" fill="#f85149"/>
  <circle cx="33" cy="14.5" r="5" fill="#d29922"/>
  <circle cx="50" cy="14.5" r="5" fill="#3fb950"/>
  <text x="66" y="18.5" font-family="${C.mono}" font-size="11" fill="${C.barText}">${esc(barLabel)}</text>`;
}

function iconGroup(name, x, y) {
  const paths = ICONS[name].map((d) => `<path fill-rule="evenodd" d="${d}"/>`).join("");
  return `<g transform="translate(${x},${y})" fill="${C.icon}">${paths}</g>`;
}

function statsCard({ name, rows, rank }) {
  const W = 460, H = 226;
  const rowSvg = rows
    .map(([icon, label, value], i) => {
      const y = 84 + i * 25;
      return `${iconGroup(icon, 26, y - 12)}
  <text x="52" y="${y}" font-family="${C.mono}" font-size="13" fill="${C.label}">${esc(label)}:</text>
  <text x="322" y="${y}" text-anchor="end" font-family="${C.mono}" font-size="13" font-weight="600" fill="${C.value}">${esc(value)}</text>`;
    })
    .join("\n");

  // Ring shows how far above the global percentile the rank sits (same as github-readme-stats).
  const r = 40, circ = 2 * Math.PI * r;
  const progress = Math.max(0, Math.min(100, 100 - rank.percentile));
  const dash = (progress / 100) * circ;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(name)}'s GitHub stats">
${windowChrome(W, H, "$ ./stats.sh")}
  <text x="24" y="56" font-family="${C.mono}" font-size="15" font-weight="600" fill="${C.title}">${esc(name)}'s GitHub Stats</text>
${rowSvg}
  <g transform="translate(390,131)">
    <circle r="${r}" fill="none" stroke="${C.ringTrack}" stroke-width="6"/>
    <circle r="${r}" fill="none" stroke="${C.title}" stroke-width="6" stroke-linecap="round"
      stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90)"/>
    <text y="8" text-anchor="middle" font-family="${C.mono}" font-size="22" font-weight="700" fill="${C.title}">${rank.level}</text>
  </g>
</svg>
`;
}

function langsCard(langs) {
  const W = 340, H = 226;
  const barX = 24, barW = W - 48, barY = 72;
  let x = barX;
  const segs = langs
    .map(({ color, share }) => {
      const w = barW * share;
      const seg = `<rect x="${x.toFixed(1)}" y="${barY}" width="${w.toFixed(1)}" height="10" fill="${color}"/>`;
      x += w;
      return seg;
    })
    .join("\n  ");
  const legend = langs
    .map(({ name, color, pct }, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const lx = 24 + col * 152, ly = 112 + row * 26;
      return `<circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${color}"/>
  <text x="${lx + 17}" y="${ly}" font-family="${C.mono}" font-size="11.5" fill="${C.label}">${esc(name)} <tspan fill="${C.barText}">${pct}%</tspan></text>`;
    })
    .join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Most used languages">
${windowChrome(W, H, "$ ./languages.sh")}
  <text x="24" y="56" font-family="${C.mono}" font-size="15" font-weight="600" fill="${C.title}">Most Used Languages</text>
  <clipPath id="bar"><rect x="${barX}" y="${barY}" width="${barW}" height="10" rx="5"/></clipPath>
  <g clip-path="url(#bar)">
  ${segs}
  </g>
  ${legend}
</svg>
`;
}

const user = await fetchStats();
const cc = user.contributionsCollection;
const stars = user.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0);
const commits = cc.totalCommitContributions + cc.restrictedContributionsCount;
const year = new Date().getFullYear();

const rank = calculateRank({
  commits,
  prs: user.pullRequests.totalCount,
  issues: user.issues.totalCount,
  reviews: cc.totalPullRequestReviewContributions,
  stars,
  followers: user.followers.totalCount,
});

const stats = statsCard({
  name: user.name || LOGIN,
  rank,
  rows: [
    ["star", "Total Stars Earned", fmt(stars)],
    ["commits", `Total Commits (${year})`, fmt(commits)],
    ["prs", "Total PRs", fmt(user.pullRequests.totalCount)],
    ["issues", "Total Issues", fmt(user.issues.totalCount)],
    ["contribs", "Contributed to (last year)", fmt(user.repositoriesContributedTo.totalCount)],
  ],
});

// Notebooks store outputs as file bytes and drown real code; exclude by default.
const excluded = new Set(
  (process.env.EXCLUDE_LANGS ?? "Jupyter Notebook,CSS,SCSS").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
);
const totals = new Map();
for (const repo of user.repositories.nodes) {
  for (const { size, node } of repo.languages.edges) {
    if (excluded.has(node.name.toLowerCase())) continue;
    const cur = totals.get(node.name) || { size: 0, color: node.color || "#8b949e" };
    cur.size += size;
    totals.set(node.name, cur);
  }
}
const allBytes = [...totals.values()].reduce((s, l) => s + l.size, 0);
const top = [...totals.entries()]
  .sort((a, b) => b[1].size - a[1].size)
  .slice(0, 6)
  .map(([name, { size, color }]) => ({
    name,
    color,
    share: size / allBytes,
    pct: ((size / allBytes) * 100).toFixed(1),
  }));

fs.writeFileSync(path.join(OUT_DIR, "stats-card.svg"), stats);
fs.writeFileSync(path.join(OUT_DIR, "langs-card.svg"), langsCard(top));
console.log(`Wrote stats-card.svg (rank ${rank.level}, ${stars} stars, ${commits} commits) and langs-card.svg (${top.map((l) => l.name).join(", ")})`);
