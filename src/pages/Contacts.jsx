import { useState } from 'react'
import { getCadenceStatus, getInitials } from '../lib/cadence'
import './Contacts.css'

export default function Contacts({ contacts, loading, onSelectContact, onAdd: onNewContact }) {
  const [search, setSearch] = useState('')

  const filtered = contacts.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.company || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.role || '').toLowerCase().includes(search.toLowerCase())
  )

  if (loading) {
    return <div className="page"><div className="page-loading">Carregando...</div></div>
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Contatos</h1>
        <button className="btn-primary" onClick={onNewContact}>
          + Novo contato
        </button>
      </div>

      <div className="search-bar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          type="text"
          placeholder="Buscar por nome, empresa ou cargo..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="search-clear" onClick={() => setSearch('')}>✕</button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state-block">
          {contacts.length === 0 ? (
            <>
              <div className="empty-icon">🤝</div>
              <p className="empty-title">Nenhum contato ainda</p>
              <p className="empty-sub">Adicione seu primeiro contato para começar a cultivar relacionamentos.</p>
              <button className="btn-primary" style={{ marginTop: 16 }} onClick={onNewContact}>
                + Adicionar primeiro contato
              </button>
            </>
          ) : (
            <>
              <div className="empty-icon">🔍</div>
              <p className="empty-title">Nenhum resultado</p>
              <p className="empty-sub">Nenhum contato encontrado para "{search}".</p>
            </>
          )}
        </div>
      ) : (
        <div className="contacts-grid">
          {filtered.map((contact) => (
            <ContactCard key={contact.id} contact={contact} onClick={() => onSelectContact(contact)} />
          ))}
        </div>
      )}
    </div>
  )
}

function ContactCard({ contact, onClick }) {
  const cadence = contact.cadences?.[0]
  const status = cadence ? getCadenceStatus(cadence) : null
  const history = contact.contact_history || []
  const lastContact = history.length > 0
    ? new Date(history.sort((a, b) => new Date(b.contacted_at) - new Date(a.contacted_at))[0].contacted_at)
    : null

  return (
    <div className="contact-card" onClick={onClick}>
      <div className="card-av">{getInitials(contact.name)}</div>
      <div className="card-body">
        <div className="card-name">{contact.name}</div>
        {(contact.role || contact.company) && (
          <div className="card-sub">
            {[contact.role, contact.company].filter(Boolean).join(' · ')}
          </div>
        )}
        {status && (
          <div className={`card-badge badge-${status.type}`}>{status.label}</div>
        )}
      </div>
      {lastContact && (
        <div className="card-last">
          <span className="card-last-label">Último contato</span>
          <span className="card-last-date">
            {lastContact.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
          </span>
        </div>
      )}
    </div>
  )
}
