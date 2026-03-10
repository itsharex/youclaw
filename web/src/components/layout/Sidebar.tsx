import { NavLink } from 'react-router-dom'
import { MessageSquare, Bot, CalendarClock, Brain, Puzzle, Settings } from 'lucide-react'
import { cn } from '../../lib/utils'

const navItems = [
  { to: '/', icon: MessageSquare, label: 'Chat' },
  { to: '/agents', icon: Bot, label: 'Agents' },
  { to: '/tasks', icon: CalendarClock, label: 'Tasks' },
  { to: '/memory', icon: Brain, label: 'Memory' },
  { to: '/skills', icon: Puzzle, label: 'Skills' },
  { to: '/system', icon: Settings, label: 'System' },
]

export function Sidebar() {
  return (
    <aside className="w-[220px] border-r border-border flex flex-col shrink-0">
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.disabled ? '#' : item.to}
            className={({ isActive }) => cn(
              'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
              isActive && !item.disabled ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
              item.disabled && 'opacity-40 cursor-not-allowed'
            )}
            onClick={e => item.disabled && e.preventDefault()}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
