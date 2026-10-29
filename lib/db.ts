// lib/db.ts
import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface Subscription {
  url: string;          // Normalized feed URL (Primary Key)
  rawInputUrl: string;
  title: string;
  siteUrl: string;
  category: string;
  etag?: string;
  lastModified?: string;
  lastFetched?: number;
  status: 'ok' | 'error' | 'loading';
  errorMessage?: string;
  blogrollLinks?: string[];
}

export interface ArticlePost {
  id: string;           // Unique deterministic ID (feedUrl + guid/link)
  feedUrl: string;
  feedTitle: string;
  title: string;
  link: string;
  pubDate: number;      // Timestamp for unified chronological sorting
  summary: string;      // Sanitized RSS summary fallback
  extractedHtml?: string; // Cached Mozilla Readability full text
  author?: string;
  isRead: boolean;
  isStarred?: boolean;
}

interface ReaderDB extends DBSchema {
  subscriptions: {
    key: string;
    value: Subscription;
  };
  posts: {
    key: string;
    value: ArticlePost;
    indexes: { 'by-feed': string; 'by-date': number };
  };
}

let dbPromise: Promise<IDBPDatabase<ReaderDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<ReaderDB>('small-web-reader-db', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('subscriptions')) {
          db.createObjectStore('subscriptions', { keyPath: 'url' });
        }
        if (!db.objectStoreNames.contains('posts')) {
          const postStore = db.createObjectStore('posts', { keyPath: 'id' });
          postStore.createIndex('by-feed', 'feedUrl');
          postStore.createIndex('by-date', 'pubDate');
        }
      },
    });
  }
  return dbPromise;
}

export async function getAllSubscriptions(): Promise<Subscription[]> {
  const db = await getDB();
  return db.getAll('subscriptions');
}

export async function saveSubscription(sub: Subscription): Promise<void> {
  const db = await getDB();
  await db.put('subscriptions', sub);
}

export async function removeSubscription(url: string): Promise<void> {
  const db = await getDB();
  await db.delete('subscriptions', url);
  const allPosts = await db.getAllFromIndex('posts', 'by-feed', url);
  const tx = db.transaction('posts', 'readwrite');
  for (const p of allPosts) {
    await tx.store.delete(p.id);
  }
  await tx.done;
}

export async function getAllPosts(): Promise<ArticlePost[]> {
  const db = await getDB();
  const posts = await db.getAll('posts');
  return posts.sort((a, b) => b.pubDate - a.pubDate);
}

export async function savePosts(newPosts: ArticlePost[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('posts', 'readwrite');
  for (const post of newPosts) {
    const existing = await tx.store.get(post.id);
    if (existing) {
      // Preserve read status and cached extracted full-text across refreshes!
      await tx.store.put({
        ...post,
        isRead: existing.isRead,
        isStarred: existing.isStarred,
        extractedHtml: existing.extractedHtml || post.extractedHtml,
      });
    } else {
      await tx.store.put(post);
    }
  }
  await tx.done;
}

export async function updatePostState(
  id: string,
  updates: Partial<Pick<ArticlePost, 'isRead' | 'isStarred' | 'extractedHtml'>>
): Promise<void> {
  const db = await getDB();
  const existing = await db.get('posts', id);
  if (existing) {
    await db.put('posts', { ...existing, ...updates });
  }
}