import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

interface Flash {
  text: string
  error: boolean
}

interface ToastApi {
  notify: (text: string) => void
  fail: (text: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [flash, setFlash] = useState<Flash | null>(null)

  useEffect(() => {
    if (!flash || flash.error) return
    const id = setTimeout(() => setFlash(null), 4000)
    return () => clearTimeout(id)
  }, [flash])

  const notify = useCallback((text: string) => setFlash({ text, error: false }), [])
  const fail = useCallback((text: string) => setFlash({ text, error: true }), [])
  const api = useMemo(() => ({ notify, fail }), [notify, fail])

  return (
    <ToastContext.Provider value={api}>
      {flash && (
        <div className="flash-wrap">
          <div className={`flash ${flash.error ? 'err' : 'ok'}`} role={flash.error ? 'alert' : 'status'}>
            {flash.text}
            <button type="button" className="secondary small flash-close" onClick={() => setFlash(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}
      {children}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast outside ToastProvider')
  return ctx
}

/**
 * Run a mutation: on success refresh all cached data and flash a message, on failure flash the error.
 * Resolves to the result, or undefined if it failed.
 */
export function useRun() {
  const { notify, fail } = useToast()
  const qc = useQueryClient()
  return useCallback(
    async function run<T>(fn: () => Promise<T>, success?: string | ((result: T) => string)): Promise<T | undefined> {
      try {
        const result = await fn()
        await qc.invalidateQueries()
        if (success) notify(typeof success === 'function' ? success(result) : success)
        return result
      } catch (err) {
        fail(err instanceof Error ? err.message : 'Something went wrong')
        return undefined
      }
    },
    [qc, notify, fail],
  )
}
