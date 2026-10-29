// lib/feedEngine.ts
import DOMPurify from 'dompurify';
import { Readability } from '@mozilla/readability';
import { ArticlePost } from './db';
import { normalizeFeedUrl } from './utils';

export function sanitizeHtml(dirty: string): string {
  if (typeof window === 'undefined') return dirty;
  return DOMPurify.sanitize(dirty, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'style'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
  });
}

function extractXmlMediaImage(node: Element, baseUrl: string): string | null {
  const mediaThumb =
    node.getElementsByTagName('media:thumbnail')[0] ||
    node.getElementsByTagName('thumbnail')[0];
  if (mediaThumb?.getAttribute('url')) {
    return resolveUrl(mediaThumb.getAttribute('url')!, baseUrl);
  }

  const mediaContents = Array.from(node.getElementsByTagName('media:content'));
  for (const mc of mediaContents) {
    const url = mc.getAttribute('url');
    const type = mc.getAttribute('type') || '';
    const medium = mc.getAttribute('medium') || '';
    if (url && (medium === 'image' || type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)/i.test(url))) {
      return resolveUrl(url, baseUrl);
    }
  }

  const enclosures = Array.from(node.querySelectorAll('enclosure'));
  for (const enc of enclosures) {
    const url = enc.getAttribute('url');
    const type = enc.getAttribute('type') || '';
    if (url && (type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)/i.test(url))) {
      return resolveUrl(url, baseUrl);
    }
  }

  const atomEnc = node.querySelector('link[rel="enclosure"]');
  if (atomEnc?.getAttribute('href')) {
    const href = atomEnc.getAttribute('href')!;
    const type = atomEnc.getAttribute('type') || '';
    if (type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)/i.test(href)) {
      return resolveUrl(href, baseUrl);
    }
  }

  return null;
}

function resolveUrl(relOrAbs: string, base: string): string {
  try {
    return new URL(relOrAbs, base).toString();
  } catch {
    return relOrAbs;
  }
}

export async function autodiscoverAndParseFeed(
  inputUrl: string,
  existingEtag?: string,
  existingLastModified?: string
): Promise<{
  notModified?: boolean;
  feedUrl: string;
  title: string;
  siteUrl: string;
  etag?: string;
  lastModified?: string;
  posts: ArticlePost[];
  blogrollLinks: string[];
}> {
  let candidateUrl = inputUrl.trim();
  if (!/^https?:\/\//i.test(candidateUrl)) {
    candidateUrl = 'https://' + candidateUrl;
  }

  const params = new URLSearchParams({ url: candidateUrl });
  if (existingEtag) params.set('etag', existingEtag);
  if (existingLastModified) params.set('lastModified', existingLastModified);

  const res = await fetch(`/api/fetch?${params.toString()}`);
  if (res.status === 304) {
    return {
      notModified: true,
      feedUrl: normalizeFeedUrl(candidateUrl),
      title: '',
      siteUrl: candidateUrl,
      posts: [],
      blogrollLinks: [],
    };
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `HTTP ${res.status} when fetching feed`);
  }

  const rawText = await res.text();
  const etag = res.headers.get('X-Upstream-ETag') || undefined;
  const lastModified = res.headers.get('X-Upstream-Last-Modified') || undefined;
  const finalUrl = res.headers.get('X-Final-Url') || candidateUrl;

  const xmlResult = tryParseFeedXml(rawText, finalUrl);
  if (xmlResult) {
    return {
      ...xmlResult,
      feedUrl: normalizeFeedUrl(finalUrl),
      etag,
      lastModified,
    };
  }

  const parser = new DOMParser();
  const htmlDoc = parser.parseFromString(rawText, 'text/html');
  const blogrollLinks = extractBlogrollFromHtml(htmlDoc, finalUrl);

  const alternateLinks = Array.from(
    htmlDoc.querySelectorAll(
      'link[rel="alternate"][type*="rss"], link[rel="alternate"][type*="atom"], link[rel="alternate"][type*="xml"]'
    )
  );

  const candidatePaths: string[] = [];
  alternateLinks.forEach((link) => {
    const href = link.getAttribute('href');
    if (href) {
      try {
        candidatePaths.push(new URL(href, finalUrl).toString());
      } catch {}
    }
  });

  const commonSuffixes = ['/feed', '/rss.xml', '/atom.xml', '/index.xml', '/feed.xml', '/rss'];
  for (const suffix of commonSuffixes) {
    try {
      const origin = new URL(finalUrl).origin;
      candidatePaths.push(origin + suffix);
    } catch {}
  }

  for (const discoveredUrl of candidatePaths) {
    try {
      const subRes = await fetch(`/api/fetch?url=${encodeURIComponent(discoveredUrl)}`);
      if (!subRes.ok) continue;
      const subText = await subRes.text();
      const parsed = tryParseFeedXml(subText, discoveredUrl);
      if (parsed) {
        return {
          ...parsed,
          feedUrl: normalizeFeedUrl(discoveredUrl),
          etag: subRes.headers.get('X-Upstream-ETag') || undefined,
          lastModified: subRes.headers.get('X-Upstream-Last-Modified') || undefined,
          blogrollLinks,
        };
      }
    } catch {
      continue;
    }
  }

  throw new Error('No valid RSS or Atom feed found via autodiscovery or common paths.');
}

function extractBlogrollFromHtml(doc: Document, baseUrl: string): string[] {
  try {
    const baseHost = new URL(baseUrl).hostname.replace(/^www\./, '');
    const anchors = Array.from(doc.querySelectorAll('a[href^="http"]'));
    const externalOrigins = new Set<string>();

    for (const a of anchors) {
      try {
        const href = a.getAttribute('href')!;
        const u = new URL(href);
        const host = u.hostname.replace(/^www\./, '');
        if (
          host !== baseHost &&
          !host.includes('twitter.com') &&
          !host.includes('x.com') &&
          !host.includes('github.com') &&
          !host.includes('linkedin.com') &&
          !host.includes('youtube.com') &&
          !host.includes('facebook.com')
        ) {
          externalOrigins.add(u.origin);
        }
      } catch {}
      if (externalOrigins.size >= 10) break;
    }
    return Array.from(externalOrigins);
  } catch {
    return [];
  }
}

export function tryParseFeedXml(
  xmlString: string,
  feedUrl: string
): { title: string; siteUrl: string; posts: ArticlePost[]; blogrollLinks: string[] } | null {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString.trim(), 'text/xml');

  if (xmlDoc.querySelector('parsererror')) {
    return null;
  }

  const normalizedFeedUrl = normalizeFeedUrl(feedUrl);
  const isAtom = xmlDoc.querySelector('feed') !== null;
  const isRss = xmlDoc.querySelector('rss, rdf\\:RDF, RDF') !== null;

  if (!isAtom && !isRss) return null;

  if (isAtom) {
    const feedEl = xmlDoc.querySelector('feed')!;
    const feedTitle = feedEl.querySelector('title')?.textContent?.trim() || normalizedFeedUrl;
    const siteLinkEl =
      feedEl.querySelector('link[rel="alternate"]') || feedEl.querySelector('link:not([rel="self"])');
    const siteUrl = siteLinkEl?.getAttribute('href') || feedUrl;

    const entries = Array.from(feedEl.querySelectorAll('entry')).slice(0, 25);
    const posts: ArticlePost[] = entries.map((entry, idx) => {
      const title = entry.querySelector('title')?.textContent?.trim() || 'Untitled Entry';
      const linkEl =
        entry.querySelector('link[rel="alternate"]') || entry.querySelector('link');
      let link = linkEl?.getAttribute('href') || siteUrl;
      link = resolveUrl(link, siteUrl);

      const idRaw = entry.querySelector('id')?.textContent?.trim() || link || `${idx}`;
      const dateStr =
        entry.querySelector('published')?.textContent ||
        entry.querySelector('updated')?.textContent ||
        '';
      const pubDate = Date.parse(dateStr) || Date.now() - idx * 60000;

      const rawContent =
        entry.querySelector('content')?.textContent ||
        entry.querySelector('summary')?.textContent ||
        '';
      const mediaImg = extractXmlMediaImage(entry, siteUrl);
      const combinedHtml =
        mediaImg && !rawContent.includes('<img')
          ? `<img src="${mediaImg}" alt="" /><p>${rawContent}</p>`
          : rawContent;

      const author = entry.querySelector('author > name')?.textContent?.trim();

      return {
        id: `${normalizedFeedUrl}::${idRaw}`,
        feedUrl: normalizedFeedUrl,
        feedTitle,
        title,
        link,
        pubDate,
        summary: sanitizeHtml(combinedHtml),
        author,
        isRead: false,
      };
    });

    return { title: feedTitle, siteUrl, posts, blogrollLinks: [] };
  }

  const channel = xmlDoc.querySelector('channel') || xmlDoc.documentElement;
  const feedTitle = channel.querySelector('title')?.textContent?.trim() || normalizedFeedUrl;
  const siteUrl = channel.querySelector('link')?.textContent?.trim() || feedUrl;

  const items = Array.from(xmlDoc.querySelectorAll('item')).slice(0, 25);
  const posts: ArticlePost[] = items.map((item, idx) => {
    const title = item.querySelector('title')?.textContent?.trim() || 'Untitled Post';
    let link = item.querySelector('link')?.textContent?.trim() || siteUrl;
    link = resolveUrl(link, siteUrl);

    const guid = item.querySelector('guid')?.textContent?.trim() || link || `${idx}`;
    const dateStr =
      item.querySelector('pubDate')?.textContent ||
      item.getElementsByTagName('dc:date')[0]?.textContent ||
      '';
    const pubDate = Date.parse(dateStr) || Date.now() - idx * 60000;

    const contentEncoded = item.getElementsByTagName('content:encoded')[0]?.textContent;
    const description = item.querySelector('description')?.textContent || '';
    const rawBody = contentEncoded || description;

    const mediaImg = extractXmlMediaImage(item, siteUrl);
    const combinedHtml =
      mediaImg && !rawBody.includes('<img')
        ? `<img src="${mediaImg}" alt="" /><p>${rawBody}</p>`
        : rawBody;

    const author =
      item.querySelector('author')?.textContent ||
      item.getElementsByTagName('dc:creator')[0]?.textContent;

    return {
      id: `${normalizedFeedUrl}::${guid}`,
      feedUrl: normalizedFeedUrl,
      feedTitle,
      title,
      link,
      pubDate,
      summary: sanitizeHtml(combinedHtml),
      author: author?.trim(),
      isRead: false,
    };
  });

  return { title: feedTitle, siteUrl, posts, blogrollLinks: [] };
}

export async function extractFullArticleClientSide(articleUrl: string): Promise<{
  success: boolean;
  html: string;
  leadImage?: string;
  byline?: string;
  error?: string;
}> {
  try {
    const res = await fetch(`/api/fetch?url=${encodeURIComponent(articleUrl)}`);
    if (!res.ok) {
      throw new Error(`Upstream returned HTTP ${res.status}`);
    }
    const rawHtml = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, 'text/html');

    const base = doc.createElement('base');
    base.href = articleUrl;
    doc.head.prepend(base);

    doc.querySelectorAll('img').forEach((img) => {
      const dataSrc =
        img.getAttribute('data-src') ||
        img.getAttribute('data-original') ||
        img.getAttribute('data-lazy-src');
      if (dataSrc && !img.getAttribute('src')) {
        img.setAttribute('src', resolveUrl(dataSrc, articleUrl));
      } else if (img.getAttribute('src')) {
        img.setAttribute('src', resolveUrl(img.getAttribute('src')!, articleUrl));
      }
    });

    const ogImageMeta =
      doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
      doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content') ||
      doc.querySelector('article img')?.getAttribute('src');
    const leadImage = ogImageMeta ? resolveUrl(ogImageMeta, articleUrl) : undefined;

    const docClone = doc.cloneNode(true) as Document;
    const reader = new Readability(docClone, { charThreshold: 120 });
    const parsed = reader.parse();

    let bestHtml = parsed?.content || '';

    const plainLength = bestHtml.replace(/<[^>]+>/g, '').trim().length;
    if (plainLength < 400) {
      const container =
        doc.querySelector('article') ||
        doc.querySelector('[role="main"]') ||
        doc.querySelector('main') ||
        doc.querySelector('.post-content, .entry-content, .article-body, .markdown-body') ||
        doc.body;

      if (container) {
        container
          .querySelectorAll('nav, footer, header, script, style, aside, .sidebar, .comments')
          .forEach((el) => el.remove());

        const paragraphs = Array.from(container.querySelectorAll('p, h2, h3, blockquote, pre, ul, ol, figure, img'))
          .map((el) => el.outerHTML)
          .join('\n');

        if (paragraphs.replace(/<[^>]+>/g, '').trim().length > plainLength) {
          bestHtml = paragraphs;
        }
      }
    }

    if (!bestHtml || bestHtml.replace(/<[^>]+>/g, '').trim().length < 60) {
      return {
        success: false,
        html: '',
        leadImage,
        error: 'Showing feed summary (source page uses client-only rendering).',
      };
    }

    const finalHtml =
      leadImage && !bestHtml.includes(leadImage)
        ? `<figure><img src="${leadImage}" alt="Article Cover" class="w-full rounded-2xl mb-6 object-cover max-h-96" /></figure>${bestHtml}`
        : bestHtml;

    return {
      success: true,
      html: sanitizeHtml(finalHtml),
      leadImage,
      byline: parsed?.byline || undefined,
    };
  } catch (err: any) {
    return {
      success: false,
      html: '',
      error: err?.message || 'Article extraction failed',
    };
  }
}

export interface TrapFinding {
  type: 'DUPLICATE_ALIAS' | 'MALFORMED_XML_OR_DEAD';
  urls: string[];
  details: string;
}

export async function runBonusTrapAuditor(rawUrls: string[]): Promise<TrapFinding[]> {
  const findings: TrapFinding[] = [];
  const seenByNormUrl = new Map<string, string>();
  const seenByTitleOrSite = new Map<string, { rawUrl: string; title: string }>();

  for (const raw of rawUrls) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const norm = normalizeFeedUrl(trimmed);

    if (seenByNormUrl.has(norm)) {
      findings.push({
        type: 'DUPLICATE_ALIAS',
        urls: [seenByNormUrl.get(norm)!, trimmed],
        details: `Both URLs normalize directly to ${norm}`,
      });
      continue;
    }
    seenByNormUrl.set(norm, trimmed);

    try {
      // FIX: Route through /api/fetch proxy so browser doesn't block cross-origin RSS fetches!
      const res = await fetch(`/api/fetch?url=${encodeURIComponent(trimmed)}`);
      if (!res.ok) {
        throw new Error(`HTTP status ${res.status}`);
      }
      const rawText = await res.text();
      const result = tryParseFeedXml(rawText, trimmed);
      if (!result) {
        throw new Error('Failed to parse RSS/Atom XML structure');
      }

      const canonicalKey = `${result.title.toLowerCase()}||${normalizeFeedUrl(result.siteUrl)}`;
      if (seenByTitleOrSite.has(canonicalKey)) {
        const prev = seenByTitleOrSite.get(canonicalKey)!;
        findings.push({
          type: 'DUPLICATE_ALIAS',
          urls: [prev.rawUrl, trimmed],
          details: `TRAP DETECTED: Two distinct URLs point to the exact same blog ("${result.title}")`,
        });
      } else {
        seenByTitleOrSite.set(canonicalKey, { rawUrl: trimmed, title: result.title });
      }
    } catch (err: any) {
      findings.push({
        type: 'MALFORMED_XML_OR_DEAD',
        urls: [trimmed],
        details: `TRAP DETECTED: Feed failed parsing or returned malformed XML (${err.message})`,
      });
    }
  }

  return findings;
}