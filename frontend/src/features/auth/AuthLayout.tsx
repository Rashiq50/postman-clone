import type { ReactNode } from 'react'
import { ThemeMenu } from '../theme/ThemeMenu'
import { BrandMark } from './AuthArt'

/**
 * The shared chrome behind `/login` and `/register`.
 *
 * ⚠️ **It exists so the two pages cannot drift.** `RegisterPage` is required to
 * mirror `LoginPage` (see *Frontend auth rules*), and every past divergence
 * between them started as a change made to one screen's markup. Everything
 * outside the field list — the split, the brand panel, the card, the heading
 * block, the footer link, the theme control — now lives here once, so a visual
 * change lands on both by construction rather than by review.
 *
 * ⚠️ **Every colour is a semantic token**, including the panel's accents and
 * the sample-request preview's method chips. `yarn contrast` audits
 * `method-* on surface` and `accent-soft-fg on accent-soft` already, so this
 * screen needed no new token and no new `PAIRS` entry. A palette utility here
 * (`bg-indigo-600`, `text-slate-500`) would pin the sign-in page — the first
 * thing anyone sees — to light mode forever.
 */
interface AuthLayoutProps {
  /** The `<h1>`. */
  title: string
  /** One line under the title, describing what the form does. */
  subtitle: string
  /** The form itself. */
  children: ReactNode
  /** The "already have an account?" line, rendered under the card. */
  footer: ReactNode
}

/**
 * The left panel's sample request.
 *
 * It is not decoration for its own sake: an unauthenticated visitor has seen
 * nothing of the product, and a static picture of the thing they are signing in
 * to do says more than a paragraph would. It is built from the same method
 * tokens the sidebar uses, so it re-themes with everything else.
 */
function RequestPreview() {
  return (
    <div className="w-full max-w-sm rounded-xl border border-line bg-surface/80 p-3 shadow-sm glass">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold tracking-wide text-method-get">
          GET
        </span>
        <span className="truncate font-mono text-xs text-fg-muted">
          {'{{baseUrl}}'}/v1/users
        </span>
      </div>

      <div className="mt-3 space-y-1.5 border-t border-line-subtle pt-3">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-fg-subtle">Status</span>
          <span className="rounded-full bg-success-soft px-2 py-0.5 font-medium text-success-soft-fg">
            200 OK
          </span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-fg-subtle">Time</span>
          <span className="font-mono text-fg-muted">128 ms</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-fg-subtle">Size</span>
          <span className="font-mono text-fg-muted">2.4 kB</span>
        </div>
      </div>

      <div className="mt-3 flex gap-1.5">
        {(
          [
            ['POST', 'text-method-post'],
            ['PUT', 'text-method-put'],
            ['PATCH', 'text-method-patch'],
            ['DELETE', 'text-method-delete'],
          ] as const
        ).map(([method, tone]) => (
          <span
            key={method}
            className={`rounded border border-line-subtle px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${tone}`}
          >
            {method}
          </span>
        ))}
      </div>
    </div>
  )
}

const POINTS = [
  'Organise requests into collections and folders',
  'Swap environments without touching a URL',
  'Send, inspect the response, and keep the history',
]

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: AuthLayoutProps) {
  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/*
        The brand panel is `lg:` only. On a phone it would push the form below
        the fold, and the form is the entire reason anyone is on this screen.
      */}
      <aside className="hidden border-r border-line glass-tint lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="flex items-center gap-2.5 text-accent">
          <BrandMark />
          <span className="text-base font-semibold tracking-tight text-fg">
            Raven
          </span>
        </div>

        <div className="max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-fg">
            An API workbench,
            <br />
            without the account wall.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-fg-subtle">
            Build a request, point it at an environment, and send it. Everything
            stays in your workspace.
          </p>

          <ul className="mt-6 space-y-2.5">
            {POINTS.map((point) => (
              <li
                key={point}
                className="flex items-start gap-2.5 text-sm text-fg-muted"
              >
                <span
                  aria-hidden
                  className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[10px] font-bold text-accent-soft-fg"
                >
                  ✓
                </span>
                {point}
              </li>
            ))}
          </ul>

          <div className="mt-8">
            <RequestPreview />
          </div>
        </div>

        <p className="text-xs text-fg-faint">
          A learning build — treat stored credentials as plaintext.
        </p>
      </aside>

      <main className="relative flex min-h-screen items-center justify-center px-4 py-12 lg:min-h-0">
        {/*
          The theme control is reachable from every screen, not just the ones
          behind the header. A preference set on a machine and then hidden
          until sign-in is the same as not having one.
        */}
        <div className="absolute right-4 top-4">
          <ThemeMenu />
        </div>

        <div className="w-full max-w-sm">
          {/* The mark repeats here for the narrow layout, where the panel is gone. */}
          <div className="mb-6 flex items-center gap-2.5 text-accent lg:hidden">
            <BrandMark className="size-8" />
            <span className="text-sm font-semibold tracking-tight text-fg">
              Raven
            </span>
          </div>

          <header className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">
              {title}
            </h1>
            <p className="mt-1 text-sm text-fg-subtle">{subtitle}</p>
          </header>

          {children}

          <p className="mt-5 text-center text-sm text-fg-subtle">{footer}</p>
        </div>
      </main>
    </div>
  )
}
