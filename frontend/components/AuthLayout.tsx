'use client'

/**
 * Shell for the signed-out pages (sign in, forgot password, reset password).
 *
 * These are the first screen anyone sees, and in the mobile app they are the
 * first screen *of the app*, so they carry the branding and have to sit
 * correctly inside the notch and the home indicator. Everything layout-ish
 * lives here so the individual pages are just their form.
 */

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { FiEye, FiEyeOff } from 'react-icons/fi'
import { useBranding } from '@/lib/branding-context'

interface AuthLayoutProps {
  /** Page heading inside the card, e.g. "Reset password". */
  title: string
  /** One line under the heading explaining what this screen is for. */
  subtitle?: ReactNode
  children: ReactNode
  /** Secondary action under the card, on the gradient. */
  footer?: ReactNode
}

export default function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  const { branding, loading } = useBranding()

  const primary = branding?.primary_color || '#2563eb'
  const secondary = branding?.secondary_color || '#1e40af'

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen px-5"
      style={{
        // dvh keeps the card centred when mobile browser chrome shows/hides;
        // min-h-screen above is the fallback for browsers without dvh.
        minHeight: '100dvh',
        background: `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)`,
        // In the packaged app the page runs edge-to-edge under the status bar
        // and the home indicator (see lib/native.ts), so keep clear of both.
        paddingTop: 'calc(var(--sa-top, 0px) + 2rem)',
        paddingBottom: 'calc(var(--sa-bottom, 0px) + 2rem)',
      }}
    >
      <div className="w-full max-w-[400px]">
        {/* Brand, above the card — this is the app's front door. */}
        <div className="text-center mb-7">
          {branding?.logo_url ? (
            <img
              src={branding.logo_url}
              alt=""
              className="h-14 w-auto mx-auto mb-3 object-contain drop-shadow-sm"
            />
          ) : null}
          {/* While branding is in flight the slot is held open but empty: on a
              white-labelled product, flashing a fallback name on the front
              door and then swapping it looks broken. min-h matches text-xl's
              line box so nothing jumps when the real name lands. */}
          <div className="text-white text-xl font-semibold tracking-tight min-h-[1.75rem]">
            {loading ? '' : branding?.company_name || 'Workspace'}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl px-6 py-7 sm:px-8">
          <h1 className="text-[22px] leading-tight font-semibold text-gray-900 text-center">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 text-sm text-gray-500 text-center leading-relaxed">
              {subtitle}
            </p>
          )}

          <div className="mt-6">{children}</div>
        </div>

        {footer && (
          <div className="mt-6 text-center text-sm text-white/90">{footer}</div>
        )}
      </div>
    </div>
  )
}

/**
 * The form controls these pages share. They are here rather than in each page
 * so the three screens cannot drift apart, and so the 44px minimum touch
 * target is stated once.
 */

export function AuthLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 mb-1.5">
      {children}
    </label>
  )
}

export function AuthInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { branding } = useBranding()
  const primary = branding?.primary_color || '#2563eb'

  return (
    <input
      {...props}
      className={
        'w-full h-12 px-4 text-[15px] rounded-xl border border-gray-300 bg-white ' +
        'placeholder:text-gray-400 transition ' +
        'focus:outline-none focus:ring-2 focus:border-transparent ' +
        'disabled:bg-gray-50 disabled:text-gray-500 ' +
        (props.className || '')
      }
      // Tailwind's ring colour is a CSS variable, so the brand colour can be
      // fed straight in; the old code set a non-existent `focusRingColor`.
      style={{ ['--tw-ring-color' as any]: primary, ...props.style }}
    />
  )
}

/**
 * Password field with a show/hide toggle.
 *
 * Worth the extra control: on a phone every character is a dot, so a typo in
 * a *new* password only surfaces as "passwords do not match" two fields
 * later. The toggle is a real button so it is reachable by keyboard, and it
 * sits outside the tab order of the form's happy path.
 */
export function AuthPasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [shown, setShown] = useState(false)

  return (
    <div className="relative">
      <AuthInput
        {...props}
        type={shown ? 'text' : 'password'}
        className={`pr-12 ${props.className || ''}`}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        // Not a form control, so keep it out of the tab run between fields.
        tabIndex={-1}
        aria-label={shown ? 'Hide password' : 'Show password'}
        className="absolute right-0 top-0 h-12 w-12 flex items-center justify-center text-gray-400 hover:text-gray-600 disabled:opacity-40"
        disabled={props.disabled}
      >
        {shown ? <FiEyeOff size={18} /> : <FiEye size={18} />}
      </button>
    </div>
  )
}

const BUTTON_BASE =
  'w-full h-12 rounded-xl font-semibold text-[15px] transition ' +
  'disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.99]'

/**
 * A navigation action that looks like the primary button.
 *
 * Separate from AuthButton because a <button> inside an <a> is invalid HTML:
 * browsers tolerate it, but it breaks keyboard activation and screen readers
 * announce it twice.
 */
export function AuthLinkButton({
  href,
  children,
  variant = 'primary',
}: {
  href: string
  children: ReactNode
  variant?: 'primary' | 'secondary'
}) {
  const { branding } = useBranding()
  const primary = branding?.primary_color || '#2563eb'
  const base = `${BUTTON_BASE} flex items-center justify-center`

  if (variant === 'secondary') {
    return (
      <Link href={href} className={`${base} bg-gray-100 text-gray-700 hover:bg-gray-200`}>
        {children}
      </Link>
    )
  }
  return (
    <Link href={href} className={`${base} text-white hover:opacity-90`} style={{ backgroundColor: primary }}>
      {children}
    </Link>
  )
}

export function AuthButton({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  const { branding } = useBranding()
  const primary = branding?.primary_color || '#2563eb'

  const base = BUTTON_BASE

  if (variant === 'secondary') {
    return (
      <button {...props} className={`${base} bg-gray-100 text-gray-700 hover:bg-gray-200`}>
        {children}
      </button>
    )
  }

  return (
    <button
      {...props}
      className={`${base} text-white hover:opacity-90`}
      style={{ backgroundColor: primary, ...props.style }}
    >
      {children}
    </button>
  )
}

/** Inline error / success banner, same shape on every auth screen. */
export function AuthNotice({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  const styles =
    tone === 'error'
      ? 'bg-red-50 border-red-200 text-red-700'
      : 'bg-green-50 border-green-200 text-green-800'

  return (
    <div className={`mb-4 px-4 py-3 rounded-xl border text-sm leading-relaxed ${styles}`} role="alert">
      {children}
    </div>
  )
}
