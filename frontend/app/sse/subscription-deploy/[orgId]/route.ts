import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * SSE streaming proxy for "new subscription -> deploy site".
 *
 * Same reason as /sse/cloudpanel-deploy: a next.config.js rewrite buffers the
 * whole response before forwarding it, so every deployment step would reach the
 * browser at once, at the end. This route pipes the backend stream straight
 * through. The request is multipart (it can carry the company logo), so the body
 * and its Content-Type (with the boundary) are forwarded untouched.
 */
export async function POST(request: NextRequest, context: any) {
    try {
        const { orgId } = await context.params
        if (!orgId || !/^\d+$/.test(orgId)) {
            return NextResponse.json({ detail: `Invalid organization id: ${orgId}` }, { status: 400 })
        }

        const backendUrl = process.env.BACKEND_INTERNAL_URL || 'http://localhost:8000'
        const headers: Record<string, string> = {
            'Authorization': request.headers.get('Authorization') || '',
        }
        const contentType = request.headers.get('Content-Type')
        if (contentType) headers['Content-Type'] = contentType

        // The form is small (the logo is capped at 200KB), so send it as one buffer
        // with a Content-Length rather than as a chunked, streamed upload.
        const body = await request.arrayBuffer()

        const backendRes = await fetch(
            `${backendUrl}/organizations/${orgId}/subscriptions/deploy-and-create`,
            {
                method: 'POST',
                headers,
                body,
            }
        )

        const isStream = (backendRes.headers.get('Content-Type') || '').includes('text/event-stream')
        if (!backendRes.body || !isStream) {
            // An error answer (4xx, validation): hand it to the page as-is.
            const text = await backendRes.text()
            return new NextResponse(text, {
                status: backendRes.status,
                headers: { 'Content-Type': backendRes.headers.get('Content-Type') || 'application/json' },
            })
        }

        const { readable, writable } = new TransformStream()
        backendRes.body.pipeTo(writable).catch(() => {})

        return new Response(readable, {
            status: backendRes.status,
            headers: {
                'Content-Type': 'text/event-stream',
                // no-transform keeps Next's response compression from holding the stream back
                'Cache-Control': 'no-cache, no-transform',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
            },
        })
    } catch (err: any) {
        console.error('[subscription-deploy-stream] Error:', err)
        return NextResponse.json(
            { detail: err?.message || 'Could not connect to backend' },
            { status: 502 }
        )
    }
}
