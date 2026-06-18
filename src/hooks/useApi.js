import { useState, useEffect, useCallback, useRef } from 'react'

// Run an async function on mount (and when deps change). Returns data, loading,
// error and a reload() for manual refresh — gives every screen consistent
// loading / empty / error states.
export function useApi(fn, deps = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fnRef.current()
      setData(result)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    run()
  }, [run])

  return { data, loading, error, reload: run, setData }
}
