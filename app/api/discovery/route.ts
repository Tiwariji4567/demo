// app/api/discovery/route.ts
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { INITIAL_SEED_FEEDS, isSafePublicUrl, normalizeFeedUrl } from '@/lib/utils';

interface FeedStats {
  url: string;
  title: string;
  siteUrl: string;
  category: string;
  description: string;
  subscribers: number;
}

interface AnonymousBatch {
  feeds: string[];
  timestamp: number;
}

// Persistent in-memory store (or swap with SQLite/Turso/Supabase in 5 lines)
const globalForDiscovery = globalThis as unknown as {
  feedCatalog: Map<string, FeedStats>;
  batches: AnonymousBatch[];
  blogrollEdges: Map<string, Set<string>>;
  rateLimitHashes: Map<string, number>;
  dailySalt: string;
};

if (!globalForDiscovery.feedCatalog) {
  globalForDiscovery.feedCatalog = new Map();
  globalForDiscovery.batches = [];
  globalForDiscovery.blogrollEdges = new Map();
  globalForDiscovery.rateLimitHashes = new Map();
  globalForDiscovery.dailySalt = crypto.randomBytes(16).toString('hex');

  // Seed initial catalog
  INITIAL_SEED_FEEDS.forEach((f) => {
    const norm = normalizeFeedUrl(f.url);
    globalForDiscovery.feedCatalog.set(norm, {
      ...f,
      url: norm,
      subscribers: 12,
    });
  });

  // Pre-populate realistic anonymous reader clusters for Demo Day
  const u = (idx: number) => normalizeFeedUrl(INITIAL_SEED_FEEDS[idx].url);
  const demoClusters = [
    [u(0), u(1), u(2), u(5), u(11)], // Web, AI & Systems cluster
    [u(1), u(7), u(8), u(9), u(10)], // Deep Systems & Rust cluster
    [u(2), u(3), u(4), u(6)],        // Tech Culture, Security & Digital Rights
    [u(0), u(5), u(7), u(11)],       // Frontend, Design & Interactive Essays
    [u(1), u(4), u(8), u(10)],       // Security & Low-level Linux
    [u(0), u(1), u(2), u(8), u(9)],  // General Indie Hacker favorites
    [u(3), u(4), u(6), u(7)],        // Classic Open Web veterans
    [u(1), u(2), u(9), u(10), u(11)],// Modern Systems + Digital Gardens
  ];

  demoClusters.forEach((cluster) => {
    globalForDiscovery.batches.push({ feeds: cluster, timestamp: Date.now() });
    cluster.forEach((feedUrl) => {
      const item = globalForDiscovery.feedCatalog.get(feedUrl);
      if (item) item.subscribers += 4;
    });
  });
}

function getSaltedIpHash(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for') || '127.0.0.1';
  const ip = forwarded.split(',')[0].trim();
  return crypto
    .createHash('sha256')
    .update(ip + globalForDiscovery.dailySalt)
    .digest('hex');
}

function cleanExpiredHashes() {
  const now = Date.now();
  for (const [hash, expiry] of globalForDiscovery.rateLimitHashes.entries()) {
    if (now > expiry) {
      globalForDiscovery.rateLimitHashes.delete(hash);
    }
  }
}

export async function GET(req: NextRequest) {
  const rawSubs = req.nextUrl.searchParams.get('subscriptions') || '';
  const userFeeds = rawSubs
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeFeedUrl);

  const userSet = new Set(userFeeds);

  // Calculate Co-Subscription scores
  const coOccurrenceCount = new Map<string, number>();
  const coOccurrenceSources = new Map<string, Map<string, number>>();

  for (const batch of globalForDiscovery.batches) {
    const batchSet = new Set(batch.feeds);
    const sharedWithUser = userFeeds.filter((f) => batchSet.has(f));

    if (sharedWithUser.length > 0) {
      for (const candidate of batch.feeds) {
        if (userSet.has(candidate)) continue;
        // Weight increases with how many feeds this anonymous reader shares with the current user
        const weight = sharedWithUser.length;
        coOccurrenceCount.set(candidate, (coOccurrenceCount.get(candidate) || 0) + weight);

        if (!coOccurrenceSources.has(candidate)) {
          coOccurrenceSources.set(candidate, new Map());
        }
        const sourceMap = coOccurrenceSources.get(candidate)!;
        sharedWithUser.forEach((src) => {
          sourceMap.set(src, (sourceMap.get(src) || 0) + 1);
        });
      }
    }
  }

  // Also boost candidates linked via blogroll edges ("A links to B")
  const blogrollBoost = new Map<string, string[]>();
  userFeeds.forEach((uFeed) => {
    const linked = globalForDiscovery.blogrollEdges.get(uFeed);
    if (linked) {
      linked.forEach((target) => {
        if (!userSet.has(target)) {
          const arr = blogrollBoost.get(target) || [];
          arr.push(uFeed);
          blogrollBoost.set(target, arr);
        }
      });
    }
  });

  // Build ranked recommendations (excluding feeds the user already follows)
  const recommendations = [];
  for (const [url, meta] of globalForDiscovery.feedCatalog.entries()) {
    if (userSet.has(url)) continue;

    const coScore = coOccurrenceCount.get(url) || 0;
    const popScore = meta.subscribers;
    const blogrollSources = blogrollBoost.get(url) || [];
    const totalScore = coScore * 4 + popScore + blogrollSources.length * 6;

    // Build transparent explanation string
    let reason = `Popular on the Small Web (${popScore} anonymous readers)`;
    const sourcesMap = coOccurrenceSources.get(url);
    if (sourcesMap && sourcesMap.size > 0) {
      const topSourceUrls = Array.from(sourcesMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([srcUrl]) => globalForDiscovery.feedCatalog.get(srcUrl)?.title || srcUrl);
      reason = `Frequently followed alongside ${topSourceUrls.join(' & ')}`;
    } else if (blogrollSources.length > 0) {
      const linkerTitle = globalForDiscovery.feedCatalog.get(blogrollSources[0])?.title || 'a blog you follow';
      reason = `Recommended via Blogroll link from ${linkerTitle}`;
    }

    recommendations.push({
      ...meta,
      coScore,
      totalScore,
      reason,
    });
  }

  recommendations.sort((a, b) => b.totalScore - a.totalScore);

  // Build Co-Subscription Graph Nodes & Edges for the interactive Graph View
  const nodes = Array.from(globalForDiscovery.feedCatalog.values()).map((f) => ({
    id: f.url,
    title: f.title,
    category: f.category,
    subscribers: f.subscribers,
    isSubscribed: userSet.has(f.url),
  }));

  const edgeWeights = new Map<string, number>();
  for (const batch of globalForDiscovery.batches) {
    for (let i = 0; i < batch.feeds.length; i++) {
      for (let j = i + 1; j < batch.feeds.length; j++) {
        const [a, b] = [batch.feeds[i], batch.feeds[j]].sort();
        const key = `${a}|||${b}`;
        edgeWeights.set(key, (edgeWeights.get(key) || 0) + 1);
      }
    }
  }

  const edges = Array.from(edgeWeights.entries())
    .filter(([, weight]) => weight >= 2)
    .map(([key, weight]) => {
      const [source, target] = key.split('|||');
      return { source, target, weight };
    });

  const popular = Array.from(globalForDiscovery.feedCatalog.values())
    .filter((f) => !userSet.has(f.url))
    .sort((a, b) => b.subscribers - a.subscribers);

  return NextResponse.json({
    recommendations,
    popular,
    graph: { nodes, edges },
    stats: {
      totalAnonymousBatches: globalForDiscovery.batches.length,
      catalogSize: globalForDiscovery.feedCatalog.size,
      activeSaltedHashes: globalForDiscovery.rateLimitHashes.size,
    },
  });
}

export async function POST(req: NextRequest) {
  cleanExpiredHashes();
  const ipHash = getSaltedIpHash(req);

  // Abuse protection: 1 submission per 60 seconds per salted IP hash (10 min expiry)
  const existingExpiry = globalForDiscovery.rateLimitHashes.get(ipHash);
  if (existingExpiry && Date.now() < existingExpiry) {
    const waitSec = Math.ceil((existingExpiry - Date.now()) / 1000);
    return NextResponse.json(
      { error: `Rate limit active: Please wait ${waitSec}s before submitting another batch.` },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const rawFeeds: Array<{ url: string; title?: string; siteUrl?: string; category?: string }> =
      Array.isArray(body.feeds) ? body.feeds : [];
    const blogrollLinks: Array<{ from: string; to: string }> = Array.isArray(body.blogroll)
      ? body.blogroll
      : [];

    // Cap batch size at 50 feeds
    if (rawFeeds.length < 1 || rawFeeds.length > 50) {
      return NextResponse.json(
        { error: 'Batch size must be between 1 and 50 valid feeds.' },
        { status: 400 }
      );
    }

    const normalizedSet = new Set<string>();
    const trapsDetected: string[] = [];

    for (const item of rawFeeds) {
      if (!item?.url || typeof item.url !== 'string') continue;
      const safety = isSafePublicUrl(item.url);
      if (!safety.valid) continue;

      const norm = normalizeFeedUrl(item.url);
      if (normalizedSet.has(norm)) {
        trapsDetected.push(`Duplicate normalized URL collapsed: ${item.url} -> ${norm}`);
        continue;
      }
      normalizedSet.add(norm);

      const existing = globalForDiscovery.feedCatalog.get(norm);
      if (existing) {
        existing.subscribers += 1;
      } else {
        globalForDiscovery.feedCatalog.set(norm, {
          url: norm,
          title: (item.title || norm).slice(0, 80),
          siteUrl: item.siteUrl || norm,
          category: item.category || 'Indie Blog',
          description: 'Discovered anonymously by community readers.',
          subscribers: 1,
        });
      }
    }

    // Store Blogroll edges if provided
    for (const edge of blogrollLinks.slice(0, 30)) {
      if (isSafePublicUrl(edge.from).valid && isSafePublicUrl(edge.to).valid) {
        const fromNorm = normalizeFeedUrl(edge.from);
        const toNorm = normalizeFeedUrl(edge.to);
        if (fromNorm !== toNorm) {
          if (!globalForDiscovery.blogrollEdges.has(fromNorm)) {
            globalForDiscovery.blogrollEdges.set(fromNorm, new Set());
          }
          globalForDiscovery.blogrollEdges.get(fromNorm)!.add(toNorm);
        }
      }
    }

    const finalBatch = Array.from(normalizedSet);
    if (finalBatch.length > 0) {
      globalForDiscovery.batches.push({
        feeds: finalBatch,
        timestamp: Date.now(),
      });
    }

    // Store salted hash with short 60-second cooldown
    globalForDiscovery.rateLimitHashes.set(ipHash, Date.now() + 60 * 1000);

    return NextResponse.json({
      success: true,
      acceptedCount: finalBatch.length,
      ephemeralHashPreview: ipHash.slice(0, 12) + '...',
      trapsDetected,
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }
}