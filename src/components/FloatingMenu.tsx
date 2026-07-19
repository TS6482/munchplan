import { useState } from 'react';
import { navigate } from '../router/router';
import { useRoute } from '../router/useRoute';
import { menuItemsFor } from './menuLogic';
import styles from './FloatingMenu.module.css';

/** Floating top-right "more options" button, opening a dropdown of route-dependent actions. */
function FloatingMenu() {
  const route = useRoute();
  const [open, setOpen] = useState(false);
  const items = menuItemsFor(route);

  function select(itemRoute: Parameters<typeof navigate>[0]) {
    setOpen(false);
    navigate(itemRoute);
  }

  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        aria-label="Další možnosti"
        className={styles.button}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <>
          <button type="button" className={styles.backdrop} aria-label="Zavřít nabídku" onClick={() => setOpen(false)} />
          <div className={styles.panel}>
            {items.map((item) => (
              <button key={item.label} type="button" className={styles.item} onClick={() => select(item.route)}>
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default FloatingMenu;
