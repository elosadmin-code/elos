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

  function handleWhatsApp(e) {
    e.stopPropagation()
    const phone = contact.whatsapp?.replace(/\D/g, '')
    if (phone) window.open(`https://wa.me/${phone}`, '_blank')
  }

  return (
    <div className="contact-card" onClick={onClick}>
      <div className="card-av">{getInitials(contact.name)}</div>
      <div className="card-body">
        <div className="card-name">{contact.name}</div>
        {(contact.role || contact.company) && (
          <div className="card-sub">
            {contact.role && <div className="card-role">{contact.role}</div>}
            {contact.company && <div className="card-company">{contact.company}</div>}
          </div>
        )}
        {status && (
          <div className={`card-badge badge-${status.type}`}>{status.label}</div>
        )}
      </div>
      <div className="card-actions">
        {contact.whatsapp && (
          <button className="card-wa-btn" onClick={handleWhatsApp} title="Abrir no WhatsApp">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
          </button>
        )}
        {lastContact && (
          <div className="card-last">
            <span className="card-last-label">Último</span>
            <span className="card-last-date">
              {lastContact.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
