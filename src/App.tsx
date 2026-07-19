import styles from './App.module.css';
import { routeHash, type Route } from './router/router';
import { useRoute } from './router/useRoute';
import PlanPage from './features/plan/PlanPage';
import RecipeListPage from './features/recipes/RecipeListPage';
import RecipeDetailPage from './features/recipes/RecipeDetailPage';
import ShoppingPage from './features/shopping/ShoppingPage';
import ZasobyPage from './features/zasoby/ZasobyPage';
import SettingsPage from './features/settings/SettingsPage';

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

  return (
    <div className={styles.app}>
      <main className={styles.content}>{renderPage(route)}</main>
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
