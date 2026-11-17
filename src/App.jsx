import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import Contacts from './pages/Contacts'
import Cadences from './pages/Cadences'
import Settings from './pages/Settings'
import ContactDrawer from './components/ContactDrawer'
import './App.css'

export default function App() {
  const [session, setSession] = useState(undefined)
  const [page, setPage] = useState('dashboard')
  const [contacts, setContacts] = useState([])
  const [contactsLoading, setContactsLoading] = useState(true)
  const [selectedContact, setSelectedContact] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) loadContacts()
      else setContactsLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (!session) {
        setContacts([])
        setContactsLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function loadContacts() {
    setContactsLoading(true)
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('*, cadences(*), contact_history(*)')
        .order('name')
      if (!error) setContacts(data || [])
    } catch (err) {
      console.error('Error loading contacts:', err)
    } finally {
      setContactsLoading(false)
    }
  }

  if (session === undefined) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
      </div>
    )
  }

  if (!session) {
    return <Login />
  }

  return (
    <div className="app-shell">
      <Sidebar page={page} onNavigate={setPage} user={session.user} />
      <main className="app-main">
        {page === 'dashboard' && (
          <Dashboard
            contacts={contacts}
            loading={contactsLoading}
            onSelectContact={setSelectedContact}
            onNavigate={setPage}
          />
        )}
        {page === 'contacts' && (
          <Contacts
            contacts={contacts}
            loading={contactsLoading}
            onSelectContact={setSelectedContact}
            onAdd={() => setSelectedContact({ isNew: true })}
          />
        )}
        {page === 'cadences' && (
          <Cadences
            contacts={contacts}
            loading={contactsLoading}
            onSelectContact={setSelectedContact}
          />
        )}
        {page === 'settings' && (
          <Settings user={session.user} />
        )}
      </main>
      <ContactDrawer
        contact={selectedContact}
        onClose={() => setSelectedContact(null)}
        onRefresh={loadContacts}
        userId={session.user.id}
      />
    </div>
  )
}
