#!/usr/bin/env bun

/**
 * Daily Scout Feed Script
 *
 * Monitors multiple RSS/Atom feeds, scores items for oh-my-customcodex relevance
 * using the OpenAI Responses API, deduplicates against existing GitHub issues,
 * and files GitHub issues for high-scoring items.
 *
 * Environment Variables:
 * - OPENAI_API_KEY: Required
 * - OPENAI_MODEL: Optional (default: gpt-5)
 * - GITHUB_TOKEN: Required
 * - GITHUB_REPOSITORY: Required (format: owner/repo)
 * - SCOUT_DRY_RUN: 'true'/'false' (default: false)
 * - SCOUT_MIN_SCORE: minimum relevance score 0-100 (default: 60)
 * - SCOUT_MAX_ISSUES: hard cap on issues created per run (default: 5)
 * - SCOUT_SOURCES: comma-separated source names to restrict (default: all)
 * - SCOUT_LIMIT_PER_SOURCE: max items to fetch per source (default: 50)
 * - SCOUT_SCORE_CHUNK_SIZE: items per scoring batch (default: 40)
 */

import { createOpenAITextResponse } from './openai-responses';

interface SourceConfig {
  name: string;
  url: string;
  enabled: boolean;
}

interface FeedItem {
  title: string;
  link: string;
  published: string;
  source: string;
}

interface ScoreResult {
  index: number;
  score: number;
  reason: string;
}

interface ScoredItem extends FeedItem {
  score: number;
  reason: string;
}

const CONFIG = {
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL || 'gpt-5',
  githubToken: process.env.GITHUB_TOKEN,
  githubRepo: process.env.GITHUB_REPOSITORY,
  dryRun: process.env.SCOUT_DRY_RUN === 'true',
  minScore: parseIntSafe(process.env.SCOUT_MIN_SCORE, 60),
  maxIssues: parseIntSafe(process.env.SCOUT_MAX_ISSUES, 5),
  limitPerSource: parseIntSafe(process.env.SCOUT_LIMIT_PER_SOURCE, 50),
  enabledSources: parseSourceFilter(process.env.SCOUT_SOURCES),
  scoreChunkSize: parseIntSafe(process.env.SCOUT_SCORE_CHUNK_SIZE, 40),
};

const ALL_SOURCES: SourceConfig[] = [
  { name: 'hada', url: 'https://feeds.feedburner.com/geeknews-feed', enabled: true },
  { name: 'hackernews', url: 'https://hnrss.org/frontpage', enabled: true },
  { name: 'arxiv-cs-ai', url: 'http://export.arxiv.org/rss/cs.AI', enabled: true },
];

function parseIntSafe(value: string | undefined, defaultValue: number): number {
  if (!value || value.trim() === '') return defaultValue;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function parseSourceFilter(value: string | undefined): Set<string> | null {
  if (!value || value.trim() === '') return null;
  return new Set(value.split(',').map((s) => s.trim()).filter(Boolean));
}

function getActiveSources(): SourceConfig[] {
  if (!CONFIG.enabledSources) return ALL_SOURCES.filter((s) => s.enabled);
  return ALL_SOURCES.filter((s) => s.enabled && CONFIG.enabledSources!.has(s.name));
}

function validateEnvironment(): void {
  const missing: string[] = [];

  if (!CONFIG.openaiApiKey) missing.push('OPENAI_API_KEY');
  if (!CONFIG.githubToken) missing.push('GITHUB_TOKEN');
  if (!CONFIG.githubRepo) missing.push('GITHUB_REPOSITORY');

  if (missing.length > 0) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

function stripCdata(text: string): string {
  return text.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractTag(xml: string, tagName: string): string {
  const openRe = new RegExp(`<${tagName}[^>]*>`, 'i');
  const match = openRe.exec(xml);
  if (!match) return '';
  const afterOpen = xml.slice(match.index + match[0].length);
  const closeIdx = afterOpen.toLowerCase().indexOf(`</${tagName.toLowerCase()}>`);
  if (closeIdx === -1) return '';
  return afterOpen.slice(0, closeIdx).trim();
}

function extractAttr(xml: string, tagName: string, attrName: string): string {
  const tagRe = new RegExp(`<${tagName}[^>]*/?>`, 'i');
  const tagMatch = tagRe.exec(xml);
  if (!tagMatch) return '';
  const tagContent = tagMatch[0];

  const dqRe = new RegExp(`${attrName}="([^"]*)"`, 'i');
  const dqMatch = dqRe.exec(tagContent);
  if (dqMatch) return dqMatch[1];

  const sqRe = new RegExp(`${attrName}='([^']*)'`, 'i');
  const sqMatch = sqRe.exec(tagContent);
  if (sqMatch) return sqMatch[1];

  return '';
}

function parseFeed(xml: string, sourceName: string, limit: number): FeedItem[] {
  const items: FeedItem[] = [];
  const isAtom = /<entry[\s>]/i.test(xml) && !/<item[\s>]/i.test(xml);
  const entryTag = isAtom ? 'entry' : 'item';
  const entryPattern = new RegExp(`<${entryTag}[\\s>][\\s\\S]*?<\\/${entryTag}>`, 'gi');
  const matches = xml.match(entryPattern) ?? [];

  for (const block of matches) {
    if (items.length >= limit) break;

    const title = decodeHtmlEntities(stripCdata(extractTag(block, 'title')));
    if (!title) continue;

    let link = extractAttr(block, 'link', 'href');
    if (!link) link = stripCdata(extractTag(block, 'link')).trim();
    if (!link) continue;

    let published = extractTag(block, 'published');
    if (!published) published = extractTag(block, 'pubDate');
    published = stripCdata(published).trim();

    items.push({ title, link, published, source: sourceName });
  }

  return items;
}

async function fetchFeed(source: SourceConfig): Promise<FeedItem[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'oh-my-customcodex-scout/1.0' },
    });

    if (!response.ok) {
      console.warn(`⚠️  [${source.name}] HTTP ${response.status} ${response.statusText} — skipping`);
      return null;
    }

    const xml = await response.text();
    if (!xml.trim()) {
      console.warn(`⚠️  [${source.name}] Empty response — skipping`);
      return null;
    }

    const items = parseFeed(xml, source.name, CONFIG.limitPerSource);
    console.log(`📡 [${source.name}] Fetched ${items.length} items from ${source.url}`);
    return items;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️  [${source.name}] Fetch failed: ${message} — skipping`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function githubHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${CONFIG.githubToken}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent': 'oh-my-customcodex-scout',
  };
}

async function fetchTrackedIssueBodies(): Promise<string[]> {
  const url = `https://api.github.com/repos/${CONFIG.githubRepo}/issues?labels=daily-scout&state=all&per_page=100`;

  const response = await fetch(url, { headers: githubHeaders() });
  if (!response.ok) {
    console.warn(`⚠️  Could not fetch existing issues (${response.status}) — dedup may miss duplicates`);
    return [];
  }

  const issues = (await response.json()) as Array<{ body?: string | null }>;
  return issues.map((issue) => issue.body ?? '');
}

async function ensureLabelExists(name: string, color: string, description: string): Promise<void> {
  const url = `https://api.github.com/repos/${CONFIG.githubRepo}/labels`;
  const response = await fetch(url, {
    method: 'POST',
    headers: githubHeaders(),
    body: JSON.stringify({ name, color, description }),
  });

  if (response.status !== 201 && response.status !== 422) {
    console.warn(`⚠️  Could not ensure label '${name}': HTTP ${response.status}`);
  }
}

async function createGitHubIssue(title: string, body: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${CONFIG.githubRepo}/issues`;
  const response = await fetch(url, {
    method: 'POST',
    headers: githubHeaders(),
    body: JSON.stringify({ title, body, labels: ['automated', 'daily-scout'] }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`❌ Failed to create issue: HTTP ${response.status} — ${text}`);
    return null;
  }

  const issue = (await response.json()) as { html_url?: string };
  return issue.html_url ?? null;
}

const SYSTEM_PROMPT = `You are a relevance filter for the oh-my-customcodex project — an AI agent harness/orchestration system built on GPT Codex + OMX, ported from oh-my-customcode.

Project domains (HIGH relevance, score 70-100):
- AI agent orchestration, multi-agent systems, agent design patterns
- Harness, benchmark, evaluation frameworks for AI agents
- OpenAI Codex, Claude Code compatibility, OMX, MCP (Model Context Protocol)
- Code review automation, development workflow automation
- Agent sandbox, isolation, security patterns
- LLM-assisted development tools and methodologies

Project domains (MEDIUM relevance, score 40-69):
- General AI/ML tooling that could be adapted for agent workflows
- DevOps automation patterns applicable to agent infrastructure
- New programming paradigms for AI-assisted development

NOT relevant (score 0-39):
- Pure frontend/UI frameworks without agent connection
- Business/management topics
- Hardware, networking, non-AI infrastructure
- Social media, marketing tools

For each numbered item, evaluate its title and return raw JSON only.`;

function parseJsonArray(textContent: string): unknown[] | null {
  let jsonStr = textContent.trim();
  const jsonMatch = jsonStr.match(/```json?\s*\n([\s\S]*?)\n```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```\w*\s*\n/, '').replace(/\n```\s*$/, '');
  }

  try {
    const parsed = JSON.parse(jsonStr) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function scoreChunk(
  chunk: FeedItem[],
  chunkIndex: number,
  totalChunks: number,
  globalOffset: number,
): Promise<ScoreResult[] | null> {
  const numberedList = chunk.map((item, i) => `${i + 1}. [${item.source}] ${item.title}`).join('\n');
  const prompt = `${SYSTEM_PROMPT}

Score each item for oh-my-customcodex relevance (0-100). Keep each reason to 10 words or fewer.

Items:
${numberedList}

Return a JSON array (no markdown, raw JSON only) with exactly ${chunk.length} objects:
[
  { "index": 1, "score": <0-100>, "reason": "<10 words max>" }
]`;

  const textContent = await createOpenAITextResponse({
    apiKey: CONFIG.openaiApiKey,
    model: CONFIG.openaiModel,
    prompt,
    maxOutputTokens: 4096,
  });

  const parsed = parseJsonArray(textContent);
  if (!parsed) {
    console.warn(`⚠️  chunk ${chunkIndex + 1}/${totalChunks}: failed to parse JSON — skipping ${chunk.length} items`);
    console.warn(`   raw response (first 500 chars): ${textContent.slice(0, 500)}`);
    return null;
  }

  const results: ScoreResult[] = [];
  for (const element of parsed) {
    if (
      typeof element === 'object' &&
      element !== null &&
      typeof (element as Record<string, unknown>).index === 'number' &&
      typeof (element as Record<string, unknown>).score === 'number' &&
      typeof (element as Record<string, unknown>).reason === 'string'
    ) {
      const record = element as Record<string, unknown>;
      const localIndex = record.index as number;
      results.push({
        index: globalOffset + localIndex,
        score: Math.max(0, Math.min(100, record.score as number)),
        reason: record.reason as string,
      });
    }
  }

  console.log(`   chunk ${chunkIndex + 1}/${totalChunks}: scored ${results.length} items`);
  return results;
}

async function scoreItemsWithOpenAI(items: FeedItem[]): Promise<ScoreResult[]> {
  const chunkSize = CONFIG.scoreChunkSize;
  const chunks: FeedItem[][] = [];

  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }

  console.log(`🤖 Scoring ${items.length} items in ${chunks.length} chunk(s) of ${chunkSize}...`);

  const allResults: ScoreResult[] = [];
  let failedChunks = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunkResults = await scoreChunk(chunks[i], i, chunks.length, i * chunkSize);
    if (chunkResults === null) {
      failedChunks++;
    } else {
      allResults.push(...chunkResults);
    }
  }

  if (failedChunks === chunks.length) {
    console.error('❌ All scoring chunks failed — no scored items');
    process.exit(1);
  }

  if (failedChunks > 0) {
    console.warn(`⚠️  ${failedChunks}/${chunks.length} chunk(s) failed — affected items will score 0`);
  }

  return allResults;
}

function buildIssueBody(item: ScoredItem): string {
  const truncatedTitle = item.title.length > 120 ? `${item.title.slice(0, 117)}...` : item.title;

  return `## ${truncatedTitle}

**Source:** ${item.link}
**Published:** ${item.published || 'unknown'}
**Feed:** ${item.source}
**Relevance score:** ${item.score}/100 — ${item.reason}

---

## Action Items

- [ ] Review article for applicability to oh-my-customcodex
- [ ] If relevant: internalize patterns or create an implementation issue
- [ ] If not relevant: close with comment

---

_Auto-created by the daily-scout GitHub Actions workflow._`;
}

function isAlreadyTracked(item: FeedItem, existingBodies: string[]): boolean {
  return existingBodies.some((body) => body.includes(item.link));
}

async function main(): Promise<void> {
  console.log('🚀 Starting daily-scout feed script\n');

  validateEnvironment();

  const activeSources = getActiveSources();
  if (activeSources.length === 0) {
    console.error('❌ No active sources after applying SCOUT_SOURCES filter');
    process.exit(1);
  }

  console.log(`📋 Config: minScore=${CONFIG.minScore}, maxIssues=${CONFIG.maxIssues}, dryRun=${CONFIG.dryRun}`);
  console.log(`📡 Sources: ${activeSources.map((source) => source.name).join(', ')}\n`);

  const allItems: FeedItem[] = [];
  let failedSources = 0;

  for (const source of activeSources) {
    const items = await fetchFeed(source);
    if (items === null) {
      failedSources++;
    } else {
      allItems.push(...items);
    }
  }

  if (failedSources === activeSources.length) {
    console.error('❌ All sources failed — aborting');
    process.exit(1);
  }

  const totalFetched = allItems.length;
  console.log(`\n📊 Total items fetched: ${totalFetched}`);

  if (totalFetched === 0) {
    console.log('ℹ️  No items fetched from any source');
    console.log(`\n=== Summary: fetched=0 deduped=0 scored=0 passed=0 created=0 (dry_run=${CONFIG.dryRun}) ===`);
    return;
  }

  console.log('\n🔍 Fetching existing daily-scout issues for deduplication...');
  const existingBodies = await fetchTrackedIssueBodies();
  console.log(`📋 Found ${existingBodies.length} existing tracked issues`);

  const deduped = allItems.filter((item) => !isAlreadyTracked(item, existingBodies));
  console.log(`🔁 Deduped: ${totalFetched - deduped.length} already tracked, ${deduped.length} new items remaining`);

  if (deduped.length === 0) {
    console.log('ℹ️  No new items after deduplication');
    console.log(`\n=== Summary: fetched=${totalFetched} deduped=${deduped.length} scored=0 passed=0 created=0 (dry_run=${CONFIG.dryRun}) ===`);
    return;
  }

  const scoreResults = await scoreItemsWithOpenAI(deduped);
  const scoreMap = new Map<number, ScoreResult>();
  for (const result of scoreResults) scoreMap.set(result.index, result);

  const scoredItems: ScoredItem[] = deduped.map((item, i) => {
    const result = scoreMap.get(i + 1);
    return { ...item, score: result?.score ?? 0, reason: result?.reason ?? 'no score returned' };
  });

  const passed = scoredItems
    .filter((item) => item.score >= CONFIG.minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, CONFIG.maxIssues);

  console.log('\n📊 Scoring results:');
  for (const item of scoredItems) {
    const marker = item.score >= CONFIG.minScore ? '✓' : '✗';
    console.log(`  ${marker} [${item.source}] "${item.title.slice(0, 80)}" → ${item.score}/100`);
  }
  console.log(`\n✅ Passed threshold (>=${CONFIG.minScore}): ${passed.length} items (cap: ${CONFIG.maxIssues})`);

  if (passed.length > 0 && !CONFIG.dryRun) {
    console.log('\n🏷️  Ensuring required labels exist...');
    await ensureLabelExists('automated', 'e4e669', 'Automatically created by a bot');
    await ensureLabelExists('daily-scout', '1d76db', 'Daily feed scout — scored by OpenAI');
  }

  let createdCount = 0;
  for (const item of passed) {
    const issueTitle = `[scout] ${item.title.slice(0, 120)}`;
    const issueBody = buildIssueBody(item);

    if (CONFIG.dryRun) {
      console.log(`\n[DRY-RUN] would create: "${issueTitle}"`);
      console.log(`  Score: ${item.score}/100 | Reason: ${item.reason}`);
      console.log(`  Link: ${item.link}`);
      createdCount++;
    } else {
      console.log(`\n📝 Creating issue: "${issueTitle}"`);
      const issueUrl = await createGitHubIssue(issueTitle, issueBody);
      if (issueUrl) {
        console.log(`  ✅ Created: ${issueUrl}`);
        createdCount++;
      }
    }
  }

  console.log(`\n=== Summary: fetched=${totalFetched} deduped=${deduped.length} scored=${scoredItems.length} passed=${passed.length} created=${createdCount} (dry_run=${CONFIG.dryRun}) ===`);
}

main().catch((error: unknown) => {
  console.error('\n💥 Unexpected error:', error);
  process.exit(1);
});
