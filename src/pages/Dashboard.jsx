import { getCadenceStatus, getInitials } from '../lib/cadence'
import './Dashboard.css'

export default function Dashboard({ contacts, loading, onSelectContact }) {
  if (loading) {
    return <div className="page"><div className="page-loading">Carregando...</div></div>
  }

  const withCadence = contacts.filter((c) => c.cadences?.length > 0)
  const statuses = withCadence.map((c) => ({
    contact: c,
    status: getCadenceStatus(c.cadences[0]),
  }))

  const overdue  = statuses.filter((s) => s.status.type === 'overdue')
  const today    = statuses.filter((s) => s.status.type === 'today')
  const soon     = statuses.filter((s) => s.status.type === 'soon')
  const urgent   = [...overdue, ...today]
  const upcoming = soon

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
      </div>

      <div className="stat-grid">
        <StatCard label="Contatos"       value={contacts.length} />
        <StatCard label="Atrasados"      value={overdue.length}  accent="red" />
        <StatCard label="Hoje"           value={today.length}    accent="amber" />
        <StatCard label="Esta semana"    value={soon.length}     accent="green" />
      </div>

      {urgent.length > 0 && (
        <section className="contact-section">
          <div className="section-header">
            <div className="section-dot red" />
            <h2 className="section-title">Atenção imediata</h2>
            <span className="section-count">{urgent.length}</span>
          </div>
          <div className="contact-list">
            {urgent.map(({ contact, status }) => (
              <ContactRow key={contact.id} contact={contact} status={status}
                onClick={() => onSelectContact(contact)} />
            ))}
          </div>
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="contact-section">
          <div className="section-header">
            <div className="section-dot amber" />
            <h2 className="section-title">Esta semana</h2>
            <span className="section-count">{upcoming.length}</span>
          </div>
          <div className="contact-list">
            {upcoming.map(({ contact, status }) => (
              <ContactRow key={contact.id} contact={contact} status={status}
                onClick={() => onSelectContact(contact)} />
            ))}
          </div>
        </section>
      )}

      {urgent.length === 0 && upcoming.length === 0 && (
        <div className="empty-state-block">
          {contacts.length === 0 ? (
            <>
              <div className="empty-icon">🫱🏼‍🫲🏽</div>
              <p className="empty-title">Comece adicionando contatos</p>
              <p className="empty-sub">Vá para Contatos e cadastre seus primeiros relacionamentos.</p>
            </>
          ) : (
            <>
              <div className="empty-icon">✅</div>
              <p className="empty-title">Tudo em dia!</p>
              <p className="empty-sub">Nenhum contato requer atenção no momento.</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, accent }) {
  return (
    <div className={`stat-card${accent ? ` stat-${accent}` : ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

function ContactRow({ contact, status, onClick }) {
  return (
    <div className="contact-row" onClick={onClick}>
      <div className="row-av">{getInitials(contact.name)}</div>
      <div className="row-info">
        <div className="row-name">{contact.name}</div>
        <div className="row-sub">{contact.company || contact.role || ''}</div>
      </div>
      <div className={`row-badge badge-${status.type}`}>{status.label}</div>
      <div className="row-arrow">›</div>
    </div>
  )
}
