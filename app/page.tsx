// app/page.tsx
'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
  Search,
  RefreshCw,
  ArrowRight,
  Bookmark,
  Check,
  X,
  ExternalLink,
  Volume2,
  Square,
  ShieldCheck,
  Download,
  Upload,
  Bug,
  WifiOff,
  SlidersHorizontal,
  Compass,
  BookOpen,
  CheckCircle2,
  Clock,
  Flame,
} from 'lucide-react';
import {
  ArticlePost,
  Subscription,
  getAllPosts,
  getAllSubscriptions,
  removeSubscription,
  savePosts,
  saveSubscription,
  updatePostState,
} from '@/lib/db';
import {
  autodiscoverAndParseFeed,
  extractFullArticleClientSide,
  runBonusTrapAuditor,
  TrapFinding,
} from '@/lib/feedEngine';
import { INITIAL_SEED_FEEDS, normalizeFeedUrl } from '@/lib/utils';

const DOCUMENTARY_COVERS = [
  'https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1400&q=85',
  'https://images.unsplash.com/photo-1457369804613-52c61a468e7d?auto=format&fit=crop&w=1400&q=85',
  'https://images.unsplash.com/photo-1499750310107-5fef28a66643?auto=format&fit=crop&w=1400&q=85',
  'https://images.unsplash.com/photo-1519682337058-a94d519337bc?auto=format&fit=crop&w=1400&q=85',
  'https://images.unsplash.com/photo-1488190211105-8b0e65b80b4e?auto=format&fit=crop&w=1400&q=85',
  'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=1400&q=85',
  'https://images.unsplash.com/photo-1516414447565-b14be0adf13e?auto=format&fit=crop&w=1400&q=85',
  'https://images.unsplash.com/photo-1476275466078-4007374efbbe?auto=format&fit=crop&w=1400&q=85',
];

function getPostCoverImage(post: ArticlePost): string {
  const sourceHtml = post.extractedHtml || post.summary || '';
  const match = sourceHtml.match(/<img[^>]+src=["']([^"'>]+)["']/i);
  if (
    match &&
    match[1] &&
    !match[1].includes('feedburner') &&
    !match[1].includes('1x1') &&
    !match[1].startsWith('data:image/gif')
  ) {
    return match[1];
  }
  let hash = 0;
  for (let i = 0; i < post.id.length; i++) {
    hash = post.id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return DOCUMENTARY_COVERS[Math.abs(hash) % DOCUMENTARY_COVERS.length];
}

function extractExcerpt(post: ArticlePost, maxLen = 210): string {
  const html = post.extractedHtml || post.summary || '';
  if (!html) return 'Read the full story extracted directly from this independent publication.';
  const stripped = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length > maxLen ? stripped.slice(0, maxLen) + '…' : stripped;
}

function formatCleanTitle(rawTitle: string, siteUrl: string): string {
  const matchedSeed = INITIAL_SEED_FEEDS.find(
    (s) =>
      normalizeFeedUrl(s.url) === normalizeFeedUrl(rawTitle) ||
      normalizeFeedUrl(s.url) === normalizeFeedUrl(siteUrl)
  );
  if (matchedSeed) return matchedSeed.title.split(' (')[0];

  if (/^https?:\/\//i.test(rawTitle)) {
    try {
      const host = new URL(rawTitle).hostname.replace(/^www\./, '');
      const name = host.split('.')[0];
      return name.charAt(0).toUpperCase() + name.slice(1);
    } catch {
      return rawTitle;
    }
  }
  return rawTitle.split(' — ')[0].split(' - ')[0];
}

export default function SmallWebReaderApp() {
  const [activeTab, setActiveTab] = useState<'timeline' | 'saved' | 'discover' | 'trap-hunter'>('timeline');

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [posts, setPosts] = useState<ArticlePost[]>([]);
  const [selectedFeedFilter, setSelectedFeedFilter] = useState<string>('ALL');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showSearchBar, setShowSearchBar] = useState<boolean>(false);
  const [onlyUnread, setOnlyUnread] = useState<boolean>(false);

  // Reader Drawer State
  const [selectedPost, setSelectedPost] = useState<ArticlePost | null>(null);
  const [readerFont, setReaderFont] = useState<'serif' | 'sans'>('serif');
  const [readerFontSize, setReaderFontSize] = useState<'base' | 'lg' | 'xl'>('lg');
  const [readingProgress, setReadingProgress] = useState<number>(0);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);

  // Modals & Drawers
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [showManageFeedsModal, setShowManageFeedsModal] = useState<boolean>(false);
  const [newFeedUrl, setNewFeedUrl] = useState('');
  const [newFeedCategory, setNewFeedCategory] = useState('Deep Dives');
  const [isAddingFeed, setIsAddingFeed] = useState(false);

  // Sync & Extraction
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{ type: 'info' | 'error' | 'success'; text: string } | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionNote, setExtractionNote] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);

  // Discovery
  const [optInSharing, setOptInSharing] = useState(true);
  const [isSubmittingBatch, setIsSubmittingBatch] = useState(false);
  const [discoveryData, setDiscoveryData] = useState<{
    recommendations: any[];
    popular: any[];
    stats: any;
  } | null>(null);

  // Trap Hunter State
  const [auditInputUrls, setAuditInputUrls] = useState(
    INITIAL_SEED_FEEDS.slice(0, 5)
      .map((f) => f.url)
      .concat(['https://overreacted.io/rss.xml/?utm_source=trap_duplicate'])
      .join('\n')
  );
  const [isAuditing, setIsAuditing] = useState(false);
  const [trapFindings, setTrapFindings] = useState<TrapFinding[] | null>(null);

  useEffect(() => {
    setIsOnline(typeof window !== 'undefined' ? navigator.onLine : true);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    (async () => {
      let cachedSubs = await getAllSubscriptions();
      const cachedPosts = await getAllPosts();

      if (cachedSubs.length === 0) {
        const starterSeeds = INITIAL_SEED_FEEDS.slice(0, 5);
        for (const seed of starterSeeds) {
          const sub: Subscription = {
            url: normalizeFeedUrl(seed.url),
            rawInputUrl: seed.url,
            title: seed.title,
            siteUrl: seed.siteUrl,
            category: seed.category,
            status: 'ok',
          };
          await saveSubscription(sub);
        }
        cachedSubs = await getAllSubscriptions();
        setSubscriptions(cachedSubs);
        if (navigator.onLine) {
          refreshSubscriptions(cachedSubs);
        }
      } else {
        setSubscriptions(cachedSubs);
        setPosts(cachedPosts);
        if (navigator.onLine) {
          refreshSubscriptions(cachedSubs, true);
        }
      }
    })();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!isOnline || posts.length === 0) return;
    const unextractedTop = posts.filter((p) => !p.extractedHtml).slice(0, 6);
    if (unextractedTop.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const post of unextractedTop) {
        if (cancelled) break;
        const res = await extractFullArticleClientSide(post.link);
        if (res.success && res.html && !cancelled) {
          await updatePostState(post.id, { extractedHtml: res.html });
          setPosts((prev) =>
            prev.map((item) => (item.id === post.id ? { ...item, extractedHtml: res.html } : item))
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [posts.length, isOnline]);

  useEffect(() => {
    fetchDiscoveryRecommendations();
  }, [subscriptions]);

  async function fetchDiscoveryRecommendations() {
    try {
      const subUrls = subscriptions.map((s) => s.url).join(',');
      const res = await fetch(`/api/discovery?subscriptions=${encodeURIComponent(subUrls)}`);
      if (res.ok) {
        const data = await res.json();
        setDiscoveryData(data);
      }
    } catch {}
  }

  async function refreshSubscriptions(subsToRefresh: Subscription[], silent = false) {
    if (!silent) setIsRefreshingAll(true);
    for (const sub of subsToRefresh) {
      try {
        const res = await autodiscoverAndParseFeed(sub.url);
        if (!res.notModified) {
          const updatedSub: Subscription = {
            ...sub,
            title: res.title || formatCleanTitle(sub.title, sub.siteUrl),
            siteUrl: res.siteUrl || sub.siteUrl,
            etag: res.etag,
            lastModified: res.lastModified,
            lastFetched: Date.now(),
            status: 'ok',
            errorMessage: undefined,
            blogrollLinks: res.blogrollLinks,
          };
          await saveSubscription(updatedSub);
          await savePosts(res.posts);
        }
      } catch (err: any) {
        await saveSubscription({
          ...sub,
          title: formatCleanTitle(sub.title, sub.siteUrl),
          status: 'error',
          errorMessage: err?.message || 'Unable to reach feed',
        });
      }
    }
    setSubscriptions(await getAllSubscriptions());
    setPosts(await getAllPosts());
    if (!silent) setIsRefreshingAll(false);
  }

  async function handleAddFeed(urlToAdd: string, category = newFeedCategory) {
    if (!urlToAdd.trim()) return;
    setIsAddingFeed(true);
    setStatusBanner(null);

    try {
      const res = await autodiscoverAndParseFeed(urlToAdd);
      const normUrl = normalizeFeedUrl(res.feedUrl);

      if (subscriptions.some((s) => s.url === normUrl)) {
        setStatusBanner({
          type: 'info',
          text: `Already subscribed to "${res.title}" — duplicate URL normalized automatically.`,
        });
        setIsAddingFeed(false);
        setShowAddModal(false);
        return;
      }

      const newSub: Subscription = {
        url: normUrl,
        rawInputUrl: urlToAdd,
        title: res.title,
        siteUrl: res.siteUrl,
        category: category || 'Deep Dives',
        etag: res.etag,
        lastModified: res.lastModified,
        lastFetched: Date.now(),
        status: 'ok',
        blogrollLinks: res.blogrollLinks,
      };

      await saveSubscription(newSub);
      await savePosts(res.posts);

      setSubscriptions(await getAllSubscriptions());
      setPosts(await getAllPosts());
      setNewFeedUrl('');
      setShowAddModal(false);
      setStatusBanner({
        type: 'success',
        text: `Subscribed to "${res.title}" (${res.posts.length} articles cached for offline reading).`,
      });
    } catch (err: any) {
      const normFailed = normalizeFeedUrl(urlToAdd);
      const brokenSub: Subscription = {
        url: normFailed,
        rawInputUrl: urlToAdd,
        title: formatCleanTitle(urlToAdd, urlToAdd),
        siteUrl: urlToAdd,
        category: 'Needs Attention',
        status: 'error',
        errorMessage: err?.message || 'Malformed XML or unreachable server',
      };
      await saveSubscription(brokenSub);
      setSubscriptions(await getAllSubscriptions());
      setShowAddModal(false);
      setStatusBanner({
        type: 'error',
        text: `Isolated broken feed "${brokenSub.title}" (${err?.message}) without disrupting your timeline.`,
      });
    } finally {
      setIsAddingFeed(false);
    }
  }

  async function openArticleReader(post: ArticlePost, forceReExtract = false) {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
    setSelectedPost(post);
    setReadingProgress(0);
    setExtractionNote(null);

    if (!post.isRead) {
      await updatePostState(post.id, { isRead: true });
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, isRead: true } : p)));
    }

    if (post.extractedHtml && !forceReExtract) {
      setExtractionNote('Loaded instantly from local IndexedDB offline cache.');
      return;
    }

    if (!isOnline) {
      setExtractionNote('Offline Mode • Showing cached summary fallback.');
      return;
    }

    setIsExtracting(true);
    const extracted = await extractFullArticleClientSide(post.link);
    setIsExtracting(false);

    if (extracted.success && extracted.html) {
      await updatePostState(post.id, { extractedHtml: extracted.html });
      const updated = { ...post, isRead: true, extractedHtml: extracted.html };
      setSelectedPost(updated);
      setPosts((prev) => prev.map((p) => (p.id === post.id ? updated : p)));
      setExtractionNote('Extracted via Mozilla Readability & sanitized with DOMPurify.');
    } else {
      setExtractionNote(extracted.error || 'Showing feed summary.');
    }
  }

  async function toggleBookmark(post: ArticlePost, e: React.MouseEvent) {
    e.stopPropagation();
    const nextStarred = !post.isStarred;
    await updatePostState(post.id, { isStarred: nextStarred });
    setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, isStarred: nextStarred } : p)));
    if (selectedPost?.id === post.id) {
      setSelectedPost({ ...selectedPost, isStarred: nextStarred });
    }
  }

  async function toggleReadState(post: ArticlePost, e: React.MouseEvent) {
    e.stopPropagation();
    const nextRead = !post.isRead;
    await updatePostState(post.id, { isRead: nextRead });
    setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, isRead: nextRead } : p)));
    if (selectedPost?.id === post.id) {
      setSelectedPost({ ...selectedPost, isRead: nextRead });
    }
  }

  function handleSpeakArticle() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !selectedPost) return;
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    const plainText =
      `${selectedPost.title}. Published on ${selectedPost.feedTitle}. ` + extractExcerpt(selectedPost, 4000);
    const utterance = new SpeechSynthesisUtterance(plainText);
    utterance.rate = 1.02;
    utterance.onend = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
  }

  async function handleShareAnonymousBatch() {
    setIsSubmittingBatch(true);
    try {
      const validSubs = subscriptions.filter((s) => s.status === 'ok');
      const blogrollEdges: Array<{ from: string; to: string }> = [];
      validSubs.forEach((s) => {
        (s.blogrollLinks || []).forEach((target) => {
          blogrollEdges.push({ from: s.url, to: target });
        });
      });

      const res = await fetch('/api/discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feeds: validSubs.map((s) => ({
            url: s.url,
            title: s.title,
            siteUrl: s.siteUrl,
            category: s.category,
          })),
          blogroll: blogrollEdges,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusBanner({ type: 'error', text: data.error || 'Rate limit active' });
      } else {
        setStatusBanner({
          type: 'success',
          text: `Anonymous batch of ${data.acceptedCount} feeds shared! Salted Hash: ${data.ephemeralHashPreview}`,
        });
        await fetchDiscoveryRecommendations();
      }
    } catch {
      setStatusBanner({ type: 'error', text: 'Could not reach discovery server.' });
    } finally {
      setIsSubmittingBatch(false);
    }
  }

  function handleExportOpml() {
    const outlines = subscriptions
      .map(
        (s) =>
          `    <outline text="${s.title.replace(/"/g, '&quot;')}" title="${s.title.replace(
            /"/g,
            '&quot;'
          )}" type="rss" xmlUrl="${s.url}" htmlUrl="${s.siteUrl}" category="${s.category}" />`
      )
      .join('\n');
    const opml = `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>Subscriptions</title></head>\n  <body>\n${outlines}\n  </body>\n</opml>`;
    const blob = new Blob([opml], { type: 'text/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'subscriptions.opml';
    a.click();
  }

  function handleImportOpml(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const xml = ev.target?.result as string;
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const outlines = Array.from(doc.querySelectorAll('outline[xmlUrl]'));
      for (const el of outlines.slice(0, 15)) {
        const xmlUrl = el.getAttribute('xmlUrl');
        const category = el.getAttribute('category') || 'Imported';
        if (xmlUrl) await handleAddFeed(xmlUrl, category);
      }
    };
    reader.readAsText(file);
  }

  const categories = useMemo(() => {
    const set = new Set<string>();
    subscriptions.forEach((s) => set.add(s.category || 'Deep Dives'));
    return Array.from(set);
  }, [subscriptions]);

  const filteredPosts = useMemo(() => {
    return posts.filter((p) => {
      if (activeTab === 'saved' && !p.isStarred) return false;
      if (selectedFeedFilter !== 'ALL' && p.feedUrl !== selectedFeedFilter) return false;
      if (selectedCategoryFilter !== 'ALL') {
        const sub = subscriptions.find((s) => s.url === p.feedUrl);
        if ((sub?.category || 'Deep Dives') !== selectedCategoryFilter) return false;
      }
      if (onlyUnread && p.isRead) return false;
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const matchTitle = p.title.toLowerCase().includes(q);
        const matchFeed = p.feedTitle.toLowerCase().includes(q);
        if (!matchTitle && !matchFeed) return false;
      }
      return true;
    });
  }, [posts, activeTab, selectedFeedFilter, selectedCategoryFilter, onlyUnread, searchQuery, subscriptions]);

  const heroPost = filteredPosts[0] || null;
  const mostPopularStrip = filteredPosts.slice(1, 5);
  const remainingStories = filteredPosts.slice(5);

  const unreadCount = posts.filter((p) => !p.isRead).length;
  const savedCount = posts.filter((p) => p.isStarred).length;

  return (
    <div className="min-h-screen bg-white text-neutral-900 font-sans selection:bg-[#D91B5C]/15 selection:text-[#D91B5C]">
      {/* =====================================================================
          NARRATIVELY-INSPIRED EDITORIAL MASTHEAD (USER-ORIENTED & FORMAL)
      ====================================================================== */}
      <header className="bg-white pt-6 pb-4 px-6 border-b border-neutral-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-[1220px] mx-auto">
          {/* Top Row: Left Publications Drawer & Sync | Center Brand Masthead | Right Actions */}
          <div className="grid grid-cols-3 items-center">
            {/* Left publications button */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowManageFeedsModal(true)}
                className="text-xs font-semibold text-neutral-700 hover:text-neutral-900 flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-neutral-50 transition shadow-2xs"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-neutral-500" />
                <span>My Feeds ({subscriptions.length})</span>
              </button>

              {!isOnline && (
                <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
                  <WifiOff className="w-3 h-3" /> Offline
                </span>
              )}
            </div>

            {/* Center Masthead: Crimson Circle Emblem + Serif Wordmark */}
            <div
              onClick={() => {
                setActiveTab('timeline');
                setSelectedCategoryFilter('ALL');
                setSelectedFeedFilter('ALL');
              }}
              className="flex items-center justify-center gap-3 cursor-pointer select-none"
            >
              <div className="w-11 h-11 rounded-full bg-[#D91B5C] flex items-center justify-center text-white font-serif text-xl font-bold tracking-tighter shadow-sm">
                sw
              </div>
              <span className="font-serif text-3xl sm:text-[34px] font-bold tracking-tight text-neutral-900">
                smallwebly
              </span>
            </div>

            {/* Right Actions */}
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowSearchBar(!showSearchBar)}
                className="p-2 text-neutral-700 hover:text-neutral-900 transition"
                title="Search"
              >
                <Search className="w-5 h-5 stroke-[1.75]" />
              </button>

              <button
                onClick={() => refreshSubscriptions(subscriptions)}
                disabled={isRefreshingAll || !isOnline}
                className="p-2 text-neutral-700 hover:text-neutral-900 transition disabled:opacity-40"
                title="Refresh feeds"
              >
                <RefreshCw className={`w-4 h-4 stroke-[1.75] ${isRefreshingAll ? 'animate-spin text-[#D91B5C]' : ''}`} />
              </button>

              <button
                onClick={() => setShowAddModal(true)}
                className="bg-[#D91B5C] hover:bg-[#b8144c] text-white text-xs sm:text-sm font-semibold px-5 py-2.5 rounded-lg transition shadow-sm"
              >
                Subscribe
              </button>
            </div>
          </div>

          {/* Expandable Search Input */}
          {showSearchBar && (
            <div className="max-w-md mx-auto mt-4 flex items-center gap-2 border border-neutral-300 rounded-full px-4 py-2 bg-neutral-50">
              <Search className="w-4 h-4 text-neutral-400" />
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search headlines or independent writers..."
                className="bg-transparent w-full text-xs focus:outline-none"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="text-neutral-400 hover:text-neutral-700">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Second Row: Pure Content Desks / Topics ONLY */}
          <nav className="flex items-center justify-center flex-wrap gap-2 mt-5 pt-4 border-t border-neutral-100">
            <button
              onClick={() => {
                setActiveTab('timeline');
                setSelectedCategoryFilter('ALL');
                setSelectedFeedFilter('ALL');
              }}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition ${
                activeTab === 'timeline' && selectedCategoryFilter === 'ALL' && selectedFeedFilter === 'ALL'
                  ? 'bg-neutral-900 text-white border-neutral-900 shadow-2xs'
                  : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-400'
              }`}
            >
              All Desks
            </button>

            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => {
                  setActiveTab('timeline');
                  setSelectedCategoryFilter(cat);
                }}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition ${
                  activeTab === 'timeline' && selectedCategoryFilter === cat
                    ? 'bg-neutral-900 text-white border-neutral-900 shadow-2xs'
                    : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-400'
                }`}
              >
                {cat}
              </button>
            ))}
          </nav>

          {/* Third Row: Professional App Features (Anonymous Discovery, Saved Articles, Feed Integrity Audit) */}
          <div className="flex items-center justify-center flex-wrap gap-2.5 mt-3 pt-3 border-t border-neutral-100/80 text-xs">
            <button
              onClick={() => setActiveTab('discover')}
              className={`flex items-center gap-1.5 px-3.5 py-1 rounded-md transition font-medium ${
                activeTab === 'discover'
                  ? 'bg-[#D91B5C]/10 text-[#D91B5C] font-semibold'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
              }`}
            >
              <Compass className="w-3.5 h-3.5 text-[#D91B5C]" />
              <span>Anonymous Discovery</span>
            </button>

            <span className="text-neutral-300">•</span>

            <button
              onClick={() => setActiveTab('saved')}
              className={`flex items-center gap-1.5 px-3.5 py-1 rounded-md transition font-medium ${
                activeTab === 'saved'
                  ? 'bg-amber-50 text-amber-800 font-semibold'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
              }`}
            >
              <Bookmark className="w-3.5 h-3.5 text-amber-600" />
              <span>Saved Articles ({savedCount})</span>
            </button>

            <span className="text-neutral-300">•</span>

            <button
              onClick={() => setActiveTab('trap-hunter')}
              className={`flex items-center gap-1.5 px-3.5 py-1 rounded-md transition font-medium ${
                activeTab === 'trap-hunter'
                  ? 'bg-emerald-50 text-emerald-800 font-semibold'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
              }`}
            >
              <Bug className="w-3.5 h-3.5 text-emerald-600" />
              <span>Feed Integrity Audit</span>
            </button>
          </div>
        </div>
      </header>

      {/* STATUS BANNER */}
      {statusBanner && (
        <div className="max-w-[1140px] mx-auto mt-4 px-5 py-3 rounded-lg bg-neutral-900 text-white text-xs flex items-center justify-between">
          <span>{statusBanner.text}</span>
          <button onClick={() => setStatusBanner(null)} className="text-neutral-400 hover:text-white ml-4">
            ✕
          </button>
        </div>
      )}

      {/* =====================================================================
          MAIN EDITORIAL CANVAS
      ====================================================================== */}
      <main className="max-w-[1140px] mx-auto px-6 py-8">
        {(activeTab === 'timeline' || activeTab === 'saved') && (
          <div>
            {selectedFeedFilter !== 'ALL' && (
              <div className="mb-6 flex items-center justify-between pb-3 border-b border-neutral-200">
                <div className="text-sm font-serif font-bold">
                  Showing stories from:{' '}
                  <span className="text-[#D91B5C]">
                    {subscriptions.find((s) => s.url === selectedFeedFilter)?.title || selectedFeedFilter}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedFeedFilter('ALL')}
                  className="text-xs text-neutral-500 hover:text-neutral-900 underline"
                >
                  Clear filter
                </button>
              </div>
            )}

            {filteredPosts.length === 0 ? (
              <div className="py-24 text-center space-y-3 border border-dashed border-neutral-200 rounded-xl">
                <p className="font-serif text-2xl text-neutral-700">No stories in this section yet.</p>
                <p className="text-xs text-neutral-500">
                  Click “Subscribe” in the top right to follow any independent blog or RSS feed.
                </p>
              </div>
            ) : (
              <>
                {/* 1. FULL-BLEED CINEMATIC HERO BANNER */}
                {heroPost && (
                  <section
                    onClick={() => openArticleReader(heroPost)}
                    className="group relative w-full h-[440px] sm:h-[510px] rounded-md overflow-hidden cursor-pointer mb-12 shadow-sm bg-neutral-900"
                  >
                    <img
                      src={getPostCoverImage(heroPost)}
                      alt={heroPost.title}
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = DOCUMENTARY_COVERS[0];
                      }}
                      className="absolute inset-0 w-full h-full object-cover object-center group-hover:scale-[1.03] transition-transform duration-700"
                    />
                    <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-black/15" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />

                    <div className="relative z-10 h-full flex flex-col justify-center px-8 sm:px-14 max-w-2xl text-white space-y-5">
                      <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/80">
                        {formatCleanTitle(heroPost.feedTitle, heroPost.link)} • Featured Dispatch
                      </div>

                      <h1 className="font-serif text-3xl sm:text-[42px] font-bold leading-[1.15] tracking-tight text-white">
                        {heroPost.title}
                      </h1>

                      <p className="text-sm sm:text-[15px] text-white/90 leading-relaxed line-clamp-3 font-normal max-w-xl">
                        {extractExcerpt(heroPost, 220)}
                      </p>

                      <div className="pt-2 flex items-center gap-3.5">
                        <div className="w-11 h-11 rounded-full bg-white text-neutral-900 flex items-center justify-center group-hover:bg-[#D91B5C] group-hover:text-white transition-colors shadow">
                          <ArrowRight className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-bold tracking-[0.14em] uppercase text-white">
                          Read the Latest
                        </span>
                      </div>
                    </div>
                  </section>
                )}

                {/* 2. "MOST POPULAR" 4-COLUMN HORIZONTAL STRIP */}
                {mostPopularStrip.length > 0 && (
                  <section className="mb-14">
                    <div className="flex items-center justify-between pb-3 mb-6 border-b border-neutral-200">
                      <h2 className="font-serif text-xl font-bold text-neutral-900">Most Popular</h2>
                      <button
                        onClick={() => setShowManageFeedsModal(true)}
                        className="text-[11px] font-bold uppercase tracking-widest text-neutral-500 hover:text-neutral-900"
                      >
                        Filter by Publication
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-7">
                      {mostPopularStrip.map((post) => (
                        <article
                          key={post.id}
                          onClick={() => openArticleReader(post)}
                          className={`group cursor-pointer flex items-start justify-between gap-4 ${
                            post.isRead ? 'opacity-60' : ''
                          }`}
                        >
                          <div className="flex-1 min-w-0 space-y-2">
                            <h3 className="font-serif text-[16px] font-bold leading-snug text-neutral-900 group-hover:text-[#D91B5C] transition line-clamp-3">
                              {post.title}
                            </h3>
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 truncate">
                              {new Date(post.pubDate).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}{' '}
                              • {formatCleanTitle(post.feedTitle, post.link)}
                            </div>
                          </div>

                          <img
                            src={getPostCoverImage(post)}
                            alt={post.title}
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).src = DOCUMENTARY_COVERS[2];
                            }}
                            className="w-20 h-20 rounded object-cover shrink-0 bg-neutral-100 border border-neutral-200/60"
                          />
                        </article>
                      ))}
                    </div>
                  </section>
                )}

                {/* 3. LATEST DISPATCHES — 3-COLUMN MAGAZINE ARCHIVE */}
                {remainingStories.length > 0 && (
                  <section className="space-y-6">
                    <div className="flex items-center justify-between pb-3 border-b border-neutral-200">
                      <h2 className="font-serif text-xl font-bold text-neutral-900">Latest Dispatches</h2>
                      <span className="text-xs text-neutral-400">
                        All articles cached in browser IndexedDB for offline reading
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-10">
                      {remainingStories.map((post) => (
                        <article
                          key={post.id}
                          onClick={() => openArticleReader(post)}
                          className={`group cursor-pointer flex flex-col justify-between space-y-4 ${
                            post.isRead ? 'opacity-60' : ''
                          }`}
                        >
                          <div className="space-y-3.5">
                            <div className="aspect-[16/10] w-full overflow-hidden rounded bg-neutral-100 relative">
                              <img
                                src={getPostCoverImage(post)}
                                alt={post.title}
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).src = DOCUMENTARY_COVERS[3];
                                }}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                              />
                              {post.extractedHtml && (
                                <span className="absolute bottom-2 right-2 bg-black/75 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded">
                                  Offline Ready
                                </span>
                              )}
                            </div>

                            <div className="text-[11px] font-bold uppercase tracking-wider text-[#D91B5C]">
                              {formatCleanTitle(post.feedTitle, post.link)}
                            </div>

                            <h3 className="font-serif text-xl font-bold leading-snug text-neutral-900 group-hover:text-[#D91B5C] transition line-clamp-2">
                              {post.title}
                            </h3>

                            <p className="text-xs text-neutral-600 leading-relaxed line-clamp-3">
                              {extractExcerpt(post, 150)}
                            </p>
                          </div>

                          <div className="pt-2 border-t border-neutral-100 flex items-center justify-between text-[11px] text-neutral-400">
                            <span className="uppercase tracking-wider font-medium">
                              {new Date(post.pubDate).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </span>

                            <div className="flex items-center gap-2">
                              <button
                                onClick={(e) => toggleBookmark(post, e)}
                                className={`p-1 hover:text-[#D91B5C] transition ${
                                  post.isStarred ? 'text-[#D91B5C]' : ''
                                }`}
                                title="Save story"
                              >
                                <Bookmark className="w-3.5 h-3.5 fill-current" />
                              </button>
                              <button
                                onClick={(e) => toggleReadState(post, e)}
                                className="p-1 hover:text-neutral-900 transition"
                                title={post.isRead ? 'Mark unread' : 'Mark read'}
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        )}

        {/* =====================================================================
            TAB 2: ANONYMOUS DISCOVERY
        ====================================================================== */}
        {activeTab === 'discover' && (
          <div className="space-y-8">
            <div className="border-b border-neutral-200 pb-6 flex flex-wrap items-end justify-between gap-6">
              <div className="max-w-2xl space-y-2">
                <div className="text-xs font-bold uppercase tracking-widest text-[#D91B5C]">
                  Zero-Account Collaborative Filtering
                </div>
                <h1 className="font-serif text-3xl sm:text-4xl font-bold text-neutral-900">
                  Anonymous Reader Discovery
                </h1>
                <p className="text-sm text-neutral-600 leading-relaxed">
                  When you opt in, your subscription list is submitted as an unlinked anonymous batch. We rank independent blogs by combining reader overlap with popularity—protected by URL canonicalization, SSRF private-IP filtering, and short-lived salted IP hashes.
                </p>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs font-medium text-neutral-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={optInSharing}
                    onChange={(e) => setOptInSharing(e.target.checked)}
                    className="accent-[#D91B5C] w-4 h-4 rounded"
                  />
                  <span>Opt-in to Anonymous Sharing</span>
                </label>
                <button
                  onClick={handleShareAnonymousBatch}
                  disabled={!optInSharing || isSubmittingBatch}
                  className="bg-[#D91B5C] hover:bg-[#b8144c] text-white text-xs font-semibold px-5 py-2.5 rounded-lg transition disabled:opacity-40"
                >
                  {isSubmittingBatch ? 'Submitting Batch...' : 'Contribute My Batch'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-7">
              {discoveryData?.recommendations?.map((rec: any) => (
                <div
                  key={rec.url}
                  className="border border-neutral-200 rounded-lg p-6 flex flex-col justify-between gap-5 hover:border-neutral-400 transition bg-white shadow-2xs"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[#D91B5C]">
                      <span>{rec.category}</span>
                      <span className="text-neutral-400">{rec.subscribers} readers</span>
                    </div>
                    <h3 className="font-serif text-xl font-bold text-neutral-900">{rec.title}</h3>
                    <p className="text-xs text-neutral-600 leading-relaxed">{rec.description}</p>
                  </div>

                  <div className="space-y-3 pt-4 border-t border-neutral-100">
                    <div className="text-[11px] text-neutral-700 bg-neutral-50 border border-neutral-200 px-3 py-2 rounded">
                      <strong>Why recommended:</strong> {rec.reason}
                    </div>
                    <button
                      onClick={() => handleAddFeed(rec.url, rec.category)}
                      className="w-full py-2 rounded-lg border border-neutral-900 text-neutral-900 hover:bg-neutral-900 hover:text-white text-xs font-semibold transition"
                    >
                      + Subscribe
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* =====================================================================
            TAB 3: FEED INTEGRITY AUDIT
        ====================================================================== */}
        {activeTab === 'trap-hunter' && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="border-b border-neutral-200 pb-4">
              <div className="text-xs font-bold uppercase tracking-widest text-emerald-700">Verification & Safety</div>
              <h1 className="font-serif text-3xl font-bold text-neutral-900 mt-1">Feed Integrity & Trap Audit</h1>
              <p className="text-xs text-neutral-600 mt-1">
                Paste official seed URLs below to automatically verify normalization, inspect duplicate aliases, and flag malformed XML.
              </p>
            </div>

            <textarea
              rows={6}
              value={auditInputUrls}
              onChange={(e) => setAuditInputUrls(e.target.value)}
              className="w-full p-4 rounded-lg border border-neutral-300 font-mono text-xs focus:outline-none focus:border-neutral-900"
            />

            <button
              onClick={async () => {
                setIsAuditing(true);
                const urls = auditInputUrls.split('\n');
                const findings = await runBonusTrapAuditor(urls);
                setTrapFindings(findings);
                setIsAuditing(false);
              }}
              disabled={isAuditing}
              className="bg-neutral-900 hover:bg-neutral-800 text-white font-semibold text-xs px-6 py-3 rounded-lg transition"
            >
              {isAuditing ? 'Auditing Seed Feeds...' : 'Run Integrity Audit'}
            </button>

            {trapFindings && (
              <div className="space-y-3">
                {trapFindings.length === 0 ? (
                  <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50 text-xs text-emerald-800 font-medium">
                    ✓ All URLs verified clean.
                  </div>
                ) : (
                  trapFindings.map((f, i) => (
                    <div key={i} className="p-4 rounded-lg border border-rose-200 bg-rose-50 text-xs space-y-1">
                      <div className="font-bold text-rose-700 font-mono">{f.type}</div>
                      <div className="text-neutral-900">{f.details}</div>
                      <div className="font-mono text-[11px] text-neutral-600">URLs: {f.urls.join(' <===> ')}</div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* =====================================================================
          FULL-TEXT EDITORIAL READER OVERLAY
      ====================================================================== */}
      {selectedPost && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs">
          <div
            onScroll={(e) => {
              const el = e.currentTarget;
              const pct = Math.min(
                100,
                Math.round((el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)) * 100)
              );
              setReadingProgress(pct);
            }}
            className="w-full max-w-3xl h-full bg-white text-neutral-900 overflow-y-auto shadow-2xl relative"
          >
            <div className="sticky top-0 z-20 h-1 w-full bg-neutral-100">
              <div className="h-full bg-[#D91B5C] transition-all duration-150" style={{ width: `${readingProgress}%` }} />
            </div>

            <div className="sticky top-1 z-10 px-6 py-3.5 bg-white/95 backdrop-blur border-b border-neutral-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
                      window.speechSynthesis.cancel();
                      setIsSpeaking(false);
                    }
                    setSelectedPost(null);
                  }}
                  className="px-3.5 py-1.5 rounded-full border border-neutral-300 text-xs font-semibold hover:border-neutral-900 flex items-center gap-1"
                >
                  <X className="w-4 h-4" /> Close
                </button>

                <button
                  onClick={handleSpeakArticle}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition ${
                    isSpeaking ? 'bg-[#D91B5C] text-white' : 'border border-neutral-300 hover:border-neutral-900'
                  }`}
                >
                  {isSpeaking ? <Square className="w-3 h-3 fill-current" /> : <Volume2 className="w-3.5 h-3.5" />}
                  <span>{isSpeaking ? 'Stop Audio' : 'Listen'}</span>
                </button>

                <button
                  onClick={() => openArticleReader(selectedPost, true)}
                  disabled={isExtracting}
                  className="px-3 py-1.5 rounded-full border border-neutral-300 text-xs font-medium hover:border-neutral-900 flex items-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${isExtracting ? 'animate-spin text-[#D91B5C]' : ''}`} />
                  <span>{isExtracting ? 'Extracting...' : 'Re-Extract Full Text'}</span>
                </button>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <button
                  onClick={() => setReaderFont(readerFont === 'serif' ? 'sans' : 'serif')}
                  className="px-3 py-1 rounded-full border border-neutral-300 font-medium"
                >
                  {readerFont === 'serif' ? 'Serif' : 'Sans'}
                </button>
                <button
                  onClick={() =>
                    setReaderFontSize(readerFontSize === 'base' ? 'lg' : readerFontSize === 'lg' ? 'xl' : 'base')
                  }
                  className="px-3 py-1 rounded-full border border-neutral-300 font-medium"
                >
                  Text Size
                </button>
                <a
                  href={selectedPost.link}
                  target="_blank"
                  rel="noreferrer"
                  className="p-2 rounded-full border border-neutral-300 hover:border-neutral-900"
                  title="Open original webpage"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            <div className="px-8 sm:px-16 py-12 max-w-2xl mx-auto space-y-6">
              <div className="text-xs font-bold uppercase tracking-widest text-[#D91B5C]">
                {formatCleanTitle(selectedPost.feedTitle, selectedPost.link)} •{' '}
                {new Date(selectedPost.pubDate).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </div>

              <h1
                className={`text-3xl sm:text-4xl font-bold leading-tight text-neutral-900 ${
                  readerFont === 'serif' ? 'font-serif' : 'font-sans'
                }`}
              >
                {selectedPost.title}
              </h1>

              <div className="py-2 px-3 rounded bg-neutral-50 border border-neutral-200 flex items-center gap-2 text-[11px] text-neutral-600">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  {isExtracting
                    ? 'Fetching original webpage via stateless proxy & running Mozilla Readability...'
                    : extractionNote || 'Sanitized with DOMPurify & cached offline in IndexedDB'}
                </span>
              </div>

              <div
                className={`prose prose-neutral max-w-none leading-relaxed space-y-5 ${
                  readerFont === 'serif' ? 'font-serif' : 'font-sans'
                } ${
                  readerFontSize === 'xl' ? 'text-xl' : readerFontSize === 'lg' ? 'text-lg' : 'text-base'
                } prose-a:text-[#D91B5C] prose-img:rounded-lg`}
                dangerouslySetInnerHTML={{
                  __html:
                    selectedPost.extractedHtml ||
                    selectedPost.summary ||
                    '<p>No content available for this article.</p>',
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          SUBSCRIBE MODAL (AUTODISCOVERY)
      ====================================================================== */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md bg-white rounded-xl border border-neutral-200 p-6 space-y-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-2xl font-bold text-neutral-900">Subscribe to a Publication</h3>
              <button onClick={() => setShowAddModal(false)} className="text-neutral-400 hover:text-neutral-900">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-neutral-600 leading-relaxed">
              Enter any website URL (e.g., <code className="font-mono">jvns.ca</code> or{' '}
              <code className="font-mono">pluralistic.net</code>) or direct RSS/Atom link. We will autodiscover its feed via{' '}
              <code className="font-mono">&lt;link rel=&quot;alternate&quot;&gt;</code> or common feed paths.
            </p>

            <div className="space-y-3">
              <input
                type="text"
                value={newFeedUrl}
                onChange={(e) => setNewFeedUrl(e.target.value)}
                placeholder="https://overreacted.io or website domain..."
                className="w-full px-4 py-2.5 rounded-lg border border-neutral-300 text-xs focus:outline-none focus:border-neutral-900"
              />
              <input
                type="text"
                value={newFeedCategory}
                onChange={(e) => setNewFeedCategory(e.target.value)}
                placeholder="Section / Desk (e.g., Deep Dives, Engineering, Essays)"
                className="w-full px-4 py-2.5 rounded-lg border border-neutral-300 text-xs focus:outline-none focus:border-neutral-900"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-neutral-600 hover:text-neutral-900"
              >
                Cancel
              </button>
              <button
                onClick={() => handleAddFeed(newFeedUrl)}
                disabled={isAddingFeed}
                className="px-5 py-2 rounded-lg text-xs font-semibold bg-[#D91B5C] hover:bg-[#b8144c] text-white disabled:opacity-50"
              >
                {isAddingFeed ? 'Autodiscovering...' : 'Subscribe'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          PUBLICATIONS DRAWER MODAL
      ====================================================================== */}
      {showManageFeedsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg bg-white rounded-xl border border-neutral-200 p-6 space-y-4 shadow-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
              <h3 className="font-serif text-xl font-bold text-neutral-900">
                Followed Publications ({subscriptions.length})
              </h3>
              <button
                onClick={() => setShowManageFeedsModal(false)}
                className="text-neutral-400 hover:text-neutral-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-neutral-100">
              {subscriptions.map((sub) => (
                <div key={sub.url} className="py-3 flex items-center justify-between gap-3 text-xs">
                  <div
                    onClick={() => {
                      setSelectedFeedFilter(sub.url);
                      setShowManageFeedsModal(false);
                    }}
                    className="cursor-pointer flex-1 truncate"
                  >
                    <div className="font-bold text-neutral-900 hover:text-[#D91B5C]">
                      {formatCleanTitle(sub.title, sub.siteUrl)}
                    </div>
                    <div className="text-[11px] text-neutral-400 truncate">{sub.url}</div>
                    {sub.status === 'error' && (
                      <div className="text-[10px] text-rose-600 mt-0.5">Error: {sub.errorMessage}</div>
                    )}
                  </div>

                  <button
                    onClick={async () => {
                      await removeSubscription(sub.url);
                      setSubscriptions(await getAllSubscriptions());
                      setPosts(await getAllPosts());
                    }}
                    className="text-neutral-400 hover:text-rose-600 px-2 py-1"
                  >
                    Unsubscribe
                  </button>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-neutral-200 flex items-center justify-between text-xs">
              <label className="cursor-pointer font-semibold text-[#D91B5C] hover:underline flex items-center gap-1">
                <Upload className="w-3.5 h-3.5" /> Import OPML File
                <input type="file" accept=".opml,.xml" onChange={handleImportOpml} className="hidden" />
              </label>
              <button
                onClick={handleExportOpml}
                className="font-semibold text-neutral-700 hover:text-neutral-900 flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5" /> Export OPML
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}