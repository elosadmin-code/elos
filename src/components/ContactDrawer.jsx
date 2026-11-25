import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getCadenceStatus, getInitials, formatDate } from '../lib/cadence'
import './ContactDrawer.css'

const INTERVAL_OPTIONS = [
  { value: 3,  label: '3 dias — Contato ativo' },
  { value: 7,  label: '7 dias — Semanal' },
  { value: 14, label: '14 dias — Quinzenal' },
  { value: 21, label: '21 dias — 3 semanas' },
  { value: 30, label: '30 dias — Mensal' },
  { value: 45, label: '45 dias — 6 semanas' },
  { value: 60, label: '60 dias — Bimestral' },
  { value: 90, label: '90 dias — Trimestral' },
]

const emptyForm = { name: '', company: '', role: '', whatsapp: '', notes: '', tags: '', interval_days: 30 }

export default function ContactDrawer({ contact, onClose, onRefresh, userId }) {
  const [tab, setTab] = useState('perfil')
  const [history, setHistory] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [contateiLoading, setContateiLoading] = useState(false)
  const [contateiNote, setContateiNote] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isOpen = contact !== null
  const isNew = contact?.isNew === true

  useEffect(() => {
    if (!contact) return
    if (isNew) {
      setForm(emptyForm)
      setTab('perfil')
    } else {
      setTab('perfil')
      loadHistory(contact.id)
    }
    setContateiNote('')
    setIsEditing(false)
    setConfirmDelete(false)
  }, [contact])

  async function loadHistory(contactId) {
    const { data } = await supabase
      .from('contact_history')
      .select('*')
      .eq('contact_id', contactId)
      .order('contacted_at', { ascending: false })
    setHistory(data || [])
  }

  async function handleContatei() {
    if (!contact?.id) return
    setContateiLoading(true)
    const now = new Date().toISOString()
    try {
      await supabase.from('contact_history').insert({
        contact_id: contact.id,
        user_id: userId,
        contacted_at: now,
        channel: 'whatsapp',
        notes: contateiNote.trim(),
      })
      const cadence = contact.cadences?.[0]
      if (cadence) {
        await supabase.from('cadences')
          .update({ last_contacted_at: now })
          .eq('id', cadence.id)
      }
      await onRefresh()
    } finally {
      setContateiLoading(false)
      onClose()
    }
  }

  async function handleSave(e) {
    e && e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const { data: newContact, error } = await supabase
        .from('contacts')
        .insert({
          user_id: userId,
          name: form.name.trim(),
          company: form.company.trim(),
          role: form.role.trim(),
          whatsapp: form.whatsapp.trim(),
          notes: form.notes.trim(),
          tags: form.tags?.trim() || '',
        })
        .select()
        .single()

      if (error) {
        console.error('Erro ao salvar contato:', error)
        alert('Erro ao salvar: ' + error.message)
        return
      }

      if (newContact) {
        const { error: cadErr } = await supabase.from('cadences').insert({
          contact_id: newContact.id,
          user_id: userId,
          interval_days: form.interval_days,
        })
        if (cadErr) console.error('Erro na cadência:', cadErr)
      }

      await onRefresh()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate(e) {
    e.preventDefault()
    if (!editForm.name?.trim()) return
    setSaving(true)
    try {
      const { error } = await supabase.from('contacts').update({
        name: editForm.name.trim(),
        company: editForm.company?.trim() || '',
        role: editForm.role?.trim() || '',
        whatsapp: editForm.whatsapp?.trim() || '',
        notes: editForm.notes?.trim() || '',
        tags: editForm.tags?.trim() || '',
      }).eq('id', contact.id)
      if (error) { alert('Erro ao salvar: ' + error.message); return }
      const existingCadence = contact.cadences?.[0]
      if (existingCadence) {
        await supabase.from('cadences').update({ interval_days: editForm.interval_days }).eq('id', existingCadence.id)
      } else {
        await supabase.from('cadences').insert({ contact_id: contact.id, user_id: userId, interval_days: editForm.interval_days })
      }
      setIsEditing(false)
      await onRefresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await supabase.from('contact_history').delete().eq('contact_id', contact.id)
      await supabase.from('cadences').delete().eq('contact_id', contact.id)
      const { error } = await supabase.from('contacts').delete().eq('id', contact.id)
      if (error) { alert('Erro ao excluir: ' + error.message); return }
      await onRefresh()
      onClose()
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  function handleWhatsApp() {
    const phone = contact?.whatsapp?.replace(/\D/g, '')
    if (!phone) return
    window.open(`https://wa.me/${phone}`, '_blank')
  }

  const cadence = !isNew ? contact?.cadences?.[0] : null
  const status = cadence ? getCadenceStatus(cadence) : null

  return (
    <>
      <div className={`drawer-overlay${isOpen ? ' open' : ''}`} onClick={onClose} />
      <aside className={`contact-drawer${isOpen ? ' open' : ''}`}>

        {/* Header */}
        <div className="drawer-header">
          <div className="drawer-header-info">
            {!isNew ? (
              <>
                <div className="drawer-av">{getInitials(contact?.name || '')}</div>
                <div>
                  <div className="drawer-contact-name">{contact?.name}</div>
                  <div className="drawer-contact-sub">{[contact?.role, contact?.company].filter(Boolean).join(' · ')}</div>
                </div>
              </>
            ) : (
              <div className="drawer-contact-name">Novo contato</div>
            )}
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Fechar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Tabs */}
        {!isNew && (
          <div className="drawer-tabs">
            {[
              { id: 'perfil', label: 'Perfil' },
              { id: 'historico', label: 'Histórico' },
              { id: 'cadencia', label: 'Cadência' },
            ].map((t) => (
              <button
                key={t.id}
                className={`drawer-tab${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="drawer-body">

          {/* ── Perfil (existing contact — view mode) ── */}
          {tab === 'perfil' && !isNew && !isEditing && (
            <div className="perfil-section">
              {(contact?.company || contact?.role || contact?.whatsapp || contact?.notes) ? (
                <div className="info-list">
                  {contact?.company && <InfoRow label="Empresa" value={contact.company} />}
                  {contact?.role && <InfoRow label="Cargo" value={contact.role} />}
                  {contact?.whatsapp && <InfoRow label="WhatsApp" value={contact.whatsapp} />}
                  {contact?.notes && <InfoRow label="Notas" value={contact.notes} />}
                  {contact?.tags && <InfoRow label="Tags" value={contact.tags} />}
                </div>
              ) : (
                <p className="empty-hint">Nenhuma informação adicional.</p>
              )}
              <div className="perfil-actions">
                {contact?.whatsapp && (
                  <button className="wa-btn" onClick={handleWhatsApp}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                    Abrir no WhatsApp
                  </button>
                )}
                <button className="edit-contact-btn" onClick={() => {
                  setEditForm({ name: contact.name || '', company: contact.company || '', role: contact.role || '', whatsapp: contact.whatsapp || '', notes: contact.notes || '', tags: contact.tags || '', interval_days: contact.cadences?.[0]?.interval_days || 30 })
                  setIsEditing(true)
                }}>
                  Editar contato
                </button>
                {!confirmDelete ? (
                  <button className="delete-contact-btn" onClick={() => setConfirmDelete(true)}>
                    Excluir contato
                  </button>
                ) : (
                  <div className="confirm-delete-box">
                    <span className="confirm-delete-text">Excluir permanentemente?</span>
                    <div className="confirm-delete-btns">
                      <button className="btn-confirm-del" onClick={handleDelete} disabled={deleting}>
                        {deleting ? 'Excluindo...' : 'Sim, excluir'}
                      </button>
                      <button className="btn-cancel-del" onClick={() => setConfirmDelete(false)}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Perfil (existing contact — edit mode) ── */}
          {tab === 'perfil' && !isNew && isEditing && (
            <form className="form-section" onSubmit={handleUpdate}>
              <div className="form-group">
                <label>Nome *</label>
                <input
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Nome completo"
                  required
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Empresa</label>
                  <input
                    value={editForm.company}
                    onChange={(e) => setEditForm((f) => ({ ...f, company: e.target.value }))}
                    placeholder="Empresa"
                  />
                </div>
                <div className="form-group">
                  <label>Cargo</label>
                  <input
                    value={editForm.role}
                    onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}
                    placeholder="CEO, Sócio..."
                  />
                </div>
              </div>
              <div className="form-group">
                <label>WhatsApp</label>
                <input
                  value={editForm.whatsapp}
                  onChange={(e) => setEditForm((f) => ({ ...f, whatsapp: e.target.value }))}
                  placeholder="+55 11 99999-9999"
                />
              </div>
              <div className="form-group">
                <label>Notas</label>
                <textarea
                  value={editForm.notes}
                  onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Como conheceu, interesses, contexto..."
                  rows={3}
                />
              </div>
              <div className="form-group">
                <label>Tags</label>
                <input
                  value={editForm.tags || ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, tags: e.target.value }))}
                  placeholder="prospect, cliente, parceiro..."
                />
              </div>
              <div className="form-group">
                <label>Cadência de contato</label>
                <select
                  value={editForm.interval_days || 30}
                  onChange={(e) => setEditForm((f) => ({ ...f, interval_days: parseInt(e.target.value) }))}
                >
                  {INTERVAL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="edit-form-actions">
                <button type="submit" className="save-btn" disabled={!editForm.name?.trim() || saving}>
                  {saving ? 'Salvando...' : 'Salvar'}
                </button>
                <button type="button" className="cancel-edit-btn" onClick={() => setIsEditing(false)}>
                  Cancelar
                </button>
              </div>
            </form>
          )}

          {/* ── Novo contato form ── */}
          {isNew && (
            <form className="form-section" onSubmit={handleSave}>
              <div className="form-group">
                <label>Nome *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Nome completo"
                  required
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Empresa</label>
                  <input
                    value={form.company}
                    onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                    placeholder="Empresa"
                  />
                </div>
                <div className="form-group">
                  <label>Cargo</label>
                  <input
                    value={form.role}
                    onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                    placeholder="CEO, Sócio..."
                  />
                </div>
              </div>
              <div className="form-group">
                <label>WhatsApp</label>
                <input
                  value={form.whatsapp}
                  onChange={(e) => setForm((f) => ({ ...f, whatsapp: e.target.value }))}
                  placeholder="+55 11 99999-9999"
                />
              </div>
              <div className="form-group">
                <label>Cadência de contato</label>
                <select
                  value={form.interval_days}
                  onChange={(e) => setForm((f) => ({ ...f, interval_days: parseInt(e.target.value) }))}
                >
                  {INTERVAL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Notas</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Como conheceu, interesses, contexto..."
                  rows={3}
                />
              </div>
              <div className="form-group">
                <label>Tags</label>
                <input
                  value={form.tags || ''}
                  onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                  placeholder="prospect, cliente, parceiro..."
                />
              </div>
              <button type="submit" className="save-btn" disabled={!form.name.trim() || saving}>
                {saving ? 'Salvando...' : 'Salvar contato'}
              </button>
            </form>
          )}

          {/* ── Histórico ── */}
          {tab === 'historico' && !isNew && (
            <div className="history-section">
              {history.length === 0 ? (
                <p className="empty-hint">Nenhum contato registrado ainda.</p>
              ) : (
                <ul className="history-list">
                  {history.map((entry) => (
                    <li key={entry.id} className="history-item">
                      <div className="history-dot" />
                      <div className="history-content">
                        <div className="history-date">{formatDate(entry.contacted_at)}</div>
                        <div className="history-channel">{entry.channel || 'WhatsApp'}</div>
                        {entry.notes && <div className="history-notes">{entry.notes}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ── Cadência ── */}
          {tab === 'cadencia' && !isNew && (
            <div className="cadence-section">
              {!cadence ? (
                <AddCadenceForm contact={contact} userId={userId} onRefresh={onRefresh} />
              ) : (
                <>
                  <div className="cadence-card">
                    <div className="cadence-row">
                      <span className="cadence-key">Frequência</span>
                      <span className="cadence-val">a cada {cadence.interval_days} dias</span>
                    </div>
                    <div className="cadence-row">
                      <span className="cadence-key">Último contato</span>
                      <span className="cadence-val">
                        {cadence.last_contacted_at ? formatDate(cadence.last_contacted_at) : '—'}
                      </span>
                    </div>
                    {status && (
                      <div className="cadence-row">
                        <span className="cadence-key">Status</span>
                        <span className={`status-pill ${status.type}`}>{status.label}</span>
                      </div>
                    )}
                  </div>

                  <div className="contatei-area">
                    <textarea
                      className="contatei-note"
                      value={contateiNote}
                      onChange={(e) => setContateiNote(e.target.value)}
                      placeholder="Nota rápida sobre o contato (opcional)"
                      rows={2}
                    />
                    <button
                      className="contatei-btn"
                      onClick={handleContatei}
                      disabled={contateiLoading}
                    >
                      {contateiLoading ? 'Registrando...' : '✓  Contatei'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}

function AddCadenceForm({ contact, userId, onRefresh }) {
  const [interval, setInterval] = useState(30)
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    setSaving(true)
    try {
      const { error } = await supabase.from('cadences').insert({
        contact_id: contact.id,
        user_id: userId,
        interval_days: interval,
      })
      if (error) { alert('Erro: ' + error.message); return }
      await onRefresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="add-cadence-form">
      <p className="empty-hint" style={{ marginBottom: 16 }}>Nenhuma cadência configurada.</p>
      <div className="form-group">
        <label>Frequência de contato</label>
        <select value={interval} onChange={(e) => setInterval(parseInt(e.target.value))}>
          {[
            { value: 3,  label: '3 dias — Contato ativo' },
            { value: 7,  label: '7 dias — Semanal' },
            { value: 14, label: '14 dias — Quinzenal' },
            { value: 21, label: '21 dias — 3 semanas' },
            { value: 30, label: '30 dias — Mensal' },
            { value: 45, label: '45 dias — 6 semanas' },
            { value: 60, label: '60 dias — Bimestral' },
            { value: 90, label: '90 dias — Trimestral' },
          ].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <button className="save-btn" onClick={handleAdd} disabled={saving}>
        {saving ? 'Salvando...' : 'Configurar cadência'}
      </button>
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="info-row">
      <div className="info-label">{label}</div>
      <div className="info-value">{value}</div>
    </div>
  )
}
