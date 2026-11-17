import { getCadenceStatus, getInitials } from '../lib/cadence'
import './Cadences.css'

export default function Cadences({ contacts, loading, onSelectContact }) {
  if (loading) {
    return <div className="page"><div className="page-loading">Carregando...</div></div>
  }

  const withCadence = contacts.filter((c) => c.cadences?.length > 0)
  const withStatus = withCadence.map((c) => ({
    contact: c,
    cadence: c.cadences[0],
    status: getCadenceStatus(c.cadences[0]),
  }))

  const overdue  = withStatus.filter((s) => s.status.type === 'overdue')
    .sort((a, b) => a.status.days - b.status.days)   // most overdue first (most negative)
  const thisWeek = withStatus.filter((s) => s.status.type === 'today' || s.status.type === 'soon')
    .sort((a, b) => a.status.days - b.status.days)
  const onTrack  = withStatus.filter((s) => s.status.type === 'ok')
    .sort((a, b) => a.status.days - b.status.days)

  const noCadence = contacts.filter((c) => !c.cadences?.length)

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Cadências</h1>
        <span className="cadences-hint">{withCadence.length} contatos com cadência ativa</span>
      </div>

      <div className="kanban">
        <KanbanCol
          title="Atrasado"
          count={overdue.length}
          accent="red"
          items={overdue}
          onSelect={onSelectContact}
          emptyMsg="Nenhum contato atrasado 🎉"
        />
        <KanbanCol
          title="Esta semana"
          count={thisWeek.length}
          accent="amber"
          items={thisWeek}
          onSelect={onSelectContact}
          emptyMsg="Nenhum contato para esta semana"
        />
        <KanbanCol
          title="Em dia"
          count={onTrack.length}
          accent="green"
          items={onTrack}
          onSelect={onSelectContact}
          emptyMsg="Nenhum contato em dia ainda"
        />
      </div>

      {noCadence.length > 0 && (
        <div className="no-cadence-section">
          <p className="no-cadence-label">Sem cadência configurada ({noCadence.length})</p>
          <div className="no-cadence-list">
            {noCadence.map((c) => (
              <button key={c.id} className="no-cadence-chip" onClick={() => onSelectContact(c)}>
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function KanbanCol({ title, count, accent, items, onSelect, emptyMsg }) {
  return (
    <div className={`kanban-col kanban-${accent}`}>
      <div className="kanban-header">
        <span className="kanban-title">{title}</span>
        <span className="kanban-count">{count}</span>
      </div>
      <div className="kanban-cards">
        {items.length === 0 ? (
          <div className="kanban-empty">{emptyMsg}</div>
        ) : (
          items.map(({ contact, status }) => (
            <KanbanCard key={contact.id} contact={contact} status={status}
              onClick={() => onSelect(contact)} />
          ))
        )}
      </div>
    </div>
  )
}

function KanbanCard({ contact, status, onClick }) {
  const days = status.days
  let dLabel = ''
  if (days < 0)      dLabel = `D${days}`       // e.g. D-3
  else if (days === 0) dLabel = 'D+0'
  else                dLabel = `D+${days}`

  return (
    <div className="kanban-card" onClick={onClick}>
      <div className="k-av">{getInitials(contact.name)}</div>
      <div className="k-info">
        <div className="k-name">{contact.name}</div>
        {(contact.role || contact.company) && (
          <div className="k-sub">{[contact.role, contact.company].filter(Boolean).join(' · ')}</div>
        )}
      </div>
      <div className={`k-days type-${status.type}`}>{dLabel}</div>
    </div>
  )
}
