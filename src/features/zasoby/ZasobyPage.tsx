import { useState, type FormEvent } from 'react';
import { useDataStore } from '../../store/data';
import { sortedPantry, validatePantryName } from './pantryLogic';
import { sortedSales, validateSaleName } from './salesLogic';
import styles from './ZasobyPage.module.css';

function SalesSegment() {
  const sales = useDataStore((s) => s.files.sales.data);
  const upsertSaleItem = useDataStore((s) => s.upsertSaleItem);
  const removeSaleItem = useDataStore((s) => s.removeSaleItem);
  const clearSales = useDataStore((s) => s.clearSales);

  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const result = validateSaleName(name, sales);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    void upsertSaleItem(name.trim(), note.trim() || undefined);
    setName('');
    setNote('');
  }

  function handleClear() {
    if (window.confirm('Smazat celý seznam slev?')) void clearSales();
  }

  const list = sortedSales(sales);

  return (
    <div className={styles.segmentContent}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <input placeholder="Název ingredience" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="např. Lidl 89 Kč" value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="submit">Přidat</button>
        {error && <p className={styles.error}>{error}</p>}
      </form>

      <div className={styles.listHeader}>
        <span>{list.length} položek</span>
        <button type="button" onClick={handleClear}>
          Nový týden
        </button>
      </div>

      {list.length === 0 ? (
        <p className={styles.empty}>Zatím žádné slevy…</p>
      ) : (
        <ul className={styles.list}>
          {list.map((item) => (
            <li key={item.name} className={styles.row}>
              <span className={styles.rowText}>
                {item.name}
                {item.note && <span className={styles.note}> — {item.note}</span>}
              </span>
              <button type="button" onClick={() => void removeSaleItem(item.name)} aria-label={`Odebrat ${item.name}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PantrySegment() {
  const pantry = useDataStore((s) => s.files.pantry.data);
  const addPantryItem = useDataStore((s) => s.addPantryItem);
  const removePantryItem = useDataStore((s) => s.removePantryItem);

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const result = validatePantryName(name, pantry);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    void addPantryItem(name.trim());
    setName('');
  }

  const list = sortedPantry(pantry);

  return (
    <div className={styles.segmentContent}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <input placeholder="Název ingredience" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit">Přidat</button>
        {error && <p className={styles.error}>{error}</p>}
      </form>

      {list.length === 0 ? (
        <p className={styles.empty}>Spíž je prázdná</p>
      ) : (
        <ul className={styles.list}>
          {list.map((item) => (
            <li key={item} className={styles.row}>
              <span className={styles.rowText}>{item}</span>
              <button type="button" onClick={() => void removePantryItem(item)} aria-label={`Odebrat ${item}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ZasobyPage() {
  const [tab, setTab] = useState<'sales' | 'pantry'>('sales');

  return (
    <div className={styles.page}>
      <h1>Zásoby</h1>

      <div className={styles.segments}>
        <button
          type="button"
          className={tab === 'sales' ? `${styles.segment} ${styles.segmentActive}` : styles.segment}
          onClick={() => setTab('sales')}
        >
          Slevy
        </button>
        <button
          type="button"
          className={tab === 'pantry' ? `${styles.segment} ${styles.segmentActive}` : styles.segment}
          onClick={() => setTab('pantry')}
        >
          Spíž
        </button>
      </div>

      {tab === 'sales' ? <SalesSegment /> : <PantrySegment />}
    </div>
  );
}

export default ZasobyPage;
