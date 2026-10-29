// app/api/fetch/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { isSafePublicUrl } from '@/lib/utils';

export async function GET(req: NextRequest) {
  const targetUrl = req.nextUrl.searchParams.get('url');
  const ifNoneMatch = req.nextUrl.searchParams.get('etag');
  const ifModifiedSince = req.nextUrl.searchParams.get('lastModified');

  if (!targetUrl) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  const safety = isSafePublicUrl(targetUrl);
  if (!safety.valid) {
    return NextResponse.json({ error: safety.reason }, { status: 403 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);

    const headers: Record<string, string> = {
      'User-Agent': 'SmallWebReader/1.0 (+https://smallweb.local; Anonymous Indie RSS Reader)',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*',
    };

    if (ifNoneMatch) headers['If-None-Match'] = ifNoneMatch;
    if (ifModifiedSince) headers['If-Modified-Since'] = ifModifiedSince;

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timeout);

    if (response.status === 304) {
      return new NextResponse(null, {
        status: 304,
        headers: { 'X-Cache-Status': 'NOT_MODIFIED' },
      });
    }

    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || 'text/plain; charset=utf-8';
    const etag = response.headers.get('etag') || '';
    const lastModified = response.headers.get('last-modified') || '';

    return new NextResponse(rawText, {
      status: response.status,
      headers: {
        'Content-Type': contentType,
        'X-Upstream-Status': String(response.status),
        'X-Upstream-ETag': etag,
        'X-Upstream-Last-Modified': lastModified,
        'X-Final-Url': response.url || targetUrl,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    const isTimeout = err?.name === 'AbortError';
    return NextResponse.json(
      {
        error: isTimeout ? 'Upstream server timed out (9s limit)' : 'Failed to reach upstream server',
        details: err?.message || 'Unknown network error',
      },
      { status: 502 }
    );
  }
}