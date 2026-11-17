export function getCadenceStatus(cadence) {
  if (!cadence || !cadence.last_contacted_at) {
    return { type: 'never', label: 'Nunca contactado', days: null }
  }

  const last = new Date(cadence.last_contacted_at)
  const next = new Date(last.getTime() + cadence.interval_days * 86400000)
  const today = new Date()

  const todayNorm = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const nextNorm = new Date(next.getFullYear(), next.getMonth(), next.getDate())

  const diff = Math.round((nextNorm - todayNorm) / 86400000)

  if (diff < 0) {
    const abs = Math.abs(diff)
    return { type: 'overdue', label: `Atrasado ${abs}d`, days: diff }
  }
  if (diff === 0) {
    return { type: 'today', label: 'Contatar hoje', days: 0 }
  }
  if (diff <= 7) {
    return { type: 'soon', label: `Em ${diff} dia${diff !== 1 ? 's' : ''}`, days: diff }
  }
  return { type: 'ok', label: `Em ${diff} dias`, days: diff }
}

export function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}
