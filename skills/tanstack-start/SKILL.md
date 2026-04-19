---
name: tanstack-start
description: Build full-stack React applications with TanStack Start. Use when creating, configuring, or working with TanStack Start projects, routing, server functions, middleware, deployment, or when the user mentions tanstack/start.
---

# TanStack Start Documentation

Full-stack React framework powered by TanStack Router and Vite. Provides SSR, streaming, server functions, API routes, middleware, and type-safe routing.

Documentation: https://tanstack.com/start/latest/docs/

## Getting Started

- [Getting Started](https://tanstack.com/start/latest/docs/framework/react/getting-started): CLI scaffolding, examples, and initial setup
- [Build from Scratch](https://tanstack.com/start/latest/docs/framework/react/build-from-scratch): Manual project setup step-by-step

## Core Concepts

- [Routing](https://tanstack.com/start/latest/docs/framework/react/guide/routing): File-based routing, route types, nested layouts
- [Execution Model](https://tanstack.com/start/latest/docs/framework/react/guide/execution-model): How code runs on client vs server
- [Code Execution Patterns](https://tanstack.com/start/latest/docs/framework/react/guide/code-execution-patterns): Common patterns for client/server code
- [Import Protection](https://tanstack.com/start/latest/docs/framework/react/guide/import-protection): Preventing server code leaks to client

## Server Features

- [Server Functions](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions): createServerFn, type-safe RPCs, input validation
- [Server Components](https://tanstack.com/start/latest/docs/framework/react/guide/server-components): React Server Components (experimental)
- [Static Server Functions](https://tanstack.com/start/latest/docs/framework/react/guide/static-server-functions): Build-time cached server functions
- [Environment Functions](https://tanstack.com/start/latest/docs/framework/react/guide/environment-functions): Environment-specific code execution
- [Server Routes](https://tanstack.com/start/latest/docs/framework/react/guide/server-routes): API routes (GET, POST, etc.)
- [Middleware](https://tanstack.com/start/latest/docs/framework/react/guide/middleware): Request and server function middleware, context passing
- [Server Entry Point](https://tanstack.com/start/latest/docs/framework/react/guide/server-entry-point): Custom server entry configuration
- [Client Entry Point](https://tanstack.com/start/latest/docs/framework/react/guide/client-entry-point): Custom client entry configuration

## Data and Loading

- [Data Loading](https://tanstack.com/start/latest/docs/framework/react/guide/data-loading): Route loaders and data fetching patterns
- [Error Boundaries](https://tanstack.com/start/latest/docs/framework/react/guide/error-boundaries): Error handling in routes
- [Hydration Errors](https://tanstack.com/start/latest/docs/framework/react/guide/hydration-errors): Debugging SSR hydration issues

## Rendering and Deployment

- [Selective SSR](https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr): Control which routes use SSR
- [SPA Mode](https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode): Single-page app mode without SSR
- [Static Prerendering](https://tanstack.com/start/latest/docs/framework/react/guide/static-prerendering): Pre-render pages at build time
- [Incremental Static Regeneration (ISR)](https://tanstack.com/start/latest/docs/framework/react/guide/isr): Revalidate static pages over time
- [Hosting](https://tanstack.com/start/latest/docs/framework/react/guide/hosting): Deploy to any provider

## Configuration and Tooling

- [Environment Variables](https://tanstack.com/start/latest/docs/framework/react/guide/environment-variables): Server vs client env vars
- [Path Aliases](https://tanstack.com/start/latest/docs/framework/react/guide/path-aliases): Configure tsconfig path aliases
- [CDN Asset URLs](https://tanstack.com/start/latest/docs/framework/react/guide/cdn-asset-urls): Serve assets from CDN
- [Tailwind CSS Integration](https://tanstack.com/start/latest/docs/framework/react/guide/tailwind-integration): Configure Tailwind CSS
- [Observability](https://tanstack.com/start/latest/docs/framework/react/guide/observability): Logging and monitoring

## Guides

- [Authentication Overview](https://tanstack.com/start/latest/docs/framework/react/guide/authentication-overview): Auth strategies overview
- [Authentication](https://tanstack.com/start/latest/docs/framework/react/guide/authentication): Implementing auth
- [Databases](https://tanstack.com/start/latest/docs/framework/react/guide/databases): Database integration patterns
- [Rendering Markdown](https://tanstack.com/start/latest/docs/framework/react/guide/rendering-markdown): Render markdown content
- [SEO](https://tanstack.com/start/latest/docs/framework/react/guide/seo): Search engine optimization
- [LLM Optimization (LLMO)](https://tanstack.com/start/latest/docs/framework/react/guide/llmo): Optimize for LLM consumption

## Examples

- [Basic](https://github.com/TanStack/router/tree/main/examples/react/start-basic)
- [Basic + React Query](https://github.com/TanStack/router/tree/main/examples/react/start-basic-react-query)
- [Basic + Clerk Auth](https://github.com/TanStack/router/tree/main/examples/react/start-clerk-basic)
- [Basic + DIY Auth](https://github.com/TanStack/router/tree/main/examples/react/start-basic-auth)
- [Basic + Supabase Auth](https://github.com/TanStack/router/tree/main/examples/react/start-supabase-basic)
- [Trellaux + Convex](https://github.com/TanStack/router/tree/main/examples/react/start-convex-trellaux)
- [Trellaux](https://github.com/TanStack/router/tree/main/examples/react/start-trellaux)
- [WorkOS](https://github.com/TanStack/router/tree/main/examples/react/start-workos)
- [Material UI](https://github.com/TanStack/router/tree/main/examples/react/start-material-ui)
- [Basic + Auth.js](https://github.com/TanStack/router/tree/main/examples/react/start-basic-authjs)
- [Basic + Static rendering](https://github.com/TanStack/router/tree/main/examples/react/start-basic-static)
- [Cloudflare Vite Plugin](https://github.com/TanStack/router/tree/main/examples/react/start-basic-cloudflare)

## Key Packages

- `@tanstack/react-start` - Core framework package
- `@tanstack/react-router` - Type-safe router (required)
- `@tanstack/zod-adapter` - Zod validation adapter for middleware/server functions

---

## Operational Patterns

### Project Structure

```
myApp/
  src/
    routes/
      __root.tsx        # Root layout (required, wraps all routes)
      index.tsx         # / route
      about.tsx         # /about route
      posts/
        index.tsx       # /posts route
        $postId.tsx     # /posts/:postId dynamic route
    router.tsx          # Router configuration
    routeTree.gen.ts    # Auto-generated (do not edit)
  vite.config.ts
  package.json
  tsconfig.json
```

### Router Configuration

```tsx
// src/router.tsx
import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
  })
  return router
}
```

### Root Route (Required)

```tsx
// src/routes/__root.tsx
import type { ReactNode } from 'react'
import { Outlet, createRootRoute, HeadContent, Scripts } from '@tanstack/react-router'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'My App' },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
```

### Creating Routes

```tsx
// src/routes/posts/$postId.tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/posts/$postId')({
  component: PostComponent,
  loader: ({ params }) => fetchPost(params.postId),
})

function PostComponent() {
  const post = Route.useLoaderData()
  return <div>{post.title}</div>
}
```

### Route File Naming Conventions

| Path | Filename | Type |
|------|----------|------|
| `/` | `index.tsx` | Index route |
| `/about` | `about.tsx` | Static route |
| `/posts/` | `posts/index.tsx` | Nested index route |
| `/posts/:id` | `posts/$postId.tsx` | Dynamic route |
| `/rest/*` | `rest/$.tsx` | Splat/wildcard route |

### Server Functions

```tsx
import { createServerFn } from '@tanstack/react-start'

// No-input server function (GET is default)
export const getServerTime = createServerFn().handler(async () => {
  return new Date().toISOString()
})

// GET with input validation
export const getPost = createServerFn({ method: 'GET' })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    return db.query.posts.findFirst({ where: eq(posts.id, data.id) })
  })

// POST with input validation
export const createPost = createServerFn({ method: 'POST' })
  .inputValidator((data: { title: string; body: string }) => data)
  .handler(async ({ data }) => {
    return db.insert(posts).values(data)
  })

// Call with no input: fn()
const time = await getServerTime()

// Call with input: fn({ data: { ... } })
const post = await getPost({ data: { id: '123' } })
await createPost({ data: { title: 'New', body: '...' } })
```

### Calling Server Functions

```tsx
// In a route loader
export const Route = createFileRoute('/posts')({
  loader: () => getServerPosts(),
})

// In a component - direct call
function Post() {
  const router = useRouter()
  return (
    <button onClick={() => createPost({ data: { title: 'New', body: '...' } }).then(() => router.invalidate())}>
      Create
    </button>
  )
}

// In a component - useServerFn hook (for use with React Query, etc.)
import { useServerFn } from '@tanstack/react-start'

function PostList() {
  const getPosts = useServerFn(getServerPosts)

  const { data } = useQuery({
    queryKey: ['posts'],
    queryFn: () => getPosts(),
  })
}
```

### Server Function Organization

```
src/utils/
  users.functions.ts   # createServerFn wrappers (safe to import anywhere)
  users.server.ts      # Server-only helpers (DB queries, internal logic)
  schemas.ts           # Shared validation schemas (client-safe)
```

```tsx
// users.server.ts - server-only
import { db } from '~/db'
export async function findUserById(id: string) {
  return db.query.users.findFirst({ where: eq(users.id, id) })
}

// users.functions.ts - safe to import anywhere
import { createServerFn } from '@tanstack/react-start'
import { findUserById } from './users.server'

export const getUser = createServerFn({ method: 'GET' })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => findUserById(data.id))
```

### Request Middleware

```tsx
import { createMiddleware } from '@tanstack/react-start'

const loggingMiddleware = createMiddleware().server(async ({ next, context, request }) => {
  console.log('Request:', request.url)
  const result = await next()
  return result
})
```

### Server Function Middleware

```tsx
import { createMiddleware } from '@tanstack/react-start'

const authMiddleware = createMiddleware({ type: 'function' })
  .client(async ({ next }) => {
    // Runs on client before RPC
    return next({
      sendContext: { token: getToken() },
    })
  })
  .server(async ({ next, context }) => {
    // Runs on server
    if (!context.token) throw new Error('Unauthorized')
    return next()
  })

// Apply to a server function
export const getSecret = createServerFn()
  .middleware([authMiddleware])
  .handler(async () => 'secret data')
```

### Global Middleware

```tsx
// src/start.ts (create this file)
import { createStart, createMiddleware } from '@tanstack/react-start'

const globalAuthMiddleware = createMiddleware().server(async ({ next }) => {
  // Runs for every request
  return next()
})

export const startInstance = createStart(() => ({
  requestMiddleware: [globalAuthMiddleware],      // All server requests
  functionMiddleware: [someOtherMiddleware],       // All server functions
}))
```

### Vite Configuration

```tsx
// vite.config.ts
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'

export default defineConfig({
  server: { port: 3000 },
  resolve: { tsconfigPaths: true },
  plugins: [
    tanstackStart(),
    viteReact(), // Must come AFTER tanstackStart
  ],
})
```

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "moduleResolution": "Bundler",
    "module": "ESNext",
    "target": "ES2022",
    "skipLibCheck": true,
    "strictNullChecks": true
  }
}
```

Note: Avoid `verbatimModuleSyntax` as it can leak server bundles into client bundles.

### Deployment: Cloudflare Workers

```bash
pnpm add -D @cloudflare/vite-plugin wrangler
```

```tsx
// vite.config.ts
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import viteReact from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tanstackStart(),
    viteReact(),
  ],
})
```

```jsonc
// wrangler.jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "tanstack-start-app",
  "compatibility_date": "2025-09-02",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@tanstack/react-start/server-entry"
}
```

### Deployment: Netlify

```bash
pnpm add -D @netlify/vite-plugin-tanstack-start
```

```tsx
// vite.config.ts
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import netlify from '@netlify/vite-plugin-tanstack-start'
import viteReact from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [tanstackStart(), netlify(), viteReact()],
})
```

### Deployment: Nitro (Vercel, Node, Bun, etc.)

```bash
npm install nitro
```

```tsx
// vite.config.ts
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [tanstackStart(), nitro(), viteReact()],
})
```

For Node.js deployment:
```json
{
  "scripts": {
    "build": "vite build",
    "start": "node .output/server/index.mjs"
  }
}
```

### Zod Validation with Server Functions

```tsx
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const UserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
})

export const createUser = createServerFn({ method: 'POST' })
  .inputValidator(UserSchema)
  .handler(async ({ data }) => {
    // data is fully typed and validated
    return db.insert(users).values(data)
  })
```

### Server Function with FormData

```tsx
export const submitForm = createServerFn({ method: 'POST' })
  .inputValidator((data) => {
    if (!(data instanceof FormData)) {
      throw new Error('Expected FormData')
    }
    return {
      name: data.get('name')?.toString() || '',
      email: data.get('email')?.toString() || '',
    }
  })
  .handler(async ({ data }) => {
    return { success: true, name: data.name }
  })
```

### Server Context Utilities

Import from `@tanstack/react-start/server`:

```tsx
import {
  getRequest,          // Access the full Request object
  getRequestHeader,    // getRequestHeader('Authorization')
  setResponseHeader,   // setResponseHeader('Cache-Control', 'max-age=300')
  setResponseHeaders,  // setResponseHeaders(new Headers({ ... }))
  setResponseStatus,   // setResponseStatus(200)
} from '@tanstack/react-start/server'
```

Example usage:

```tsx
import { createServerFn } from '@tanstack/react-start'
import {
  getRequest,
  getRequestHeader,
  setResponseHeaders,
  setResponseStatus,
} from '@tanstack/react-start/server'

export const getCachedData = createServerFn({ method: 'GET' }).handler(async () => {
  const request = getRequest()
  const authHeader = getRequestHeader('Authorization')

  setResponseHeaders(new Headers({
    'Cache-Control': 'public, max-age=300',
    'CDN-Cache-Control': 'max-age=3600, stale-while-revalidate=600',
  }))

  setResponseStatus(200)

  return fetchData()
})
```

### Error Handling in Server Functions

Errors, redirects, and not-found responses are serialized to the client automatically.

```tsx
import { createServerFn } from '@tanstack/react-start'
import { redirect, notFound } from '@tanstack/react-router'

// Basic error
export const riskyFunction = createServerFn().handler(async () => {
  throw new Error('Something went wrong!')
})

// Errors serialize to client
try {
  await riskyFunction()
} catch (error) {
  console.log(error.message) // "Something went wrong!"
}

// Redirect
export const requireAuth = createServerFn().handler(async () => {
  const user = await getCurrentUser()
  if (!user) {
    throw redirect({ to: '/login' })
  }
  return user
})

// Not found
export const getPost = createServerFn()
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const post = await db.findPost(data.id)
    if (!post) {
      throw notFound()
    }
    return post
  })
```

### Server Routes (API Routes)

```tsx
// src/routes/api/posts.ts
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/posts')({
  server: {
    handlers: {
      GET: async () => {
        const posts = await db.query.posts.findMany()
        return Response.json(posts)
      },
      POST: async ({ request }) => {
        const body = await request.json()
        const post = await db.insert(posts).values(body)
        return Response.json(post, { status: 201 })
      },
    },
  },
})
```

### Common Package Manager Commands

```bash
# Create new project
npx @tanstack/cli@latest create

# Clone an example
npx gitpick TanStack/router/tree/main/examples/react/start-basic start-basic

# Install dependencies
npm i @tanstack/react-start @tanstack/react-router react react-dom
npm i -D vite @vitejs/plugin-react typescript @types/react @types/react-dom @types/node

# Dev / Build
npm run dev    # vite dev
npm run build  # vite build
```
