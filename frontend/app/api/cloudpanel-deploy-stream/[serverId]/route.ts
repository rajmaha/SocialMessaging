import { NextRequest } from 'next/server'

// Force dynamic so Next.js never statically caches this route
export const dynamic = 'force-dynamic'

/**
 * Transparent SSE proxy for the CloudPanel deployment stream.
 *
 * Next.js rewrites (next.config.js) buffer the full response before forwarding
 * it to the browser, which completely breaks SSE streaming.  This App Router
 * route handler pipes the backend ReadableStream directly to the browser with
 * no intermediate buffering.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: { serverId: string } }
) {
    const backendUrl = process.env.BACKEND_INTERNAL_URL || 'http://backend:8000'
    const body = await request.text()
    const authHeader = request.headers.get('Authorization') || ''

    const backendRes = await fetch(
        `${backendUrl}/cloudpanel/servers/${params.serverId}/sites/deploy-stream`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authHeader,
            },
            body,
            // Disable Next.js / Node fetch caching
            cache: 'no-store',
        }
    )

    // Pipe the backend ReadableStream straight to the browser.
    // This avoids any buffering that Next.js rewrites introduce.
    return new Response(backendRes.body, {
        status: backendRes.status,
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    })
}
