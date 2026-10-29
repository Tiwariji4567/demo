// lib/utils.ts

export function normalizeFeedUrl(rawUrl: string): string {
  try {
    let urlStr = rawUrl.trim();
    if (!/^https?:\/\//i.test(urlStr)) {
      urlStr = 'https://' + urlStr;
    }
    const url = new URL(urlStr);
    // Force https and strip www.
    url.protocol = 'https:';
    url.hostname = url.hostname.replace(/^www\./i, '').toLowerCase();
    // Strip tracking params
    const stripParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'source'];
    stripParams.forEach((p) => url.searchParams.delete(p));
    // Normalize common equivalent feed endings for canonical comparison
    let pathname = url.pathname.replace(/\/+$/, '');
    if (pathname === '') pathname = '/';
    url.pathname = pathname;
    url.hash = '';
    return url.toString();
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

export function getCanonicalSiteDomain(rawUrl: string): string {
  try {
    const url = new URL(normalizeFeedUrl(rawUrl));
    return url.hostname;
  } catch {
    return rawUrl;
  }
}

export function isSafePublicUrl(rawUrl: string): { valid: boolean; reason?: string } {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { valid: false, reason: 'Only http:// and https:// protocols are permitted.' };
    }
    const host = url.hostname.toLowerCase();
    // Block localhost & loopback
    if (host === 'localhost' || host === '0.0.0.0' || host === '::1' || host.endsWith('.local')) {
      return { valid: false, reason: 'Localhost and local network targets are blocked (SSRF Protection).' };
    }
    // Block private IPv4 ranges (127.x, 10.x, 192.168.x, 172.16-31.x, 169.254.x)
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = host.match(ipv4Regex);
    if (match) {
      const [, a, b] = match.map(Number);
      if (
        a === 127 ||
        a === 10 ||
        (a === 192 && b === 168) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 169 && b === 254) ||
        a === 0
      ) {
        return { valid: false, reason: 'Private IP ranges are strictly forbidden.' };
      }
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: 'Malformed URL.' };
  }
}

export interface SeedFeed {
  title: string;
  url: string;
  siteUrl: string;
  category: string;
  description: string;
}

export const INITIAL_SEED_FEEDS: SeedFeed[] = [
  {
    title: 'Overreacted (Dan Abramov)',
    url: 'https://overreacted.io/rss.xml',
    siteUrl: 'https://overreacted.io',
    category: 'Engineering',
    description: 'Personal blog by Dan Abramov on software engineering and React.',
  },
  {
    title: 'Julia Evans',
    url: 'https://jvns.ca/atom.xml',
    siteUrl: 'https://jvns.ca',
    category: 'Systems & Linux',
    description: 'Deep dives into networking, Linux internals, DNS, and debugging.',
  },
  {
    title: 'Simon Willison’s Weblog',
    url: 'https://simonwillison.net/atom/everything/',
    siteUrl: 'https://simonwillison.net',
    category: 'AI & Web',
    description: 'Creator of Datasette exploring LLMs, Python, and open web tools.',
  },
  {
    title: 'pluralistic.net (Cory Doctorow)',
    url: 'https://pluralistic.net/feed/',
    siteUrl: 'https://pluralistic.net',
    category: 'Digital Rights',
    description: 'Daily links and commentary on tech monopolies, privacy, and the open web.',
  },
  {
    title: 'Krebs on Security',
    url: 'https://krebsonsecurity.com/feed/',
    siteUrl: 'https://krebsonsecurity.com',
    category: 'Security',
    description: 'In-depth security news and investigation by Brian Krebs.',
  },
  {
    title: 'Cassidy Williams',
    url: 'https://cassidoo.co/rss.xml',
    siteUrl: 'https://cassidoo.co',
    category: 'Frontend',
    description: 'Web development, keyboards, and developer humor.',
  },
  {
    title: 'Daring Fireball',
    url: 'https://daringfireball.net/feeds/main',
    siteUrl: 'https://daringfireball.net',
    category: 'Tech Culture',
    description: 'John Gruber’s long-running independent commentary on Apple and tech.',
  },
  {
    title: 'ciechanow.ski (Bartosz Ciechanowski)',
    url: 'https://ciechanow.ski/atom.xml',
    siteUrl: 'https://ciechanow.ski',
    category: 'Interactive Explainers',
    description: 'Breathtaking interactive articles on physics, gears, GPS, and optics.',
  },
  {
    title: 'Dan Luu',
    url: 'https://danluu.com/atom.xml',
    siteUrl: 'https://danluu.com',
    category: 'Hardware & Systems',
    description: 'Empirical engineering analysis, latency, and systems programming.',
  },
  {
    title: 'Mitchell Hashimoto',
    url: 'https://mitchellh.com/feed.xml',
    siteUrl: 'https://mitchellh.com',
    category: 'Systems',
    description: 'Founder of HashiCorp & Ghostty writing on systems software.',
  },
  {
    title: 'fasterthanli.me (Amos)',
    url: 'https://fasterthanli.me/index.xml',
    siteUrl: 'https://fasterthanli.me',
    category: 'Rust & Systems',
    description: 'Long-form investigations into Rust, Linux, and compilers.',
  },
  {
    title: 'Maggie Appleton',
    url: 'https://maggieappleton.com/rss.xml',
    siteUrl: 'https://maggieappleton.com',
    category: 'Design & Digital Gardens',
    description: 'Visual essays on programming, digital gardens, and AI interfaces.',
  },
];