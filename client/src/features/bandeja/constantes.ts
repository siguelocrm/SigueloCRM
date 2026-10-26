import {
  MessageSquare,
  UserCog,
  Users,
  Reply,
  Calendar,
  Smartphone,
  BarChart3,
  Palette,
  Bot,
  Columns3,
  LineChart,
  Sun,
  Flame,
  CalendarClock,
  Repeat,
  Store,
  Sparkles,
  GraduationCap,
  type LucideIcon,
  Settings,
} from 'lucide-react';

export interface Seccion {
  id: string;
  icon: LucideIcon;
  label: string;
  grupo: string;
  soloAdmin?: boolean;
  soloDueno?: boolean;
}

// Tres bloques (rediseño oct. 2026): lo que se usa todos los días, lo que se
// automatiza y lo que se administra.
export const SECCIONES: Seccion[] = [
  { id: 'hoy', icon: Sun, label: 'Hoy', grupo: 'Trabajo' },
  { id: 'dashboard', icon: BarChart3, label: 'Dashboard', grupo: 'Trabajo' },
  { id: 'chats', icon: MessageSquare, label: 'Bandeja', grupo: 'Trabajo' },
  { id: 'pipeline', icon: Columns3, label: 'Embudo', grupo: 'Trabajo' },
  { id: 'oportunidades', icon: Flame, label: 'Oportunidades', grupo: 'Trabajo' },
  { id: 'contactos', icon: Users, label: 'Contactos', grupo: 'Trabajo' },
  { id: 'agenda', icon: Calendar, label: 'Agenda', grupo: 'Trabajo' },
  { id: 'bot', icon: Bot, label: 'Bot y flujos', grupo: 'Automatizar', soloAdmin: true },
  { id: 'respuestas', icon: Reply, label: 'Respuestas rápidas', grupo: 'Automatizar' },
  { id: 'programados', icon: CalendarClock, label: 'Programados', grupo: 'Automatizar' },
  { id: 'seguimiento', icon: Repeat, label: 'Seguimiento', grupo: 'Automatizar', soloAdmin: true },
  { id: 'ia', icon: Sparkles, label: 'IA', grupo: 'Automatizar', soloAdmin: true },
  { id: 'inscripciones', icon: GraduationCap, label: 'Inscripciones', grupo: 'Automatizar', soloAdmin: true },
  { id: 'reportes', icon: LineChart, label: 'Reportes', grupo: 'Administrar' },
  { id: 'usuarios', icon: UserCog, label: 'Usuarios', grupo: 'Administrar', soloAdmin: true },
  { id: 'conexiones', icon: Smartphone, label: 'Conexiones', grupo: 'Administrar' },
  { id: 'negocios', icon: Store, label: 'Negocios', grupo: 'Administrar', soloAdmin: true },
  { id: 'mi-empresa', icon: Palette, label: 'Mi empresa', grupo: 'Administrar', soloDueno: true },
  { id: 'configuracion', icon: Settings, label: 'Configuración', grupo: 'Administrar' },
];

// Secciones fijas en la barra inferior del celular; el resto va en "Más".
export const IDS_NAV_MOBILE = ['hoy', 'chats', 'pipeline'];
