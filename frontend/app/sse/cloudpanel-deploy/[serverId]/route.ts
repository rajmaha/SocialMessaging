import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * SSE streaming proxy for the CloudPanel deployment endpoint.
 *
 * This route lives under /sse/ (NOT /api/) because next.config.js has a
 * rewrite that proxies all /api/:path* requests to the backend, which
 * would intercept this route before the App Router can handle it.
 *
 * The route pipes the backend's StreamingResponse (text/event-stream)
 * directly to the browser through a TransformStream, avoiding the
 * buffering that Next.js rewrites introduce.
 */
export async function POST(
    request: NextRequest,
    context: any
) {
    try {
        const serverId = context.params?.serverId
        // Docker: BACKEND_INTERNAL_URL=http://backend:8000 (set in docker-compose.yml)
        // Local dev: not set → fall back to localhost where the backend runs directly
        const backendUrl = process.env.BACKEND_INTERNAL_URL || 'http://localhost:8000'
        const body = await request.text()
        const authHeader = request.headers.get('Authorization') || ''

        const backendRes = await fetch(
            `${backendUrl}/cloudpanel/servers/${serverId}/sites/deploy-stream`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': authHeader,
                },
                body,
            }
        )

        // If the backend returned a non-streaming response (error, 4xx, etc.),
        // forward it as-is so the frontend can read the JSON error detail.
        if (!backendRes.body) {
            const text = await backendRes.text()
            return new NextResponse(text, {
                status: backendRes.status,
                headers: { 'Content-Type': 'application/json' },
            })
        }

        // Pipe the backend ReadableStream through a TransformStream so
        // Node.js/browser stream type compatibility is guaranteed.
        const { readable, writable } = new TransformStream()
        backendRes.body.pipeTo(writable).catch(() => {})

        return new Response(readable, {
            status: backendRes.status,
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
            },
        })
    } catch (err: any) {
        console.error('[cloudpanel-deploy-stream] Error:', err)
        return NextResponse.json(
            { error: err?.message || 'Could not connect to backend' },
            { status: 502 }
        )
    }
}
