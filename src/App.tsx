import { useEffect } from 'react';
import styles from './App.module.css';
import { routeHash, type Route } from './router/router';
import { useRoute } from './router/useRoute';
import PlanPage from './features/plan/PlanPage';
import RecipeListPage from './features/recipes/RecipeListPage';
import RecipeDetailPage from './features/recipes/RecipeDetailPage';
import ShoppingPage from './features/shopping/ShoppingPage';
import ZasobyPage from './features/zasoby/ZasobyPage';
import SettingsPage from './features/settings/SettingsPage';
import StatusBanner from './components/StatusBanner';
import { useSessionStore } from './store/session';
import { useDataStore } from './store/data';

interface Tab {
  route: Route;
  label: string;
  icon: string;
  isActive: (route: Route) => boolean;
}

const TABS: Tab[] = [
  { route: { name: 'plan' }, label: 'Plán', icon: '📅', isActive: (r) => r.name === 'plan' },
  {
    route: { name: 'recipes' },
    label: 'Recepty',
    icon: '📖',
    isActive: (r) => r.name === 'recipes' || r.name === 'recipe',
  },
  { route: { name: 'shopping' }, label: 'Nákup', icon: '🛒', isActive: (r) => r.name === 'shopping' },
  { route: { name: 'zasoby' }, label: 'Zásoby', icon: '🏷️', isActive: (r) => r.name === 'zasoby' },
  {
    route: { name: 'settings' },
    label: 'Nastavení',
    icon: '⚙️',
    isActive: (r) => r.name === 'settings',
  },
];

function renderPage(route: Route) {
  switch (route.name) {
    case 'plan':
      return <PlanPage />;
    case 'recipes':
      return <RecipeListPage />;
    case 'recipe':
      return <RecipeDetailPage id={route.id} />;
    case 'shopping':
      return <ShoppingPage />;
    case 'zasoby':
      return <ZasobyPage />;
    case 'settings':
      return <SettingsPage />;
  }
}

function App() {
  const route = useRoute();
  const configured = useSessionStore((s) => s.configured);
  const status = useDataStore((s) => s.status);
  const loadAll = useDataStore((s) => s.loadAll);

  // Load once on app start, using whatever session was already restored from
  // localStorage — a settings-page save triggers its own loadAll separately.
  useEffect(() => {
    const session = useSessionStore.getState();
    if (session.configured) {
      void loadAll({ owner: session.owner, repo: session.repo, token: session.token });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showSettingsGate = !configured || status === 'authError';

  return (
    <div className={styles.app}>
      <StatusBanner />
      <main className={styles.content}>
        {!configured && <p className={styles.gateHint}>Nejdřív připoj datový repozitář</p>}
        {showSettingsGate ? <SettingsPage /> : renderPage(route)}
      </main>
      <nav className={styles.tabBar}>
        {TABS.map((tab) => (
          <a
            key={tab.label}
            href={routeHash(tab.route)}
            className={tab.isActive(route) ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          >
            <span className={styles.tabIcon}>{tab.icon}</span>
            <span>{tab.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}

export default App;
