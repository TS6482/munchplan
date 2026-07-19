import { useMemo, useState, type FormEvent } from 'react';
import { useDataStore } from '../../store/data';
import { routeHash } from '../../router/router';
import type { ShoppingItem } from '../../engine/shoppingList';
import { itemAmountText, newExtraItem, shoppingView, toggleHomeTarget, validateExtraName, weekExtrasFor } from './shoppingLogic';
import { weekChoices } from '../plan/planLogic';
import styles from './ShoppingPage.module.css';

function BuyRow({
  item,
  onToggleCheck,
  onMoveHome,
}: {
  item: ShoppingItem;
  onToggleCheck: () => void;
  onMoveHome: () => void;
}) {
  const amountText = itemAmountText(item);
  return (
    <li className={styles.row}>
      <label className={styles.rowLabel}>
        <input type="checkbox" checked={item.checked} onChange={onToggleCheck} />
        <span className={item.checked ? `${styles.rowText} ${styles.checked}` : styles.rowText}>
          {item.label}
          {amountText && <span className={styles.amount}> — {amountText}</span>}
          {item.onSale && <span className={styles.saleBadge}> 🏷️ {item.matchedSale}</span>}
        </span>
        <span className={styles.fromRecipes}>{item.fromRecipes.join(', ')}</span>
      </label>
      <button type="button" className={styles.moveButton} onClick={onMoveHome}>
        → Doma
      </button>
    </li>
  );
}

function HomeRow({ item, onMoveBuy }: { item: ShoppingItem; onMoveBuy: () => void }) {
  return (
    <li className={styles.row}>
      <span className={styles.rowLabel}>
        <span className={styles.rowText}>
          {item.label}
          <span className={styles.fromRecipes}> {item.fromRecipes.join(', ')}</span>
        </span>
      </span>
      <button type="button" className={styles.moveButton} onClick={onMoveBuy}>
        → Koupit
      </button>
    </li>
  );
}

function ShoppingPage() {
  const recipes = useDataStore((s) => s.files.recipes.data);
  const plans = useDataStore((s) => s.files.plans.data);
  const pantry = useDataStore((s) => s.files.pantry.data);
  const sales = useDataStore((s) => s.files.sales.data);
  const extras = useDataStore((s) => s.files.extras.data);
  const setCheck = useDataStore((s) => s.setCheck);
  const setHomeOverride = useDataStore((s) => s.setHomeOverride);
  const addExtraItem = useDataStore((s) => s.addExtraItem);
  const removeExtraItem = useDataStore((s) => s.removeExtraItem);
  const setExtraChecked = useDataStore((s) => s.setExtraChecked);

  // Default to the CURRENT week (unlike PlanPage, which defaults to next
  // week for planning ahead) — shopping happens for the week you're
  // currently living, so "Tento týden" matters most when opening this tab.
  const choices = useMemo(() => weekChoices(new Date()), []);
  const [weekKey, setWeekKey] = useState(choices[0].key);
  const [homeOpen, setHomeOpen] = useState(false);
  const [extraName, setExtraName] = useState('');
  const [extraError, setExtraError] = useState<string | null>(null);

  const hasPlan = plans[weekKey] !== undefined;
  const overrides = weekExtrasFor(extras, weekKey).homeOverrides;
  const view = shoppingView({ recipes, plans, pantry, sales, extras, week: weekKey });

  function handleAddExtra(e: FormEvent) {
    e.preventDefault();
    const result = validateExtraName(extraName);
    if (!result.ok) {
      setExtraError(result.error);
      return;
    }
    setExtraError(null);
    void addExtraItem(weekKey, newExtraItem(extraName));
    setExtraName('');
  }

  return (
    <div className={styles.page}>
      <h1>Nákup</h1>

      <div className={styles.segments}>
        {choices.map((choice) => (
          <button
            key={choice.key}
            type="button"
            className={choice.key === weekKey ? `${styles.segment} ${styles.segmentActive}` : styles.segment}
            onClick={() => setWeekKey(choice.key)}
          >
            {choice.label}
          </button>
        ))}
      </div>

      {!hasPlan && (
        <p className={styles.empty}>
          {weekKey === choices[0].key ? 'Žádný plán pro tento týden' : 'Žádný plán pro příští týden'}.{' '}
          <a href={routeHash({ name: 'plan' })}>Naplánovat týden</a>
        </p>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Koupit</h2>
        {view.buy.length === 0 ? (
          <p className={styles.empty}>Nic ke koupení</p>
        ) : (
          <ul className={styles.list}>
            {view.buy.map((item) => (
              <BuyRow
                key={item.key}
                item={item}
                onToggleCheck={() => void setCheck(weekKey, item.key, !item.checked)}
                onMoveHome={() => void setHomeOverride(weekKey, item.key, toggleHomeTarget(overrides, item.key, 'toHome'))}
              />
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section}>
        <button type="button" className={styles.sectionToggle} onClick={() => setHomeOpen((open) => !open)}>
          <h2 className={styles.sectionTitle}>Doma máme ({view.home.length})</h2>
          <span>{homeOpen ? '▲' : '▼'}</span>
        </button>
        {homeOpen &&
          (view.home.length === 0 ? (
            <p className={styles.empty}>Nic doma navíc</p>
          ) : (
            <ul className={styles.list}>
              {view.home.map((item) => (
                <HomeRow
                  key={item.key}
                  item={item}
                  onMoveBuy={() => void setHomeOverride(weekKey, item.key, toggleHomeTarget(overrides, item.key, 'toBuy'))}
                />
              ))}
            </ul>
          ))}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Extra</h2>
        <form className={styles.form} onSubmit={handleAddExtra}>
          <input placeholder="Např. drogerie, snídaně…" value={extraName} onChange={(e) => setExtraName(e.target.value)} />
          <button type="submit" className="btn btnPrimary">
            Přidat
          </button>
          {extraError && <p className={styles.error}>{extraError}</p>}
        </form>

        {view.extras.length === 0 ? (
          <p className={styles.empty}>Žádné extra položky</p>
        ) : (
          <ul className={styles.list}>
            {view.extras.map((item) => (
              <li key={item.id} className={styles.row}>
                <label className={styles.rowLabel}>
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={() => void setExtraChecked(weekKey, item.id, !item.checked)}
                  />
                  <span className={item.checked ? `${styles.rowText} ${styles.checked}` : styles.rowText}>
                    {item.name}
                  </span>
                </label>
                <button
                  type="button"
                  className={styles.moveButton}
                  onClick={() => void removeExtraItem(weekKey, item.id)}
                  aria-label={`Odebrat ${item.name}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default ShoppingPage;
