import { useDataStore } from '../store/data';
import { bannerFor } from './statusLogic';
import styles from './StatusBanner.module.css';

/** Global loading/offline/error surface (step 10) — thin wrapper over `bannerFor`. */
function StatusBanner() {
  const status = useDataStore((s) => s.status);
  const offline = useDataStore((s) => s.offline);
  const saveError = useDataStore((s) => s.saveError);

  const banner = bannerFor({ status, offline, saveError });
  if (!banner.kind) return null;

  return (
    <div className={`${styles.banner} ${styles[banner.kind]}`}>
      <span>{banner.message}</span>
      {banner.kind === 'authError' && (
        <a href="#/nastaveni" className={styles.link}>
          Do nastavení
        </a>
      )}
    </div>
  );
}

export default StatusBanner;
