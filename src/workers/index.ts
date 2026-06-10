import script from '../develop/idempotent.sh'

const SCRIPT_PATHS = new Set(['/', '/develop', '/develop/idempotent.sh'])

export default {
  fetch(request: Request) {
    const { pathname } = new URL(request.url)

    if (!SCRIPT_PATHS.has(pathname)) {
      return new Response('Not Found', { status: 404 })
    }

    return new Response(script, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    })
  },
} satisfies ExportedHandler
