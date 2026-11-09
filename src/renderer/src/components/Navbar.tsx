import { href, type Route } from '../lib/router'
import { Icon, TallyMark } from './Icon'

const ITEMS: { label: string; route: Route; match: Route['name'][] }[] = [
  { label: 'Dashboard', route: { name: 'dashboard' }, match: ['dashboard', 'result'] },
  { label: 'Modules', route: { name: 'modules' }, match: ['modules', 'module', 'quiz'] },
  { label: 'History', route: { name: 'history', moduleId: null, quizId: null }, match: ['history'] },
  { label: 'Help', route: { name: 'help', section: null }, match: ['help'] }
]

export function Navbar({ route }: { route: Route }) {
  return (
    <header className="titlebar">
      <nav className="nav" aria-label="Main">
        <a className="nav-brand" href={href({ name: 'dashboard' })} aria-label="Tally, go to dashboard">
          <TallyMark size={22} />
          <span>Tally</span>
        </a>
        <ul className="nav-items">
          {ITEMS.map((item) => {
            const current = item.match.includes(route.name)
            return (
              <li key={item.label}>
                <a
                  className={current ? 'nav-item is-current' : 'nav-item'}
                  href={href(item.route)}
                  aria-current={current ? 'page' : undefined}
                >
                  {item.label}
                </a>
              </li>
            )
          })}
        </ul>
        <a
          className={route.name === 'settings' ? 'nav-icon is-current' : 'nav-icon'}
          href={href({ name: 'settings' })}
          aria-label="Settings"
          title="Settings"
          aria-current={route.name === 'settings' ? 'page' : undefined}
        >
          <Icon name="settings" size={18} />
        </a>
        <a className="nav-cta" href={href({ name: 'upload', moduleId: route.name === 'module' ? route.id : null })}>
          <Icon name="upload" size={16} weight={2.2} />
          <span>Upload quiz</span>
        </a>
      </nav>
    </header>
  )
}
